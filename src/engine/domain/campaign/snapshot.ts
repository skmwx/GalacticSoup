import { isDefinitionId, type DefinitionId } from '@shared';
import { isAssetState } from '../assets/validation';
import { parseSlotKey } from '../fitting/types';
import { isCombatState } from '../combat/validation';
import { isEconomyState } from '../economy/validation';
import { isEncounterState } from '../encounter/validation';
import { isNavigationState } from '../navigation/validation';
import { isRecoveryState } from '../recovery/validation';

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
  if (!isAssetState(value['assets'])) add('assetShape', 'state.assets', 'Saved assets are missing or malformed.');
  if (!isEconomyState(value['economy'])) add('economyShape', 'state.economy', 'Saved station economies are missing or malformed.');
  if (!isNavigationState(value['navigation'])) add('navigationShape', 'state.navigation', 'Saved navigation is missing or malformed.');
  if (!isCombatState(value['combat'])) add('combatShape', 'state.combat', 'Saved combat runtime is missing or malformed.');
  if (!isEncounterState(value['encounter'])) add('encounterShape', 'state.encounter', 'Saved encounter state is missing or malformed.');
  if (!isRecoveryState(value['recovery'])) add('recoveryShape', 'state.recovery', 'Saved loss and recovery state is missing or malformed.');
  readFittingDraft(value['fitting'], add);

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
 * still resolves. Ships, locations and physical stacks all contribute references;
 * later phases extend this set whenever they persist another definition ID.
 */
export function campaignDefinitionReferences(state: CampaignState): readonly DefinitionId[] {
  const references: DefinitionId[] = [];
  addLocationReferences(references, state.assets.location);
  for (const ship of Object.values(state.assets.ships)) {
    references.push(ship.hullId);
    addLocationReferences(references, ship.location);
  }
  for (const inventory of Object.values(state.assets.inventories)) {
    if (inventory.location.kind === 'hangar') references.push(inventory.location.stationId);
  }
  for (const stack of Object.values(state.assets.stacks)) references.push(stack.definitionId);
  for (const planned of Object.values(state.fitting?.slots ?? {})) {
    references.push(planned.moduleId);
    if (planned.ammunitionId !== null) references.push(planned.ammunitionId);
  }
  for (const station of Object.values(state.economy.stations)) {
    references.push(station.stationId);
    for (const listing of Object.values(station.listings)) references.push(listing.itemId);
  }
  const encounter = state.encounter.active;
  if (encounter !== null) {
    references.push(encounter.encounterId, encounter.systemId, encounter.siteId);
    for (const npc of encounter.npcs) references.push(npc.profileId, npc.lootTableId);
  }
  for (const entry of Object.values(state.encounter.wrecks)) {
    references.push(entry.systemId, entry.siteId, entry.hullId);
  }
  for (const encounterId of Object.keys(state.encounter.completions)) {
    if (isDefinitionId(encounterId)) references.push(encounterId);
  }
  if (state.encounter.lastOutcome !== null) references.push(state.encounter.lastOutcome.encounterId);
  references.push(state.assets.lastDockedStationId);
  const loss = state.recovery.lastLoss;
  if (loss !== null) {
    references.push(loss.hullId, loss.systemId, loss.siteId, loss.recoveryStationId);
    if (loss.encounterId !== null) references.push(loss.encounterId);
    for (const lost of loss.items) references.push(lost.definitionId);
    for (const effect of loss.disablingEffects) references.push(effect.moduleId);
  }
  references.push(...state.navigation.knownDestinationSiteIds);
  if (state.navigation.selectedEncounterId !== null) references.push(state.navigation.selectedEncounterId);
  if (state.navigation.currentSite !== null) {
    references.push(state.navigation.currentSite.systemId, state.navigation.currentSite.siteId);
    for (const object of Object.values(state.navigation.currentSite.objects)) {
      if (isDefinitionId(object.definitionId)) references.push(object.definitionId);
    }
  }
  for (const combat of Object.values(state.combat.ships)) {
    for (const weapon of Object.values(combat.weapons)) {
      for (const ammunitionId of [
        weapon.lastAmmunitionId,
        weapon.pendingReload?.ammunitionId ?? null,
        weapon.reload?.ammunitionId ?? null,
        weapon.cycle?.ammunitionId ?? null,
      ]) {
        if (ammunitionId !== null) references.push(ammunitionId);
      }
    }
  }
  return [...new Set(references)].sort();
}

function addLocationReferences(
  references: DefinitionId[],
  location: CampaignState['assets']['location'],
): void {
  references.push(location.systemId);
  if (location.kind === 'station') references.push(location.stationId);
  if (location.kind === 'site') references.push(location.siteId);
  if (location.kind === 'warp') references.push(location.fromSiteId, location.toSiteId);
}

const STATE_FIELDS: readonly string[] = [
  'assets',
  'combat',
  'economy',
  'encounter',
  'fitting',
  'navigation',
  'recovery',
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

const FITTING_FIELDS: readonly string[] = ['shipId', 'baseRevision', 'slots'];

const PLANNED_SLOT_FIELDS: readonly string[] = ['moduleId', 'online', 'ammunitionId'];

/** The saved fitting draft, which is `null` while the player has none open. */
function readFittingDraft(value: unknown, add: Report): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    add('shape', 'state.fitting', 'The saved fitting draft is neither an object nor null.');
    return;
  }
  for (const key of Object.keys(value)) {
    if (!FITTING_FIELDS.includes(key)) {
      add('shape', `state.fitting.${key}`, 'Unknown field in the saved fitting draft.');
    }
  }
  if (!isEntityId(value['shipId'])) {
    add('fittingConsistency', 'state.fitting.shipId', 'A fitting draft names the ship it belongs to.');
  }
  if (!isCount(value['baseRevision'])) {
    add('fittingConsistency', 'state.fitting.baseRevision', 'The base revision is malformed.');
  }

  const slots = value['slots'];
  if (!isRecord(slots)) {
    add('shape', 'state.fitting.slots', 'The saved fitting draft has no slot table.');
    return;
  }
  for (const key of Object.keys(slots)) {
    const path = `state.fitting.slots.${key}`;
    if (parseSlotKey(key) === null) {
      add('fittingConsistency', path, 'Unknown slot key.');
    }
    const planned = slots[key];
    if (!isRecord(planned)) {
      add('shape', path, 'A planned slot is not an object.');
      continue;
    }
    for (const field of Object.keys(planned)) {
      if (!PLANNED_SLOT_FIELDS.includes(field)) {
        add('shape', `${path}.${field}`, 'Unknown field in a planned slot.');
      }
    }
    if (!isDefinitionId(planned['moduleId'])) {
      add('fittingConsistency', `${path}.moduleId`, 'A planned slot names a module definition.');
    }
    if (typeof planned['online'] !== 'boolean') {
      add('shape', `${path}.online`, 'A planned slot records whether the module is online.');
    }
    const ammunitionId = planned['ammunitionId'];
    if (ammunitionId !== null && !isDefinitionId(ammunitionId)) {
      add('fittingConsistency', `${path}.ammunitionId`, 'A planned charge names an ammunition definition or null.');
    }
  }
}

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
