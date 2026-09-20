import type { CampaignState } from '@engine/domain';
import {
  DEFAULT_SAVE_RETENTION,
  DEFAULT_SLOT_ID,
  SaveStoreError,
  type ContentRepository,
  type SaveEnvelope,
  type SaveKind,
  type SaveRetention,
  type SaveStore,
  type SaveSummary,
  type SlotManifest,
  type StorageReport,
} from '@engine/ports';
import {
  ruleViolation,
  saveWriteError,
  type EngineError,
  type ResumableSaveData,
  type SaveSlotData,
  type SaveStatusData,
  type SaveStateName,
  type StorageReportData,
} from '@protocol';

import { captureSnapshot } from './envelope';
import { loadSave, type LoadResult } from './load';

/**
 * Save orchestration (Technical Specification 11.3; Functional Specification 3.4).
 *
 * The engine decides when a snapshot exists and what it contains; the store
 * only writes what it is handed. Capture is synchronous and happens at the
 * revision the caller asked about, so simulation can carry on while the write
 * is still in flight. Writes for one campaign are serialised and therefore
 * finish in revision order, and a redundant interval save queued behind
 * another of the same kind replaces it rather than writing twice.
 *
 * Nothing here is authoritative. A failed write leaves campaign state and the
 * previously stored snapshots untouched, and is reported through the save
 * status so the interface can warn without interrupting play.
 *
 * @implements TECH-11.1, TECH-11.3, FUNC-3.4
 */

export interface SaveServiceOptions {
  readonly store: SaveStore;
  readonly content: ContentRepository;
  readonly engineVersion: string;
  readonly protocolVersion: number;
  readonly slotId?: string;
  readonly retention?: SaveRetention;
}

export interface SaveService {
  readonly slotId: string;
  /** The current status projection. Never throws. */
  status(): SaveStatusData;
  /** The slot projection, including what `resume` would open. */
  slot(): Promise<SaveSlotData>;
  /** Captures `campaign` now and queues the write. */
  save(campaign: CampaignState, kind: SaveKind, savedAtRealMs: number): Promise<SaveStatusData>;
  /** Resolves once every queued write has finished or failed. */
  drain(): Promise<void>;
  /** Opens the newest valid snapshot, falling back through older ones. */
  resume(): Promise<ResumeResult>;
  /** Deletes every snapshot in the slot. */
  clear(): Promise<void>;
}

export type ResumeResult =
  | { readonly ok: true; readonly loaded: LoadResult & { ok: true }; readonly saveId: string }
  | { readonly ok: false; readonly error: EngineError };

/** Free space below this fraction of the quota is reported as low. */
const LOW_SPACE_FRACTION = 0.1;

export function createSaveService(options: SaveServiceOptions): SaveService {
  const slotId = options.slotId ?? DEFAULT_SLOT_ID;
  const retention = options.retention ?? DEFAULT_SAVE_RETENTION;
  const { store, content, engineVersion, protocolVersion } = options;

  let manifest: SlotManifest | null = null;
  let manifestRead = false;
  let nextSequence = 1;
  let storage: StorageReport = { persistent: null, usageBytes: null, quotaBytes: null };
  let storageRead = false;

  let state: SaveStateName = 'idle';
  let lastError: EngineError | null = null;
  let lastSaved: SaveSummary | null = null;

  /** Captures waiting to be written, at most one per kind (coalescing). */
  const queued = new Map<SaveKind, SaveEnvelope>();
  let running: Promise<void> = Promise.resolve();
  let draining = false;
  /**
   * Captures happen in the order they were asked for. The first one waits for
   * the manifest, so without this two overlapping callers could capture out of
   * order and the queue would no longer be in revision order.
   */
  let capturing: Promise<void> = Promise.resolve();

  async function ensureManifest(): Promise<SlotManifest | null> {
    if (manifestRead) {
      return manifest;
    }
    manifestRead = true;
    try {
      manifest = await store.readManifest(slotId);
    } catch (error: unknown) {
      manifest = null;
      fail(describeStoreError(error));
      return null;
    }
    nextSequence = highestSequence(manifest) + 1;
    return manifest;
  }

  async function ensureStorage(): Promise<StorageReport> {
    if (storageRead) {
      return storage;
    }
    storageRead = true;
    try {
      const persistent = await store.requestPersistence();
      const report = await store.estimate();
      storage = { ...report, persistent: report.persistent ?? persistent };
    } catch {
      // A browser that will not answer is not a save failure; the interface
      // simply shows no space figures.
      storage = { persistent: null, usageBytes: null, quotaBytes: null };
    }
    return storage;
  }

  function fail(error: EngineError): void {
    state = 'failed';
    lastError = error;
  }

  function statusOf(): SaveStatusData {
    return {
      state,
      backend: store.backend,
      slotId,
      lastSavedRevision: lastSaved?.revision ?? null,
      lastSavedAtRealMs: lastSaved?.savedAtRealMs ?? null,
      lastSaveKind: lastSaved?.kind ?? null,
      pendingWrites: queued.size + (draining ? 1 : 0),
      storage: reportOf(storage),
      error: lastError,
    };
  }

  /**
   * Drains the queue one write at a time. Started after a capture and never
   * run concurrently, so writes reach the store in the order they were
   * captured, which is revision order.
   */
  function pump(): void {
    running = running.then(async () => {
      while (queued.size > 0) {
        const next = takeNext(queued);
        if (next === null) {
          return;
        }
        draining = true;
        try {
          manifest = await store.write({ envelope: next, retention });
          lastSaved = summaryFor(manifest, next.saveId);
          state = 'saved';
          lastError = null;
          storageRead = false;
        } catch (error: unknown) {
          fail(describeStoreError(error));
        } finally {
          draining = false;
        }
      }
    });
  }

  return {
    slotId,

    status(): SaveStatusData {
      return statusOf();
    },

    async slot(): Promise<SaveSlotData> {
      const current = await ensureManifest();
      await ensureStorage();
      const newest = current?.saves[0] ?? null;

      return {
        slotId,
        saveCount: current?.saves.length ?? 0,
        resumable: newest === null ? null : resumableOf(newest, content.contentHash),
        status: statusOf(),
      };
    },

    save(
      campaign: CampaignState,
      kind: SaveKind,
      savedAtRealMs: number,
    ): Promise<SaveStatusData> {
      const captured = capturing.then(async () => {
        await ensureManifest();
        await ensureStorage();

        const envelope = captureSnapshot({
          campaign,
          content,
          engineVersion,
          protocolVersion,
          slotId,
          kind,
          sequence: nextSequence,
          savedAtRealMs,
        });
        nextSequence += 1;

        // A capture of the same kind that has not started writing is redundant
        // and is replaced rather than written twice
        // (Technical Specification 11.3).
        const pending = queued.get(kind);
        if (pending === undefined || pending.revision <= envelope.revision) {
          queued.set(kind, envelope);
        }
        state = 'pending';
        pump();

        return statusOf();
      });

      capturing = captured.then(
        () => undefined,
        () => undefined,
      );
      return captured;
    },

    async drain(): Promise<void> {
      // Captures first, then the writes they queued, then once more: a write
      // in flight may have had a capture arrive behind it.
      await capturing;
      await running;
      await running;
    },

    async resume(): Promise<ResumeResult> {
      const current = await ensureManifest();
      const saves = current?.saves ?? [];
      if (saves.length === 0) {
        // Nothing to resume is an ordinary, explainable answer rather than a
        // storage failure (Functional Specification 22.10).
        return { ok: false, error: ruleViolation('noResumableSave', { slotId }) };
      }

      let lastFailure: EngineError | null = null;
      for (const summary of saves) {
        let stored: unknown;
        try {
          stored = await store.readSave(slotId, summary.saveId);
        } catch (error: unknown) {
          lastFailure = describeStoreError(error);
          continue;
        }

        const loaded = loadSave(stored, { content });
        if (loaded.ok) {
          return { ok: true, loaded, saveId: summary.saveId };
        }
        // The specification requires a safe recovery to the last valid
        // snapshot: an unreadable or damaged save is skipped, not repaired.
        lastFailure = loaded.error;
      }

      return { ok: false, error: lastFailure ?? ruleViolation('noResumableSave', { slotId }) };
    },

    async clear(): Promise<void> {
      await capturing;
      await running;
      queued.clear();
      try {
        await store.clearSlot(slotId);
      } catch (error: unknown) {
        fail(describeStoreError(error));
        return;
      }
      manifest = null;
      manifestRead = true;
      nextSequence = 1;
      lastSaved = null;
      lastError = null;
      state = 'idle';
    },
  };
}

function takeNext(queued: Map<SaveKind, SaveEnvelope>): SaveEnvelope | null {
  for (const [kind, envelope] of queued) {
    queued.delete(kind);
    return envelope;
  }
  return null;
}

function highestSequence(manifest: SlotManifest | null): number {
  let highest = 0;
  for (const save of manifest?.saves ?? []) {
    highest = Math.max(highest, save.sequence);
  }
  return highest;
}

function summaryFor(manifest: SlotManifest, saveId: string): SaveSummary | null {
  return manifest.saves.find((save) => save.saveId === saveId) ?? null;
}

function resumableOf(summary: SaveSummary, installedContentHash: string): ResumableSaveData {
  return {
    saveId: summary.saveId,
    campaignId: summary.campaignId,
    displayName: summary.displayName,
    kind: summary.kind,
    revision: summary.revision,
    simulationTimeMs: summary.simulationTimeMs,
    savedAtRealMs: summary.savedAtRealMs,
    formatVersion: summary.formatVersion,
    contentVersion: summary.contentVersion,
    contentMatches: summary.contentHash === installedContentHash,
  };
}

function reportOf(report: StorageReport): StorageReportData {
  const { usageBytes, quotaBytes } = report;
  const lowSpace =
    usageBytes !== null &&
    quotaBytes !== null &&
    quotaBytes > 0 &&
    quotaBytes - usageBytes < quotaBytes * LOW_SPACE_FRACTION;

  return { ...report, lowSpace };
}

function describeStoreError(error: unknown): EngineError {
  if (error instanceof SaveStoreError) {
    return saveWriteError(error.reason, { slotId: error.slotId ?? '' });
  }
  return saveWriteError('writeFailed', { reason: 'unexpected' });
}
