import type { ContentRepository } from '@engine/ports';
import { isDefinitionIdIn } from '@shared';

import { isEntityId } from '../campaign/identity';
import type { CampaignState } from '../campaign/state';

import { ENCOUNTER_STATUSES, type EncounterState } from './types';

/**
 * Encounter shape and consistency (Technical Specification 15.3, checks 1, 3,
 * 7 and 8).
 *
 * The instance and its wrecks name entities the campaign owns: ships that
 * exist while they are alive, inventories that hold exactly the wreck's
 * contents, and scheduler entries that will expire them. Each reference is
 * checked here, because a wreck whose expiry boundary is missing would sit in
 * a site for ever and a bounty settled twice would print credits.
 *
 * The boundary kinds are spelled out rather than imported: the domain may not
 * reach the simulation package. A unit test holds the two lists together.
 *
 * @implements TECH-15.3, FUNC-9.11, FUNC-22.7
 */

type Report = (rule: string, path: string, detail: string) => void;

export const NPC_DECISION_KIND = 'encounter.npcDecision';
export const WRECK_EXPIRE_KIND = 'encounter.wreckExpire';

export function isEncounterState(value: unknown): value is EncounterState {
  if (!shape(value, ['version', 'active', 'wrecks', 'completions', 'lastOutcome'])) return false;
  if (!count(value['version']) || value['version'] < 1) return false;
  if (!instance(value['active'])) return false;
  const wrecks = value['wrecks'];
  if (!record(wrecks)) return false;
  if (!Object.entries(wrecks).every(([key, entry]) => isEntityId(key) && wreckState(entry))) {
    return false;
  }
  const completions = value['completions'];
  if (!record(completions)) return false;
  if (!Object.entries(completions).every(
    ([key, entry]) => isDefinitionIdIn(key, 'encounter') && count(entry) && (entry as number) > 0,
  )) return false;
  return outcome(value['lastOutcome']);
}

/** Cross-aggregate checks, run after the shape is known to be valid. */
export function validateEncounter(
  state: CampaignState,
  add: Report,
  content?: ContentRepository,
): void {
  if (!isEncounterState(state.encounter)) {
    add('encounterShape', 'encounter', 'Encounter state has an unknown field, missing field or invalid value.');
    return;
  }
  const fail = (path: string, detail: string) => add('encounterConsistency', `encounter.${path}`, detail);
  const site = state.navigation.currentSite;
  const active = state.encounter.active;

  if (active !== null) {
    if (active.startedAtMs > state.time.simulationTimeMs) {
      fail('active.startedAtMs', 'An encounter cannot have started in the future.');
    }
    if ((active.status === 'active') !== (active.resolvedAtMs === null)) {
      fail('active.resolvedAtMs', 'A resolved encounter records when it resolved, and a running one does not.');
    }
    if (active.objective.destroyed > active.objective.required) {
      fail('active.objective', 'More opponents were destroyed than the objective needs.');
    }
    if (active.objective.required !== active.npcs.length) {
      fail('active.objective.required', 'The objective must count every spawned opponent.');
    }
    if (active.objective.destroyed !== active.npcs.filter((npc) => npc.destroyedAtMs !== null).length) {
      fail('active.objective.destroyed', 'The objective count must match the destroyed opponents.');
    }
    if (new Set(active.grantedRewardIds).size !== active.grantedRewardIds.length) {
      fail('active.grantedRewardIds', 'A reward may be granted only once.');
    }
    if (site === null || site.siteId !== active.siteId) {
      fail('active.siteId', 'An encounter instance requires its own loaded site.');
    }

    const seen = new Set<string>();
    for (const npc of active.npcs) {
      const path = `active.npcs.${npc.shipId}`;
      if (seen.has(npc.shipId)) fail(path, 'An opponent ship may appear only once.');
      seen.add(npc.shipId);
      const alive = npc.destroyedAtMs === null;
      if (alive && state.assets.ships[npc.shipId] === undefined) {
        fail(path, 'A surviving opponent must still own its ship.');
      }
      if (!alive && state.assets.ships[npc.shipId] !== undefined) {
        fail(path, 'A destroyed opponent must no longer own a ship.');
      }
      if (alive && site?.objects[npc.shipId] === undefined) {
        fail(path, 'A surviving opponent must be present in the loaded site.');
      }
      if (npc.shipId === state.assets.activeShipId) {
        fail(path, 'The player ship cannot be an opponent.');
      }
      if (npc.destroyedAtMs !== null && npc.destroyedAtMs > state.time.simulationTimeMs) {
        fail(path, 'An opponent cannot have been destroyed in the future.');
      }
      if (npc.decisionBoundaryEntryId !== null) {
        const entry = state.scheduler.entries.find(
          (candidate) => candidate.entryId === npc.decisionBoundaryEntryId,
        );
        if (entry === undefined || entry.kind !== NPC_DECISION_KIND || entry.ownerId !== npc.shipId) {
          fail(path, 'An opponent decision boundary must exist and belong to that opponent.');
        }
      }
      if (!alive && npc.decisionBoundaryEntryId !== null) {
        fail(path, 'A destroyed opponent holds no pending decision.');
      }
      if (content !== undefined && content.npcProfile(npc.profileId) === undefined) {
        fail(`${path}.profileId`, 'The opponent profile does not resolve.');
      }
    }

    if (content !== undefined) {
      const definition = content.encounter(active.encounterId);
      if (definition === undefined || definition.siteId !== active.siteId) {
        fail('active.encounterId', 'The encounter definition does not resolve at this site.');
      }
    }
  }

  for (const entry of Object.values(state.encounter.wrecks)) {
    const path = `wrecks.${entry.id}`;
    const inventory = state.assets.inventories[entry.inventoryId];
    if (inventory?.location.kind !== 'wreck' || inventory.location.wreckId !== entry.id) {
      fail(path, 'A wreck must own exactly one wreck inventory.');
    }
    if (entry.expiresAtMs <= entry.createdAtMs) {
      fail(path, 'A wreck must expire after it was created.');
    }
    const boundary = state.scheduler.entries.find(
      (candidate) => candidate.entryId === entry.boundaryEntryId,
    );
    if (boundary === undefined || boundary.kind !== WRECK_EXPIRE_KIND) {
      fail(path, 'A wreck must carry the scheduled boundary that expires it.');
    } else if (boundary.dueAtMs !== entry.expiresAtMs) {
      fail(path, 'A wreck expiry boundary must be due when the wreck expires.');
    }
    if (state.assets.ships[entry.id] !== undefined) {
      fail(path, 'A wreck identity cannot also be a ship.');
    }
    const object = site?.objects[entry.id];
    if (site !== null && entry.siteId === site.siteId && object?.kind !== 'wreck') {
      fail(path, 'A wreck in the loaded site must be present as a wreck object.');
    }
    if (site !== null && entry.siteId !== site.siteId && object !== undefined) {
      fail(path, 'A wreck of another site cannot be present in the loaded one.');
    }
    if (content !== undefined && content.hull(entry.hullId) === undefined) {
      fail(`${path}.hullId`, 'The wreck hull does not resolve.');
    }
  }

  if (site !== null) {
    for (const object of Object.values(site.objects)) {
      if (object.kind === 'wreck' && state.encounter.wrecks[object.id] === undefined) {
        fail(`wrecks.${object.id}`, 'A wreck object in the site must have its wreck state.');
      }
    }
  }

  const last = state.encounter.lastOutcome;
  if (last !== null && last.resolvedAtMs > state.time.simulationTimeMs) {
    fail('lastOutcome.resolvedAtMs', 'An outcome cannot have been recorded in the future.');
  }
}

function instance(value: unknown): boolean {
  if (value === null) return true;
  if (!shape(value, [
    'instanceId', 'encounterId', 'systemId', 'siteId', 'status', 'startedAtMs',
    'resolvedAtMs', 'npcs', 'objective', 'grantedRewardIds', 'bountyCreditsPaid',
  ])) return false;
  if (!isEntityId(value['instanceId']) || !isDefinitionIdIn(value['encounterId'], 'encounter') ||
      !isDefinitionIdIn(value['systemId'], 'system') || !isDefinitionIdIn(value['siteId'], 'site')) {
    return false;
  }
  if (!(ENCOUNTER_STATUSES as readonly unknown[]).includes(value['status'])) return false;
  if (!count(value['startedAtMs']) || !count(value['bountyCreditsPaid'])) return false;
  if (value['resolvedAtMs'] !== null && !count(value['resolvedAtMs'])) return false;
  if (!Array.isArray(value['npcs']) || !value['npcs'].every(npc)) return false;
  if (!objective(value['objective'])) return false;
  return Array.isArray(value['grantedRewardIds']) &&
    value['grantedRewardIds'].every((id) => typeof id === 'string' && id.length > 0 && id.length <= 96);
}

function npc(value: unknown): boolean {
  return shape(value, [
    'shipId', 'profileId', 'spawnOrdinal', 'bountyCredits', 'lootTableId',
    'destroyedAtMs', 'decisionBoundaryEntryId',
  ]) && isEntityId(value['shipId']) && isDefinitionIdIn(value['profileId'], 'npc') &&
    count(value['spawnOrdinal']) && count(value['bountyCredits']) &&
    isDefinitionIdIn(value['lootTableId'], 'loot') &&
    (value['destroyedAtMs'] === null || count(value['destroyedAtMs'])) &&
    (value['decisionBoundaryEntryId'] === null || isEntityId(value['decisionBoundaryEntryId']));
}

function objective(value: unknown): boolean {
  return shape(value, ['kind', 'destroyed', 'required']) && value['kind'] === 'destroyGroup' &&
    count(value['destroyed']) && count(value['required']);
}

function wreckState(value: unknown): boolean {
  return shape(value, [
    'id', 'systemId', 'siteId', 'inventoryId', 'hullId', 'nameKey', 'position',
    'radiusKm', 'createdAtMs', 'expiresAtMs', 'boundaryEntryId',
  ]) && isEntityId(value['id']) && isDefinitionIdIn(value['systemId'], 'system') &&
    isDefinitionIdIn(value['siteId'], 'site') && isEntityId(value['inventoryId']) &&
    isDefinitionIdIn(value['hullId'], 'hull') && typeof value['nameKey'] === 'string' &&
    vector(value['position']) && nonNegative(value['radiusKm']) &&
    count(value['createdAtMs']) && count(value['expiresAtMs']) &&
    isEntityId(value['boundaryEntryId']);
}

function outcome(value: unknown): boolean {
  return value === null || (shape(value, [
    'encounterId', 'status', 'resolvedAtMs', 'bountyCreditsPaid', 'npcsDestroyed', 'npcsTotal',
  ]) && isDefinitionIdIn(value['encounterId'], 'encounter') &&
    (value['status'] === 'completed' || value['status'] === 'abandoned') &&
    count(value['resolvedAtMs']) && count(value['bountyCreditsPaid']) &&
    count(value['npcsDestroyed']) && count(value['npcsTotal']));
}

function vector(value: unknown): boolean {
  return shape(value, ['x', 'y']) && finite(value['x']) && finite(value['y']);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
