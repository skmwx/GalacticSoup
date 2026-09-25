import { InventoryError, type CampaignState } from '@engine/domain';
import { handleFittingCommand } from './fittingCommands';
import { handleInventoryCommand } from './inventoryCommands';
import type { ContentRepository } from '@engine/ports';
import {
  type AdvanceTimePayload,
  type CommandResultData,
  type CommandType,
  type CreateCampaignPayload,
  type EngineError,
  type SetTimePayload,
  internalError,
  invariantFailure,
  NO_CAMPAIGN_REVISION,
  ruleViolation,
} from '@protocol';

import {
  handleAdvanceTime,
  handleCloseCampaign,
  handleCreateCampaign,
  handleResetCampaign,
  handleResumeCampaign,
  handleSetTime,
  type ResumeCampaignInput,
} from './commands';
import {
  beginTransaction,
  commit,
  InvariantFailure,
  type CommandOutcome,
  type CommitResult,
  type Transaction,
} from './transaction';
import { handleCombatCommand } from './combatCommands';
import { handleEncounterCommand } from './encounterCommands';
import { handleEconomyCommand } from './economyCommands';
import { handleNavigationCommand } from './navigationCommands';

/**
 * The command pipeline (Technical Specification 7.2).
 *
 * One command at a time runs the specified steps in order: the envelope and
 * payload were validated by the protocol, the campaign and expected revision
 * were verified by the host, and what remains happens here - preconditions,
 * apply to the draft, validate invariants, commit and increment the revision
 * once, then publish events and invalidations with the result.
 *
 * Nothing outside a committed transaction changes: a rejected command, an
 * invariant failure and an unexpected defect all leave state, revision,
 * ordinals and random streams untouched.
 *
 * @implements TECH-7.2
 */

export interface CommandRequest {
  readonly campaign: CampaignState | null;
  readonly content: ContentRepository;
  readonly type: CommandType;
  readonly payload: unknown;
}

export type CommandResult =
  | {
      readonly kind: 'committed';
      readonly campaign: CampaignState | null;
      readonly data: CommandResultData;
      /** The command asked for a snapshot; the host decides who takes it. */
      readonly autosaveRequested: boolean;
    }
  | { readonly kind: 'unchanged'; readonly data: CommandResultData }
  | { readonly kind: 'failed'; readonly error: EngineError };

export function runCommand(request: CommandRequest): CommandResult {
  const transaction = beginTransaction(request.campaign, request.content);

  let outcome: CommandOutcome;
  try {
    outcome = apply(transaction, request);
  } catch (error: unknown) {
    return { kind: 'failed', error: describeDefect(error) };
  }

  if (outcome.kind === 'rejected') {
    return { kind: 'failed', error: outcome.error };
  }

  if (outcome.kind === 'unchanged') {
    return { kind: 'unchanged', data: unchangedResult(request.campaign) };
  }

  let committed: CommitResult;
  try {
    committed = commit(transaction);
  } catch (error: unknown) {
    return { kind: 'failed', error: describeDefect(error) };
  }

  return {
    kind: 'committed',
    campaign: committed.campaign,
    autosaveRequested: committed.autosaveRequested,
    data: {
      campaignId: committed.campaign?.campaignId ?? null,
      revision: committed.campaign?.revision ?? NO_CAMPAIGN_REVISION,
      simulationTimeMs: committed.campaign?.time.simulationTimeMs ?? 0,
      committed: true,
      autosaveRequested: committed.autosaveRequested,
      invalidations: [...committed.invalidations],
      events: committed.events.map((event) => ({ ...event })),
    },
  };
}

function apply(transaction: Transaction, request: CommandRequest): CommandOutcome {
  switch (request.type) {
    case 'navigation.selectDestination':
    case 'ship.undock':
    case 'movement.approach':
    case 'movement.orbit':
    case 'movement.keepRange':
    case 'movement.moveToPoint':
    case 'movement.stop':
    case 'navigation.warp':
    case 'navigation.retreat':
    case 'navigation.dock':
    case 'navigation.selectBookmark':
    case 'navigation.warpToBookmark':
      return handleNavigationCommand(transaction, request.type, request.payload);
    case 'targeting.lock':
    case 'targeting.unlock':
    case 'module.activate':
    case 'module.deactivate':
    case 'weapon.activate':
    case 'weapon.deactivate':
    case 'weapon.reload':
    case 'weapon.changeAmmunition':
      return handleCombatCommand(transaction, request.type, request.payload);
    case 'market.confirmBuy':
    case 'market.confirmSell':
    case 'repair.confirm':
    case 'resupply.confirm':
    case 'insurance.confirm':
      return handleEconomyCommand(transaction, request.type, request.payload);
    case 'fitting.begin':
    case 'fitting.set':
    case 'fitting.clear':
    case 'fitting.revert':
    case 'fitting.commit':
      return handleFittingCommand(transaction, request.type, request.payload);
    case 'inventory.transfer':
    case 'inventory.split':
    case 'inventory.merge':
      return handleInventoryCommand(transaction, request.type, request.payload);
    case 'loot.take':
      return handleEncounterCommand(transaction, request.type, request.payload);
    case 'campaign.create':
      return handleCreateCampaign(transaction, request.payload as CreateCampaignPayload);
    case 'campaign.reset':
      return handleResetCampaign(transaction);
    case 'campaign.close':
      return handleCloseCampaign(transaction);
    case 'campaign.resume':
      return handleResumeCampaign(transaction, request.payload as ResumeCampaignInput);
    case 'time.set':
      return handleSetTime(transaction, request.payload as SetTimePayload);
    case 'time.advance':
      return handleAdvanceTime(transaction, request.payload as AdvanceTimePayload);
    default:
      return assertUnreachable(request.type);
  }
}

function unchangedResult(campaign: CampaignState | null): CommandResultData {
  return {
    campaignId: campaign?.campaignId ?? null,
    revision: campaign?.revision ?? NO_CAMPAIGN_REVISION,
    simulationTimeMs: campaign?.time.simulationTimeMs ?? 0,
    committed: false,
    autosaveRequested: false,
    invalidations: [],
    events: [],
  };
}

/**
 * An invariant failure is a defect in the rules, not a player mistake. The
 * transaction is abandoned, the previous state stands, and the failing rule
 * and path are reported so the problem is diagnosable
 * (Technical Specification 5.4, 15.3).
 */
function describeDefect(error: unknown): EngineError {
  // An inventory refusal is an expected, explainable outcome - a hold that is
  // too small, a stack that no longer holds that many units - not a defect
  // (Functional Specification 22.2, 22.10).
  if (error instanceof InventoryError) {
    return ruleViolation(error.reason);
  }
  if (error instanceof InvariantFailure) {
    const first = error.issues[0];
    return invariantFailure({
      count: error.issues.length,
      rule: first?.rule ?? 'unknown',
      path: first?.path ?? '',
    });
  }
  return internalError({ stage: 'command' });
}

function assertUnreachable(type: never): never {
  throw new Error(`Unhandled command type: ${String(type)}`);
}
