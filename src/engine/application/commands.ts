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
  });

  transaction.openCampaign(state);
  transaction.publish('campaign.created', { campaignId: state.campaignId });
  transaction.invalidate('session');
  transaction.invalidate('frame');
  transaction.invalidate('saves');
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
