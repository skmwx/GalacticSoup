import {
  SaveStoreError,
  type SaveStore,
  type SaveWriteRequest,
  type SlotManifest,
  type StorageReport,
} from '@engine/ports';
import { deepClone } from '@shared';

import { planWrite } from './retention.ts';

/**
 * In-memory save store (Technical Specification 15.1, 16).
 *
 * The headless engine needs durable-shaped storage in tests and balance runs
 * without a browser. This store honours the same contract as the IndexedDB
 * one: a write applies its plan atomically, a failure leaves the previous
 * manifest and snapshots intact, and stored documents are returned as plain
 * copies so a caller cannot reach back into the store.
 *
 * It also exposes the hooks a persistence test needs - simulated write
 * failures, a corrupted document, a snapshot the manifest still names - which
 * a real store cannot offer.
 */

export interface MemorySaveStoreOptions {
  /** Reported in diagnostics and in the save status. */
  readonly backend?: string;
  /**
   * Runs before a write is applied. Throwing a `SaveStoreError` simulates a
   * quota failure or an interrupted write; nothing is written when it throws.
   */
  readonly beforeWrite?: (request: SaveWriteRequest) => void;
  readonly storage?: StorageReport;
  readonly persistence?: boolean | null;
}

export interface MemorySaveStore extends SaveStore {
  /** Save ids currently held, in insertion order. */
  saveIds(): readonly string[];
  /** Replaces a stored document, for corruption fixtures. */
  replace(saveId: string, document: unknown): void;
  /**
   * Removes a snapshot while leaving the manifest naming it, which is what an
   * interrupted write or an evicted record looks like on the next load.
   */
  dropSnapshot(saveId: string): void;
}

export function createMemorySaveStore(options: MemorySaveStoreOptions = {}): MemorySaveStore {
  const manifests = new Map<string, SlotManifest>();
  const snapshots = new Map<string, unknown>();
  const slotOf = new Map<string, string>();

  return {
    backend: options.backend ?? 'memory',

    readManifest(slotId: string): Promise<SlotManifest | null> {
      const manifest = manifests.get(slotId);
      return Promise.resolve(manifest === undefined ? null : deepClone(manifest));
    },

    readSave(slotId: string, saveId: string): Promise<unknown | null> {
      if (slotOf.get(saveId) !== slotId) {
        return Promise.resolve(null);
      }
      const stored = snapshots.get(saveId);
      return Promise.resolve(stored === undefined ? null : deepClone(stored));
    },

    // Asynchronous so a refused write is a rejected promise rather than a
    // synchronous throw, which is what the port promises its callers.
    async write(request: SaveWriteRequest): Promise<SlotManifest> {
      await Promise.resolve();
      options.beforeWrite?.(request);

      const { envelope, retention } = request;
      const existing = manifests.get(envelope.slotId) ?? null;
      const plan = planWrite(existing, envelope, retention);

      // Applied only once nothing can fail, so a rejected write leaves the
      // previous manifest and snapshots exactly as they were.
      snapshots.set(envelope.saveId, deepClone(envelope));
      slotOf.set(envelope.saveId, envelope.slotId);
      manifests.set(envelope.slotId, plan.manifest);
      for (const saveId of plan.removeIds) {
        snapshots.delete(saveId);
        slotOf.delete(saveId);
      }

      return deepClone(plan.manifest);
    },

    clearSlot(slotId: string): Promise<void> {
      for (const [saveId, owner] of [...slotOf]) {
        if (owner === slotId) {
          snapshots.delete(saveId);
          slotOf.delete(saveId);
        }
      }
      manifests.delete(slotId);
      return Promise.resolve();
    },

    estimate(): Promise<StorageReport> {
      return Promise.resolve(
        options.storage ?? { persistent: options.persistence ?? null, usageBytes: null, quotaBytes: null },
      );
    },

    requestPersistence(): Promise<boolean | null> {
      return Promise.resolve(options.persistence ?? null);
    },

    saveIds(): readonly string[] {
      return [...snapshots.keys()];
    },

    replace(saveId: string, document: unknown): void {
      if (!snapshots.has(saveId)) {
        throw new SaveStoreError('notFound', `No snapshot "${saveId}" to replace.`);
      }
      snapshots.set(saveId, document);
    },

    dropSnapshot(saveId: string): void {
      snapshots.delete(saveId);
    },
  };
}
