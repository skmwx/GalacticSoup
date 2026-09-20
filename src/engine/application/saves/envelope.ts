import type { CampaignState } from '@engine/domain';
import {
  SAVE_FORMAT_VERSION,
  type ContentIdentity,
  type SaveEnvelope,
  type SaveKind,
} from '@engine/ports';
import { canonicalJson, deepClone, sha256Hex } from '@shared';

/**
 * The save envelope (Technical Specification 11.2).
 *
 * A save is a self-describing, self-verifying JSON document: what wrote it,
 * what content it was written against, which campaign and revision it holds,
 * and a digest over everything else in it. Sealing happens here and nowhere
 * else, so the bytes a store writes and the bytes a loader verifies are
 * produced by one function.
 *
 * The checksum detects accidental corruption and incomplete copies. It is not
 * presented as protection against deliberate save editing.
 *
 * @implements TECH-11.2
 */

export interface CaptureInput {
  readonly campaign: CampaignState;
  readonly content: ContentIdentity;
  readonly engineVersion: string;
  readonly protocolVersion: number;
  readonly slotId: string;
  readonly kind: SaveKind;
  /** Per-slot monotonic capture counter. */
  readonly sequence: number;
  /** Wall clock at capture, for display only. */
  readonly savedAtRealMs: number;
}

/** The identifier a snapshot is stored under. Unique within a slot. */
export function saveIdOf(slotId: string, kind: SaveKind, sequence: number): string {
  return `${slotId}:${kind}:${String(sequence)}`;
}

/**
 * Captures the open campaign as a sealed envelope.
 *
 * The payload is a deep copy, so the envelope cannot be changed by later
 * simulation and the store cannot reach back into campaign state. Runtime
 * caches, projections and wall-clock deltas are not part of `CampaignState`
 * and therefore cannot be copied here by accident.
 */
export function captureSnapshot(input: CaptureInput): SaveEnvelope {
  const unsealed = {
    format: 'galactic-soup/save',
    formatVersion: SAVE_FORMAT_VERSION,
    protocolVersion: input.protocolVersion,
    engineVersion: input.engineVersion,
    contentVersion: input.content.contentVersion,
    contentHash: input.content.contentHash,
    slotId: input.slotId,
    saveId: saveIdOf(input.slotId, input.kind, input.sequence),
    campaignId: input.campaign.campaignId,
    displayName: input.campaign.displayName,
    kind: input.kind,
    sequence: input.sequence,
    revision: input.campaign.revision,
    simulationTimeMs: input.campaign.time.simulationTimeMs,
    savedAtRealMs: input.savedAtRealMs,
    state: deepClone(input.campaign) as unknown as Record<string, unknown>,
  } as const satisfies Omit<SaveEnvelope, 'checksum'>;

  return { ...unsealed, checksum: envelopeChecksum(unsealed) };
}

/**
 * SHA-256 over the canonical form of every envelope field except the checksum
 * itself. Canonical serialisation sorts keys and normalises numbers, so the
 * digest does not depend on the order a JavaScript object happens to carry and
 * a second implementation of the same format reproduces it.
 */
export function envelopeChecksum(envelope: Omit<SaveEnvelope, 'checksum'>): string {
  return sha256Hex(canonicalJson(envelope as unknown as Record<string, unknown>));
}

/** True when the envelope's digest matches the envelope it is attached to. */
export function isSealed(envelope: SaveEnvelope): boolean {
  const { checksum, ...fields } = envelope;
  return envelopeChecksum(fields) === checksum;
}

