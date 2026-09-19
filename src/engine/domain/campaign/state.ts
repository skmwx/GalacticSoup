import { canonicalJson, deepClone, sha256Hex, type Mutable } from '@shared';

import { deriveCampaignId, type CampaignId } from './identity';
import { emptyScheduler, type SchedulerState } from './scheduler';
import { seedStreams, type RandomStreams } from '../random/streams';

/**
 * The campaign aggregate (Technical Specification 8.1).
 *
 * `CampaignState` is the root of every authoritative mutable value. It is
 * plain JSON data: no class instances, no host objects, no derived caches. A
 * later phase adds its own fields to it rather than keeping state elsewhere,
 * and the save format version below moves with the shape.
 *
 * Large immutable definitions stay in the content repository. State stores
 * definition ids, so a content update reaches an existing campaign without a
 * migration.
 *
 * @implements TECH-8.1
 */

/** Shape version of the authoritative payload, carried by every snapshot. */
export const CAMPAIGN_STATE_VERSION = 1;

/** Upper bound on simulation time, about 31 simulated years. */
export const MAX_SIMULATION_TIME_MS = 1_000_000_000_000;

export const MAX_DISPLAY_NAME_LENGTH = 48;

export interface TimeState {
  /** Monotonic simulation clock in whole milliseconds. */
  readonly simulationTimeMs: number;
  readonly paused: boolean;
  /** The rate the player selected. Pausing does not change it. */
  readonly rate: number;
  /** Real time already converted to simulation time but below one quantum. */
  readonly accumulatorMs: number;
}

export interface CampaignState {
  readonly stateVersion: number;
  readonly campaignId: CampaignId;
  readonly displayName: string;
  /** Client-supplied randomness the campaign's identity and streams derive from. */
  readonly seed: string;
  /**
   * Wall-clock creation time, for display in a save list only. It is excluded
   * from the authoritative hash and no rule may read it
   * (Technical Specification 9.5).
   */
  readonly createdAtRealMs: number;
  readonly revision: number;
  readonly nextEntityOrdinal: number;
  readonly nextEventOrdinal: number;
  readonly time: TimeState;
  readonly random: RandomStreams;
  readonly scheduler: SchedulerState;
}

/** A campaign state a transaction may mutate before it commits. */
export type CampaignDraft = Mutable<CampaignState>;

export interface CreateCampaignInput {
  readonly displayName: string;
  readonly seed: string;
  readonly createdAtRealMs: number;
  /** The rate a new campaign starts at; the MVP offers 1x only. */
  readonly initialRate: number;
}

/**
 * The starting campaign. Revision 0 is the uncommitted value: the creating
 * transaction commits it as revision 1, exactly as it does for every later
 * change, so no command has a special revision rule.
 *
 * A new campaign starts paused. Simulation time never advances while the
 * player has not asked for it (Functional Specification 3.3).
 */
export function createCampaign(input: CreateCampaignInput): CampaignState {
  return {
    stateVersion: CAMPAIGN_STATE_VERSION,
    campaignId: deriveCampaignId(input.seed),
    displayName: input.displayName,
    seed: input.seed,
    createdAtRealMs: input.createdAtRealMs,
    revision: 0,
    nextEntityOrdinal: 1,
    nextEventOrdinal: 1,
    time: {
      simulationTimeMs: 0,
      paused: true,
      rate: input.initialRate,
      accumulatorMs: 0,
    },
    random: seedStreams(input.seed),
    scheduler: emptyScheduler(),
  };
}

export function draftOf(state: CampaignState): CampaignDraft {
  return deepClone(state);
}

/**
 * The authoritative view of a campaign: everything a rule may read, and
 * nothing a rule may not. Real creation time is excluded, so two campaigns
 * created from the same seed and driven by the same commands hash identically
 * however long apart they were started (Technical Specification 9.5).
 */
export function authoritativeView(state: CampaignState): Record<string, unknown> {
  const { createdAtRealMs: _excluded, ...authoritative } = state;
  void _excluded;
  return authoritative;
}

/**
 * The canonical state hash used by replay checkpoints and by save-integrity
 * comparison. It is a SHA-256 over the canonical JSON profile, which orders
 * keys, normalises negative zero and rejects non-finite numbers, so a second
 * implementation of the same rules produces the same digest.
 *
 * @implements TECH-9.5
 */
export function campaignStateHash(state: CampaignState): string {
  return sha256Hex(canonicalJson(authoritativeView(state)));
}
