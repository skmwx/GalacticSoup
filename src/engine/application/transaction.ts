import {
  allocateEventOrdinal,
  draftOf,
  validateCampaign,
  type CampaignDraft,
  type CampaignState,
  type DomainEvent,
  type DomainEventKind,
  type DomainEventParams,
  type InvariantIssue,
  type ProjectionTopic,
} from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type { SimulationContext } from '@engine/simulation';
import {
  ruleViolation,
  type EngineError,
  type ErrorParams,
  type RuleViolationReason,
} from '@protocol';
import { deepFreeze } from '@shared';

/**
 * Transaction-local drafts and commit (Technical Specification 7.2).
 *
 * A command applies its change to a deep copy of campaign state. Nothing the
 * command touched is visible until the transaction commits, so a rule failure,
 * an invariant failure or a thrown defect all leave the previous state, the
 * revision, the ordinals and the random streams exactly as they were.
 *
 * Commit is the only place a revision is consumed, and it happens once per
 * committed command however many aggregates the command spanned.
 *
 * @implements TECH-7.2
 */

/** What a command decided. Only `applied` reaches commit. */
export type CommandOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rejected'; readonly error: EngineError };

export const APPLIED: CommandOutcome = { kind: 'applied' };
export const UNCHANGED: CommandOutcome = { kind: 'unchanged' };

/**
 * Refuses a well-formed command the rules do not permit. Every reason carries
 * a message key, because the interface must be able to say why a command is
 * unavailable (Functional Specification 22.10).
 */
export function reject(reason: RuleViolationReason, params?: ErrorParams): CommandOutcome {
  return { kind: 'rejected', error: ruleViolation(reason, params) };
}

export class InvariantFailure extends Error {
  readonly issues: readonly InvariantIssue[];

  constructor(issues: readonly InvariantIssue[]) {
    super(`The transaction violated ${String(issues.length)} campaign invariant(s).`);
    this.name = 'InvariantFailure';
    this.issues = issues;
  }
}

export class NoCampaignError extends Error {
  constructor() {
    super('The command needs an open campaign.');
    this.name = 'NoCampaignError';
  }
}

export interface Transaction {
  /** The draft being changed, or `null` while no campaign is open. */
  readonly draft: CampaignDraft | null;
  readonly content: ContentRepository;
  /** The draft, or a thrown defect: callers check for a campaign first. */
  requireDraft(): CampaignDraft;
  /** Starts a campaign inside this transaction. */
  openCampaign(state: CampaignState): CampaignDraft;
  /**
   * Installs a previously committed campaign without consuming a revision or
   * an ordinal. Restoring is not a change: a resumed campaign must be
   * indistinguishable from the snapshot it came from, down to its canonical
   * state hash (Technical Specification 9.5, 11.4).
   */
  restoreCampaign(state: CampaignState): void;
  /** Ends the campaign. Publish anything about it before calling this. */
  closeCampaign(): void;
  publish(kind: DomainEventKind, params?: DomainEventParams): void;
  invalidate(topic: ProjectionTopic): void;
  /**
   * Marks the point this command reached as one the campaign must be durable
   * at (Functional Specification 3.4). The trigger is emitted only after the
   * transaction commits; nothing here writes (Technical Specification 11.3).
   */
  requestAutosave(): void;
  /** This transaction seen as a simulation context. Needs an open campaign. */
  simulation(): SimulationContext;
}

export interface CommitResult {
  readonly campaign: CampaignState | null;
  readonly events: readonly DomainEvent[];
  readonly invalidations: readonly ProjectionTopic[];
  /** The committed command asked for a snapshot to be taken. */
  readonly autosaveRequested: boolean;
}

interface TransactionInternals extends Transaction {
  readonly events: DomainEvent[];
  readonly invalidations: Set<ProjectionTopic>;
  readonly result: { restoring: boolean; autosave: boolean };
}

export function beginTransaction(
  campaign: CampaignState | null,
  content: ContentRepository,
): Transaction {
  let draft: CampaignDraft | null = campaign === null ? null : draftOf(campaign);
  const events: DomainEvent[] = [];
  const invalidations = new Set<ProjectionTopic>();
  const result = { restoring: false, autosave: false };

  const transaction: TransactionInternals = {
    get draft(): CampaignDraft | null {
      return draft;
    },
    content,
    events,
    invalidations,
    result,

    requireDraft(): CampaignDraft {
      if (draft === null) {
        throw new NoCampaignError();
      }
      return draft;
    },

    openCampaign(state: CampaignState): CampaignDraft {
      draft = draftOf(state);
      return draft;
    },

    restoreCampaign(state: CampaignState): void {
      draft = draftOf(state);
      result.restoring = true;
    },

    closeCampaign(): void {
      draft = null;
    },

    publish(kind: DomainEventKind, params?: DomainEventParams): void {
      const current = transaction.requireDraft();
      const event: DomainEvent = {
        ordinal: allocateEventOrdinal(current),
        kind,
        simulationTimeMs: current.time.simulationTimeMs,
        ...(params === undefined ? {} : { params }),
      };
      events.push(event);
    },

    invalidate(topic: ProjectionTopic): void {
      invalidations.add(topic);
    },

    requestAutosave(): void {
      result.autosave = true;
    },

    simulation(): SimulationContext {
      return {
        draft: transaction.requireDraft(),
        content,
        publish: (kind, params) => {
          transaction.publish(kind, params);
        },
        invalidate: (topic) => {
          transaction.invalidate(topic);
        },
      };
    },
  };

  return transaction;
}

/**
 * Validates and freezes the transaction's result. The revision moves exactly
 * once here; `createCampaign` therefore starts a campaign at revision 0 and
 * its creating transaction commits it as revision 1, like any other change.
 */
export function commit(transaction: Transaction): CommitResult {
  // `beginTransaction` is the only producer of a transaction, so this cast
  // always reaches the events and invalidations it collected.
  const internals = transaction as TransactionInternals;
  const draft = internals.draft;

  if (draft !== null) {
    if (!internals.result.restoring) {
      draft.revision += 1;
    }
    const issues = validateCampaign(draft as CampaignState, transaction.content);
    if (issues.length > 0) {
      throw new InvariantFailure(issues);
    }
  }

  return {
    campaign: draft === null ? null : deepFreeze(draft as CampaignState),
    events: [...internals.events],
    invalidations: [...internals.invalidations].sort(),
    autosaveRequested: internals.result.autosave,
  };
}
