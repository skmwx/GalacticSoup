import type { StructuralLimits } from '@shared';

/**
 * The save-store port (Technical Specification 4.1, 11).
 *
 * The engine owns save orchestration: it decides when a snapshot is captured,
 * seals it, and asks this port to store it. The port knows nothing about game
 * rules - it stores the envelope it was given, rotates according to the
 * retention policy it was told, and never infers or repairs anything
 * (Technical Specification 4.1, rule 5).
 *
 * Every operation is asynchronous because the only real implementation is
 * IndexedDB. Failures are reported as `SaveStoreError`, never as a silent
 * partial write: a failed write must leave the previous manifest and snapshots
 * intact (Technical Specification 11.1).
 *
 * @implements TECH-11.1
 */

/** Shape version of the save envelope (Technical Specification 11.2). */
export const SAVE_FORMAT_VERSION = 10;

/** Identifier of the single campaign slot the MVP exposes (MVP Scope 6). */
export const DEFAULT_SLOT_ID = 'slot-1';

export const SAVE_KINDS = ['auto', 'manual'] as const;

export type SaveKind = (typeof SAVE_KINDS)[number];

export function isSaveKind(value: unknown): value is SaveKind {
  return typeof value === 'string' && (SAVE_KINDS as readonly string[]).includes(value);
}

/**
 * How many snapshots of each kind a slot keeps
 * (Functional Specification 3.4; Technical Specification 11.1).
 */
export interface SaveRetention {
  readonly autosaves: number;
  readonly manual: number;
}

export const DEFAULT_SAVE_RETENTION: SaveRetention = { autosaves: 5, manual: 1 };

/**
 * Bounds applied to a stored envelope before it becomes domain state
 * (Technical Specification 14). A save is untrusted at its boundary even when
 * this browser wrote it.
 */
export const SAVE_LIMITS: StructuralLimits & { readonly maxTotalBytes: number } = {
  maxTotalBytes: 33_554_432,
  maxDepth: 32,
  maxStringLength: 4_096,
  maxArrayLength: 65_536,
  maxObjectKeys: 8_192,
};

/**
 * A stored save (Technical Specification 11.2).
 *
 * `checksum` covers the canonical form of every other field, so the envelope
 * is self-describing and self-verifying. It detects accidental corruption and
 * incomplete copies; it is not protection against deliberate save editing.
 */
export interface SaveEnvelope {
  /** Distinguishes a Galactic Soup save from any other JSON document. */
  readonly format: 'galactic-soup/save';
  readonly formatVersion: number;
  readonly protocolVersion: number;
  readonly engineVersion: string;
  readonly contentVersion: string;
  readonly contentHash: string;
  readonly slotId: string;
  readonly saveId: string;
  readonly campaignId: string;
  readonly displayName: string;
  readonly kind: SaveKind;
  /** Per-slot monotonic capture counter; orders rotation. */
  readonly sequence: number;
  readonly revision: number;
  readonly simulationTimeMs: number;
  /** Wall clock at capture, for display only. No rule may read it. */
  readonly savedAtRealMs: number;
  /** The canonical authoritative payload. */
  readonly state: Record<string, unknown>;
  readonly checksum: string;
}

/** What a manifest records about one stored save. */
export interface SaveSummary {
  readonly saveId: string;
  readonly campaignId: string;
  readonly displayName: string;
  readonly kind: SaveKind;
  readonly sequence: number;
  readonly revision: number;
  readonly simulationTimeMs: number;
  readonly savedAtRealMs: number;
  readonly formatVersion: number;
  readonly contentVersion: string;
  readonly contentHash: string;
}

/**
 * The slot manifest (Technical Specification 11.1). `saves` is ordered newest
 * first, so the resumable save is always the first entry.
 */
export interface SlotManifest {
  readonly slotId: string;
  readonly campaignId: string | null;
  readonly updatedAtRealMs: number;
  readonly saves: readonly SaveSummary[];
}

/** The manifest entry for a sealed envelope. */
export function summaryOf(envelope: SaveEnvelope): SaveSummary {
  return {
    saveId: envelope.saveId,
    campaignId: envelope.campaignId,
    displayName: envelope.displayName,
    kind: envelope.kind,
    sequence: envelope.sequence,
    revision: envelope.revision,
    simulationTimeMs: envelope.simulationTimeMs,
    savedAtRealMs: envelope.savedAtRealMs,
    formatVersion: envelope.formatVersion,
    contentVersion: envelope.contentVersion,
    contentHash: envelope.contentHash,
  };
}

export interface SaveWriteRequest {
  readonly envelope: SaveEnvelope;
  readonly retention: SaveRetention;
}

/** What the store can say about the space it has (Technical Specification 11.1). */
export interface StorageReport {
  /** `null` when the browser does not answer. */
  readonly persistent: boolean | null;
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
}

export type SaveStoreErrorReason =
  | 'unavailable'
  | 'quota'
  | 'writeFailed'
  | 'readFailed'
  | 'notFound';

export class SaveStoreError extends Error {
  readonly reason: SaveStoreErrorReason;
  readonly slotId: string | null;

  constructor(reason: SaveStoreErrorReason, message: string, slotId: string | null = null) {
    super(message);
    this.name = 'SaveStoreError';
    this.reason = reason;
    this.slotId = slotId;
  }
}

export interface SaveStore {
  /** Which implementation is in use, for diagnostics only. */
  readonly backend: string;

  readManifest(slotId: string): Promise<SlotManifest | null>;

  /**
   * Reads one stored envelope. The value is returned exactly as it was found,
   * without validation: verifying it is the engine's job.
   */
  readSave(slotId: string, saveId: string): Promise<unknown | null>;

  /**
   * Writes one snapshot and applies the retention policy in a single atomic
   * operation, returning the manifest that resulted. A failure leaves the
   * previous manifest and snapshots untouched.
   */
  write(request: SaveWriteRequest): Promise<SlotManifest>;

  /** Removes the slot's manifest and every snapshot it holds. */
  clearSlot(slotId: string): Promise<void>;

  /** Best-effort space report; never throws. */
  estimate(): Promise<StorageReport>;

  /**
   * Asks the browser to keep this origin's storage. Returns what the browser
   * said, or `null` when it does not support the request.
   */
  requestPersistence(): Promise<boolean | null>;
}
