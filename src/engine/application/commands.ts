import { createCampaign, type CampaignState } from '@engine/domain';
import {
  advanceCombat,
  advanceEncounter,
  advanceNavigation,
  advanceTime,
  DOCK_COMPLETE_BOUNDARY,
  LOCK_COMPLETE_BOUNDARY,
  MODULE_CYCLE_BOUNDARY,
  RELOAD_COMPLETE_BOUNDARY,
  resolveLockComplete,
  resolveModuleCycle,
  resolveReloadComplete,
  resolveWeaponCycle,
  WEAPON_CYCLE_BOUNDARY,
  NPC_DECISION_BOUNDARY,
  resolveDockComplete,
  resolveEconomyHour,
  resolveNpcDecision,
  resolveWreckExpiry,
  WRECK_EXPIRE_BOUNDARY,
  resolveWarpArrival,
  resolveWarpPrepared,
  scheduleBoundary,
  WARP_ARRIVAL_BOUNDARY,
  WARP_PREPARED_BOUNDARY,
  type BoundaryResolvers,
  type ContinuousSystem,
} from '@engine/simulation';
import type { AdvanceTimePayload, CreateCampaignPayload, SetTimePayload } from '@protocol';

import {
  APPLIED,
  reject,
  UNCHANGED,
  type CommandOutcome,
  type Transaction,
} from './transaction';

/**
 * The campaign and time-control command family
 * (Technical Specification 7.2; Functional Specification 3.1, 3.3).
 *
 * A handler evaluates preconditions, changes the draft and says what it did.
 * It never writes state directly, never reads a real clock and never decides
 * the revision: the transaction owns all three.
 *
 * @implements TECH-7.2, FUNC-3.1, FUNC-3.3, FUNC-22.10, FUNC-22.13, MVP-AC-01
 */

/**
 * Boundary resolvers installed in the shipped engine.
 *
 * Domain event kinds stay outside the scheduler; each system registers its
 * resolver here. A queued boundary with no resolver is reported as
 * `scheduler.boundaryUnhandled` rather than dropped.
 */
export const INSTALLED_BOUNDARY_RESOLVERS: BoundaryResolvers = {
  'economy.hour': resolveEconomyHour,
  [WARP_PREPARED_BOUNDARY]: resolveWarpPrepared,
  [WARP_ARRIVAL_BOUNDARY]: resolveWarpArrival,
  [DOCK_COMPLETE_BOUNDARY]: resolveDockComplete,
  [LOCK_COMPLETE_BOUNDARY]: resolveLockComplete,
  [MODULE_CYCLE_BOUNDARY]: resolveModuleCycle,
  [WEAPON_CYCLE_BOUNDARY]: resolveWeaponCycle,
  [RELOAD_COMPLETE_BOUNDARY]: resolveReloadComplete,
  [NPC_DECISION_BOUNDARY]: resolveNpcDecision,
  [WRECK_EXPIRE_BOUNDARY]: resolveWreckExpiry,
};

/**
 * Continuously integrated systems, in the order Technical Specification 9.2
 * requires: movement, then combat, then the encounter transitions the last
 * completion batch caused.
 */
export const INSTALLED_CONTINUOUS_SYSTEMS: readonly ContinuousSystem[] = [
  advanceNavigation,
  advanceCombat,
  advanceEncounter,
];

/**
 * The internal payload of `campaign.resume`. The protocol request carries no
 * arguments; the host loads and validates the snapshot and passes the campaign
 * it produced to the handler.
 */
export interface ResumeCampaignInput {
  readonly state: CampaignState;
}

export function handleCreateCampaign(
  transaction: Transaction,
  payload: CreateCampaignPayload,
): CommandOutcome {
  if (transaction.draft !== null) {
    return reject('campaignAlreadyOpen');
  }

  const state: CampaignState = createCampaign({
    displayName: payload.displayName.trim(),
    seed: payload.seed,
    createdAtRealMs: payload.createdAtRealMs,
    initialRate: baseRate(transaction),
  }, transaction.content);

  transaction.openCampaign(state);
  scheduleBoundary(transaction.requireDraft(), { kind: 'economy.hour', dueAtMs: 3_600_000 });
  transaction.publish('campaign.created', { campaignId: state.campaignId });
  transaction.invalidate('session');
  transaction.invalidate('frame');
  transaction.invalidate('saves');
  transaction.invalidate('assets');
  transaction.invalidate('inventory');
  transaction.invalidate('wallet');
  transaction.invalidate('ship');
  transaction.invalidate('fitting');
  transaction.invalidate('station');
  transaction.invalidate('market');
  transaction.invalidate('repair');
  transaction.invalidate('resupply');
  transaction.invalidate('insurance');
  transaction.invalidate('navigation');
  transaction.invalidate('site');
  transaction.invalidate('destinations');
  transaction.invalidate('combat');
  // A new campaign must be resumable before the player touches anything
  // (Functional Specification 3.4).
  transaction.requestAutosave();
  return APPLIED;
}

/**
 * Installs a snapshot that has already been validated by the load pipeline.
 *
 * The payload is domain state rather than protocol data: `campaign.resume`
 * carries no arguments, and the host substitutes the campaign it loaded from
 * the store. Restoring consumes neither a revision nor an event ordinal and
 * publishes no event, so a resumed campaign hashes identically to the snapshot
 * it came from (Technical Specification 9.5).
 */
export function handleResumeCampaign(
  transaction: Transaction,
  payload: ResumeCampaignInput,
): CommandOutcome {
  if (transaction.draft !== null) {
    return reject('campaignAlreadyOpen');
  }

  transaction.restoreCampaign(payload.state);
  transaction.invalidate('session');
  transaction.invalidate('frame');
  transaction.invalidate('saves');
  transaction.invalidate('assets');
  transaction.invalidate('inventory');
  transaction.invalidate('wallet');
  transaction.invalidate('ship');
  transaction.invalidate('fitting');
  transaction.invalidate('station');
  transaction.invalidate('market');
  transaction.invalidate('repair');
  transaction.invalidate('resupply');
  transaction.invalidate('insurance');
  transaction.invalidate('navigation');
  transaction.invalidate('site');
  transaction.invalidate('destinations');
  transaction.invalidate('combat');
  return APPLIED;
}

/**
 * Stops playing. The campaign leaves the session but its snapshots remain, so
 * it can be resumed later; discarding it is `campaign.reset`
 * (MVP Scope section 3).
 */
export function handleCloseCampaign(transaction: Transaction): CommandOutcome {
  const draft = transaction.draft;
  if (draft === null) {
    return reject('noCampaignOpen');
  }

  transaction.publish('campaign.closed', { campaignId: draft.campaignId });
  transaction.closeCampaign();
  transaction.invalidate('session');
  transaction.invalidate('frame');
  transaction.invalidate('saves');
  transaction.invalidate('assets');
  transaction.invalidate('inventory');
  transaction.invalidate('wallet');
  transaction.invalidate('ship');
  transaction.invalidate('fitting');
  transaction.invalidate('station');
  transaction.invalidate('market');
  transaction.invalidate('repair');
  transaction.invalidate('resupply');
  transaction.invalidate('insurance');
  transaction.invalidate('navigation');
  transaction.invalidate('site');
  transaction.invalidate('destinations');
  transaction.invalidate('combat');
  return APPLIED;
}

/**
 * Discards the open campaign. Reset is not the same as closing: closing keeps
 * the campaign so it can be resumed, while reset ends it
 * (MVP Scope section 3).
 */
export function handleResetCampaign(transaction: Transaction): CommandOutcome {
  const draft = transaction.draft;
  if (draft === null) {
    return reject('noCampaignOpen');
  }

  transaction.publish('campaign.reset', { campaignId: draft.campaignId });
  transaction.closeCampaign();
  transaction.invalidate('session');
  transaction.invalidate('frame');
  transaction.invalidate('saves');
  transaction.invalidate('assets');
  transaction.invalidate('inventory');
  transaction.invalidate('wallet');
  transaction.invalidate('ship');
  transaction.invalidate('fitting');
  transaction.invalidate('station');
  transaction.invalidate('market');
  transaction.invalidate('repair');
  transaction.invalidate('resupply');
  transaction.invalidate('insurance');
  transaction.invalidate('navigation');
  transaction.invalidate('site');
  transaction.invalidate('destinations');
  transaction.invalidate('combat');
  return APPLIED;
}

/**
 * Selects pause or a play rate. Pause is available at all times and cannot be
 * disabled by any game state (Functional Specification 22.13), and pausing
 * leaves the selected rate alone so resuming returns to it.
 */
export function handleSetTime(
  transaction: Transaction,
  payload: SetTimePayload,
): CommandOutcome {
  const draft = transaction.draft;
  if (draft === null) {
    return reject('noCampaignOpen');
  }

  const rates = transaction.content.rules.time.timeRates;
  if (!rates.includes(payload.rate)) {
    return reject('unsupportedTimeRate', { rate: payload.rate });
  }

  if (draft.time.paused === payload.paused && draft.time.rate === payload.rate) {
    return UNCHANGED;
  }

  draft.time.paused = payload.paused;
  draft.time.rate = payload.rate;
  transaction.publish('time.settingChanged', { paused: payload.paused, rate: payload.rate });
  transaction.invalidate('session');
  transaction.invalidate('frame');
  return APPLIED;
}

/**
 * Folds one elapsed real delta into simulation time. Time that the browser did
 * not deliver is never replayed, so a suspended tab and a closed game both
 * produce exactly no progress (Functional Specification 22.12).
 */
export function handleAdvanceTime(
  transaction: Transaction,
  payload: AdvanceTimePayload,
): CommandOutcome {
  if (transaction.draft === null) {
    return reject('noCampaignOpen');
  }

  const outcome = advanceTime(
    transaction.simulation(),
    payload.elapsedRealMs,
    INSTALLED_BOUNDARY_RESOLVERS,
    INSTALLED_CONTINUOUS_SYSTEMS,
  );

  return outcome.changed ? APPLIED : UNCHANGED;
}

function baseRate(transaction: Transaction): number {
  const rates = [...transaction.content.rules.time.timeRates].sort((a, b) => a - b);
  return rates[0] ?? 1;
}
