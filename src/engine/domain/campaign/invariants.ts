import { sortedKeys } from '@shared';
import type { ContentRepository } from '@engine/ports';
import { validateAssets } from '../assets/validation';
import { validateEconomy } from '../economy/validation';

import { isCampaignId, isEntityId, MAX_ORDINAL } from './identity';
import { RANDOM_STREAMS, isRandomStreams } from '../random/streams';
import { compareSchedulerEntries, MAX_SCHEDULE_HORIZON_MS } from './scheduler';
import {
  CAMPAIGN_STATE_VERSION,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SIMULATION_TIME_MS,
  type CampaignState,
} from './state';

/**
 * Campaign invariants (Technical Specification 15.3).
 *
 * These run after a transaction applies its change and before it commits. A
 * failure aborts the transaction and leaves the previous state in place, so an
 * invariant is a guard rather than a report: it must be cheap, total and free
 * of side effects.
 *
 * Only the checks whose subject exists yet are implemented. Each later phase
 * adds the numbered checks for the state it introduces; the list below names
 * the specification checks covered so the gap stays visible.
 *
 * Covered here: 1 (bounded values, including stored damage and capacitor
 * charge), 2-5 (asset references, ownership, capacity, reservations and
 * active-ship location), 6 (fitting slot, hardpoint and online-resource
 * consistency; no MVP item has a skill requirement), 7 and 12 (scheduler
 * entries, and the absence of a real timestamp as a completion condition),
 * 11 (streams, simulation time, revisions and ordinals). Content-dependent
 * asset checks run at commit, before persistence and on load with the
 * installed repository.
 *
 * @implements TECH-15.3
 */

export interface InvariantIssue {
  /** Stable rule name, reported in the error parameters and named in tests. */
  readonly rule: string;
  /** Path inside the campaign state, for example `scheduler.entries[0]`. */
  readonly path: string;
  readonly detail: string;
}

type Report = (rule: string, path: string, detail: string) => void;

export function validateCampaign(state: CampaignState, content?: ContentRepository): readonly InvariantIssue[] {
  const issues: InvariantIssue[] = [];
  const add: Report = (rule, path, detail) => {
    issues.push({ rule, path, detail });
  };

  if (state.stateVersion !== CAMPAIGN_STATE_VERSION) {
    add(
      'stateVersion',
      'stateVersion',
      `Expected state version ${String(CAMPAIGN_STATE_VERSION)}, found ${String(state.stateVersion)}.`,
    );
  }

  if (!isCampaignId(state.campaignId)) {
    add('campaignIdentity', 'campaignId', 'The campaign id is not a campaign identifier.');
  }

  const name = state.displayName;
  if (name.trim().length === 0 || name.length > MAX_DISPLAY_NAME_LENGTH) {
    add('boundedValues', 'displayName', 'The display name is empty or too long.');
  }

  if (!isCount(state.revision) || state.revision < 1) {
    add('revisionMonotonic', 'revision', 'The revision must be a whole number of at least 1.');
  }

  for (const field of ['nextEntityOrdinal', 'nextEventOrdinal'] as const) {
    const ordinal = state[field];
    if (!isCount(ordinal) || ordinal < 1 || ordinal > MAX_ORDINAL) {
      add('ordinalsMonotonic', field, 'An ordinal must be a whole number of at least 1.');
    }
  }

  const time = state.time;
  if (!isCount(time.simulationTimeMs) || time.simulationTimeMs > MAX_SIMULATION_TIME_MS) {
    add(
      'simulationTime',
      'time.simulationTimeMs',
      'Simulation time must be whole milliseconds within the supported horizon.',
    );
  }
  if (!isCount(time.accumulatorMs)) {
    add(
      'simulationTime',
      'time.accumulatorMs',
      'The sub-quantum accumulator must be whole, non-negative milliseconds.',
    );
  }
  if (!Number.isFinite(time.rate) || time.rate <= 0) {
    add('boundedValues', 'time.rate', 'The selected time rate must be a positive number.');
  }

  if (!isRandomStreams(state.random)) {
    add('randomStreams', 'random', 'Every random stream must carry four non-zero 32-bit words.');
  } else {
    const present = sortedKeys(state.random as unknown as Record<string, unknown>).join(',');
    if (present !== [...RANDOM_STREAMS].sort().join(',')) {
      add('randomStreams', 'random', 'The campaign carries a different set of random streams.');
    }
  }

  validateScheduler(state, add);
  validateAssets(state, add, content);
  validateEconomy(state, add, content);

  return issues;
}

function validateScheduler(state: CampaignState, add: Report): void {
  const { entries, nextInsertionOrdinal } = state.scheduler;

  if (!isCount(nextInsertionOrdinal) || nextInsertionOrdinal < 1) {
    add(
      'schedulerEntries',
      'scheduler.nextInsertionOrdinal',
      'The insertion ordinal must be a whole number of at least 1.',
    );
  }

  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const path = `scheduler.entries[${String(index)}]`;

    if (!isEntityId(entry.entryId)) {
      add('schedulerEntries', path, 'A scheduler entry needs an entity identifier.');
    }
    if (seen.has(entry.entryId)) {
      add('schedulerEntries', path, `Duplicate scheduler entry "${entry.entryId}".`);
    }
    seen.add(entry.entryId);

    if (entry.kind.length === 0) {
      add('schedulerEntries', path, 'A scheduler entry needs a boundary kind.');
    }
    if (!isCount(entry.dueAtMs)) {
      add('schedulerEntries', path, 'A due time must be whole, non-negative milliseconds.');
    } else if (entry.dueAtMs > state.time.simulationTimeMs + MAX_SCHEDULE_HORIZON_MS) {
      // A real epoch timestamp lands here. This is check 12: no pending
      // completion may depend on wall-clock time.
      add(
        'schedulerHorizon',
        path,
        'A due time beyond the scheduling horizon is not a simulation timestamp.',
      );
    }
    if (!Number.isSafeInteger(entry.priority)) {
      add('schedulerEntries', path, 'A boundary priority must be a whole number.');
    }
    if (!isCount(entry.insertionOrdinal) || entry.insertionOrdinal >= nextInsertionOrdinal) {
      add('schedulerEntries', path, 'An insertion ordinal must be below the next one.');
    }
    if (entry.ownerId !== null && !isEntityId(entry.ownerId)) {
      add('schedulerEntries', path, 'A boundary owner must be an entity identifier or null.');
    }
  });

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      compareSchedulerEntries(previous, current) > 0
    ) {
      add(
        'schedulerOrder',
        `scheduler.entries[${String(index)}]`,
        'Scheduler entries must be stored in resolution order.',
      );
    }
  }
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
