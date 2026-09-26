import { canonicalJson, deepClone, sha256Hex, type Mutable } from '@shared';
import type { ContentRepository } from '@engine/ports';
import { startingAssets } from '../assets/start';
import type { AssetState } from '../assets/types';
import type { FittingDraft } from '../fitting/types';
import { startingEconomy } from '../economy/state';
import type { EconomyState } from '../economy/types';
import { startingNavigation } from '../navigation/start';
import type { NavigationState } from '../navigation/types';
import { startingCombat } from '../combat/start';
import type { CombatState } from '../combat/types';
import { startingEncounters } from '../encounter/start';
import type { EncounterState } from '../encounter/types';
import { startingRecovery } from '../recovery/start';
import type { RecoveryState } from '../recovery/types';
import { startingOnboarding } from '../guidance/start';
import type { OnboardingState } from '../guidance/types';
import { startingNotifications } from '../notifications/start';
import type { NotificationState } from '../notifications/types';

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
export const CAMPAIGN_STATE_VERSION = 10;

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
  readonly assets: AssetState;
  /**
   * Locks, weapon cycles and reloads of every ship that holds them
   * (Functional Specification 9.2, 9.4). A docked campaign holds none.
   */
  readonly combat: CombatState;
  readonly economy: EconomyState;
  /**
   * The authored encounter the player is inside, the wrecks it left behind and
   * what has already been rewarded (Functional Specification 9.10-9.11).
   */
  readonly encounter: EncounterState;
  /**
   * The fitting draft the player has open, or `null` when none is
   * (Functional Specification 8.4-8.5). It is authoritative: closing the game
   * with a draft open must not lose it, and reverting must restore the fit the
   * ship wore when the draft was opened.
   */
  readonly fitting: FittingDraft | null;
  readonly navigation: NavigationState;
  /**
   * What the engine has told the player: a bounded, grouped history that is
   * also the event log (Functional Specification 19.7, 20).
   */
  readonly notifications: NotificationState;
  /**
   * The player's progress through the contextual guidance
   * (Functional Specification 3.2; MVP Scope 6).
   */
  readonly onboarding: OnboardingState;
  /**
   * The last loss and how the player was recovered from it
   * (Functional Specification 9.12).
   */
  readonly recovery: RecoveryState;
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
export function createCampaign(input: CreateCampaignInput, content: ContentRepository): CampaignState {
  const campaignId = deriveCampaignId(input.seed);
  const starting = startingAssets(campaignId, content);
  return {
    assets: starting.assets,
    combat: startingCombat(),
    economy: startingEconomy(content),
    encounter: startingEncounters(),
    fitting: null,
    navigation: startingNavigation(content),
    notifications: startingNotifications(),
    onboarding: startingOnboarding(),
    recovery: startingRecovery(),
    stateVersion: CAMPAIGN_STATE_VERSION,
    campaignId,
    displayName: input.displayName,
    seed: input.seed,
    createdAtRealMs: input.createdAtRealMs,
    revision: 0,
    nextEntityOrdinal: starting.nextEntityOrdinal,
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
