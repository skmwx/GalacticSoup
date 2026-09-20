import { isDefinitionId, type DefinitionId } from '@shared';

import { isCampaignId, isCampaignSeed, isEntityId, MAX_ORDINAL } from './identity';
import { isRandomStreams } from '../random/streams';
import type { SchedulerEntry } from './scheduler';
import { validateCampaign, type InvariantIssue } from './invariants';
import {
  CAMPAIGN_STATE_VERSION,
  MAX_DISPLAY_NAME_LENGTH,
  type CampaignState,
  type TimeState,
} from './state';

/**
 * Reading a stored campaign payload back into domain state
 * (Technical Specification 11.4, steps 3, 6 and 7).
 *
 * A payload that reaches here has already passed its envelope, size and
 * checksum checks. What remains is proving that it is a `CampaignState` of the
 * current shape: every field present, every value in range, every reference
 * resolvable. Only then do the campaign invariants run on it.
 *
 * The check is written out rather than derived from the type, because the type
 * is erased at run time and the payload is untrusted input. It mirrors
 * `schemas/save/campaign-state.schema.json`, which is the contract a future
 * Java engine validates against.
 *
 * @implements TECH-11.4
 */

export interface CampaignReadSuccess {
  readonly ok: true;
  readonly state: CampaignState;
}

export interface CampaignReadFailure {
  readonly ok: false;
  readonly issues: readonly InvariantIssue[];
}

export type CampaignReadResult = CampaignReadSuccess | CampaignReadFailure;

export function readCampaignState(value: unknown): CampaignReadResult {
  const issues: InvariantIssue[] = [];
  const add: Report = (rule, path, detail) => {
    issues.push({ rule, path, detail });
  };

  if (!isRecord(value)) {
    add('shape', 'state', 'The saved payload is not an object.');
    return { ok: false, issues };
  }

  const known = new Set<string>(STATE_FIELDS);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      add('shape', `state.${key}`, 'The payload carries a field this version does not know.');
    }
  }

  if (value['stateVersion'] !== CAMPAIGN_STATE_VERSION) {
    add(
      'stateVersion',
      'state.stateVersion',
      `Expected state version ${String(CAMPAIGN_STATE_VERSION)}.`,
    );
  }
  if (!isCampaignId(value['campaignId'])) {
    add('campaignIdentity', 'state.campaignId', 'The campaign id is malformed.');
  }
  if (!isCampaignSeed(value['seed'])) {
    add('campaignIdentity', 'state.seed', 'The campaign seed is malformed.');
  }

  const displayName = value['displayName'];
  if (
    typeof displayName !== 'string' ||
    displayName.trim().length === 0 ||
    displayName.length > MAX_DISPLAY_NAME_LENGTH
  ) {
    add('boundedValues', 'state.displayName', 'The display name is missing or out of range.');
  }

  if (!isCount(value['createdAtRealMs'])) {
    add('boundedValues', 'state.createdAtRealMs', 'The creation timestamp is malformed.');
  }

  for (const field of ['revision', 'nextEntityOrdinal', 'nextEventOrdinal'] as const) {
    const ordinal = value[field];
    if (!isCount(ordinal) || ordinal < 1 || ordinal > MAX_ORDINAL) {
      add('ordinalsMonotonic', `state.${field}`, 'The counter is missing or out of range.');
    }
  }

  readTime(value['time'], add);

  if (!isRandomStreams(value['random'])) {
    add('randomStreams', 'state.random', 'The saved random streams are missing or malformed.');
  }

  readScheduler(value['scheduler'], add);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // The payload now has the shape of a campaign; the invariants decide whether
  // it is a legal one (Technical Specification 15.3).
  const state = value as unknown as CampaignState;
  const invariantIssues = validateCampaign(state);
  if (invariantIssues.length > 0) {
    return { ok: false, issues: invariantIssues };
  }

  return { ok: true, state };
}

/**
 * Definition ids the saved state depends on
 * (Technical Specification 11.4, step 5).
 *
 * A campaign stores definition ids rather than copies of definitions, so a
 * content update reaches it without a migration as long as every id it names
 * still resolves. This phase's state names none, because no gameplay entity
 * exists yet; each later phase adds the references the state it introduces
 * carries.
 */
export function campaignDefinitionReferences(state: CampaignState): readonly DefinitionId[] {
  const references: DefinitionId[] = [];
  for (const entry of state.scheduler.entries) {
    // A boundary kind is an engine enumeration rather than a definition id.
    // Only a kind that names a definition is collected, which is the seam a
    // later phase extends.
    if (isDefinitionId(entry.kind)) {
      references.push(entry.kind);
    }
  }
  return references;
}

const STATE_FIELDS: readonly string[] = [
  'stateVersion',
  'campaignId',
  'displayName',
  'seed',
  'createdAtRealMs',
  'revision',
  'nextEntityOrdinal',
  'nextEventOrdinal',
  'time',
  'random',
  'scheduler',
];

const TIME_FIELDS: readonly string[] = ['simulationTimeMs', 'paused', 'rate', 'accumulatorMs'];

const SCHEDULER_ENTRY_FIELDS: readonly string[] = [
  'entryId',
  'kind',
  'dueAtMs',
  'priority',
  'insertionOrdinal',
  'ownerId',
];

type Report = (rule: string, path: string, detail: string) => void;

function readTime(value: unknown, add: Report): void {
  if (!isRecord(value)) {
    add('shape', 'state.time', 'The saved time state is not an object.');
    return;
  }
  for (const key of Object.keys(value)) {
    if (!TIME_FIELDS.includes(key)) {
      add('shape', `state.time.${key}`, 'Unknown field in the saved time state.');
    }
  }

  const time = value as unknown as TimeState;
  if (!isCount(time.simulationTimeMs)) {
    add('simulationTime', 'state.time.simulationTimeMs', 'Simulation time is malformed.');
  }
  if (typeof time.paused !== 'boolean') {
    add('shape', 'state.time.paused', 'The pause flag is missing.');
  }
  if (typeof time.rate !== 'number' || !Number.isFinite(time.rate) || time.rate <= 0) {
    add('boundedValues', 'state.time.rate', 'The time rate is out of range.');
  }
  if (!isCount(time.accumulatorMs)) {
    add('simulationTime', 'state.time.accumulatorMs', 'The accumulator is malformed.');
  }
}

function readScheduler(value: unknown, add: Report): void {
  if (!isRecord(value)) {
    add('shape', 'state.scheduler', 'The saved scheduler is not an object.');
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'entries' && key !== 'nextInsertionOrdinal') {
      add('shape', `state.scheduler.${key}`, 'Unknown field in the saved scheduler.');
    }
  }

  const ordinal = value['nextInsertionOrdinal'];
  if (!isCount(ordinal) || ordinal < 1) {
    add(
      'schedulerEntries',
      'state.scheduler.nextInsertionOrdinal',
      'The insertion ordinal is out of range.',
    );
  }

  const entries = value['entries'];
  if (!Array.isArray(entries)) {
    add('shape', 'state.scheduler.entries', 'The saved scheduler has no entry list.');
    return;
  }

  entries.forEach((candidate: unknown, index: number) => {
    const path = `state.scheduler.entries[${String(index)}]`;
    if (!isRecord(candidate)) {
      add('shape', path, 'A scheduler entry is not an object.');
      return;
    }
    for (const key of Object.keys(candidate)) {
      if (!SCHEDULER_ENTRY_FIELDS.includes(key)) {
        add('shape', `${path}.${key}`, 'Unknown field in a scheduler entry.');
      }
    }
    const entry = candidate as unknown as SchedulerEntry;
    if (!isEntityId(entry.entryId)) {
      add('schedulerEntries', path, 'A scheduler entry has no entity identifier.');
    }
    if (typeof entry.kind !== 'string' || entry.kind.length === 0) {
      add('schedulerEntries', path, 'A scheduler entry has no boundary kind.');
    }
    if (!isCount(entry.dueAtMs)) {
      add('schedulerEntries', path, 'A scheduler due time is malformed.');
    }
    if (!Number.isSafeInteger(entry.priority)) {
      add('schedulerEntries', path, 'A boundary priority is malformed.');
    }
    if (!isCount(entry.insertionOrdinal) || entry.insertionOrdinal < 1) {
      add('schedulerEntries', path, 'An insertion ordinal is out of range.');
    }
    if (entry.ownerId !== null && !isEntityId(entry.ownerId)) {
      add('schedulerEntries', path, 'A boundary owner is neither an entity id nor null.');
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
