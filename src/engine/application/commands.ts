import { createCampaign, type CampaignState } from '@engine/domain';
import { advanceTime, type BoundaryResolvers } from '@engine/simulation';
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
 * This phase implements the clock and the queue, not a gameplay system, so
 * nothing is registered yet. A queued boundary with no resolver is reported
 * as `scheduler.boundaryUnhandled` rather than dropped, and each later phase
 * registers the kinds it owns.
 */
export const INSTALLED_BOUNDARY_RESOLVERS: BoundaryResolvers = {};

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
  });

  transaction.openCampaign(state);
  transaction.publish('campaign.created', { campaignId: state.campaignId });
  transaction.invalidate('session');
  transaction.invalidate('frame');
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
  );

  return outcome.changed ? APPLIED : UNCHANGED;
}

function baseRate(transaction: Transaction): number {
  const rates = [...transaction.content.rules.time.timeRates].sort((a, b) => a - b);
  return rates[0] ?? 1;
}
