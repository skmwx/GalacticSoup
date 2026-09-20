import {
  summaryOf,
  type SaveEnvelope,
  type SaveKind,
  type SaveRetention,
  type SaveSummary,
  type SlotManifest,
} from '@engine/ports';
import { compareStable } from '@shared';

/**
 * Save rotation (Technical Specification 11.1).
 *
 * A slot keeps a rolling set of autosaves and one replaceable manual save.
 * Deciding what survives a write is a pure function of the manifest, the new
 * snapshot and the retention policy, so both stores share it and it can be
 * proved without a browser. Applying the plan is the store's job and must
 * happen in one transaction: write and verify the new snapshot, update the
 * manifest, then delete the excess.
 *
 * @implements TECH-11.1
 */

export interface WritePlan {
  /** The manifest as it will be after the write. Newest save first. */
  readonly manifest: SlotManifest;
  /** Snapshots the write must delete, after the manifest no longer names them. */
  readonly removeIds: readonly string[];
}

export function planWrite(
  existing: SlotManifest | null,
  envelope: SaveEnvelope,
  retention: SaveRetention,
): WritePlan {
  const summary = summaryOf(envelope);
  const slotId = envelope.slotId;

  // A slot holds one campaign. Writing a different campaign into it replaces
  // what was there rather than mixing two histories.
  const previous =
    existing === null || existing.campaignId === null || existing.campaignId === summary.campaignId
      ? (existing?.saves ?? [])
      : [];
  const displaced = existing === null ? [] : existing.saves.filter((save) => !previous.includes(save));

  const withoutSame = previous.filter((save) => save.saveId !== summary.saveId);
  const ordered = [summary, ...withoutSame].sort(byNewestFirst);

  const kept: SaveSummary[] = [];
  const removed: SaveSummary[] = [];
  const room: Record<SaveKind, number> = {
    auto: Math.max(0, retention.autosaves),
    manual: Math.max(0, retention.manual),
  };

  for (const save of ordered) {
    if (room[save.kind] > 0) {
      room[save.kind] -= 1;
      kept.push(save);
    } else {
      removed.push(save);
    }
  }

  return {
    manifest: {
      slotId,
      campaignId: summary.campaignId,
      updatedAtRealMs: summary.savedAtRealMs,
      saves: kept,
    },
    // Sorted so a plan is a value: two runs of the same write produce the
    // same removals in the same order.
    removeIds: [...removed, ...displaced]
      .map((save) => save.saveId)
      .filter((saveId) => saveId !== summary.saveId)
      .sort(compareStable),
  };
}

/**
 * Newest first. The per-slot sequence is monotonic, so it orders captures even
 * when two snapshots share a revision or a wall-clock millisecond.
 */
function byNewestFirst(a: SaveSummary, b: SaveSummary): number {
  return b.sequence - a.sequence;
}
