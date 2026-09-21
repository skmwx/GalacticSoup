import type { ContentRepository } from '@engine/ports';
import { isDefinitionIdIn } from '@shared';

import { attributeValue } from '../attributes';
import { isEntityId } from '../campaign/identity';
import type { CampaignState } from '../campaign/state';
import { parseSlotKey } from '../fitting/types';

import { combatantOf } from './state';
import {
  LOCK_STATUSES,
  WEAPON_STOP_REASONS,
  type CombatState,
  type LockState,
  type WeaponState,
} from './types';

/**
 * Combat shape and consistency (Technical Specification 15.3, checks 1, 7, 8).
 *
 * Locks, cycles and reloads all name an entity: the ship that owns them, the
 * target they act on and the scheduler entry that will resolve them. Every one
 * of those references is checked here, because a save that names a boundary
 * which does not exist would stall a weapon for ever without saying so.
 *
 * The boundary kinds are spelled out rather than imported: the domain may not
 * reach the simulation package. A unit test holds the two lists together.
 *
 * @implements TECH-15.3, FUNC-9.2, FUNC-9.4
 */

type Report = (rule: string, path: string, detail: string) => void;

export const LOCK_COMPLETE_KIND = 'combat.lockComplete';
export const WEAPON_CYCLE_KIND = 'combat.weaponCycle';
export const RELOAD_COMPLETE_KIND = 'combat.reloadComplete';

export function isCombatState(value: unknown): value is CombatState {
  if (!shape(value, ['version', 'ships'])) return false;
  if (!count(value['version']) || value['version'] < 1) return false;
  const ships = value['ships'];
  if (!record(ships)) return false;
  return Object.entries(ships).every(([key, entry]) => isEntityId(key) && shipCombat(entry));
}

export function validateCombat(
  state: CampaignState,
  add: Report,
  content?: ContentRepository,
): void {
  if (!isCombatState(state.combat)) {
    add('combatShape', 'combat', 'Combat runtime has an unknown field, missing field or invalid value.');
    return;
  }
  const fail = (path: string, detail: string) => add('combatConsistency', `combat.${path}`, detail);
  const site = state.navigation.currentSite;

  for (const [shipId, combat] of Object.entries(state.combat.ships)) {
    if (state.assets.ships[shipId] === undefined) {
      fail(`ships.${shipId}`, 'Combat runtime must belong to a ship the campaign owns.');
      continue;
    }
    const inSite = site !== null && site.objects[shipId] !== undefined;
    if (!inSite && (combat.locks.length > 0 || Object.keys(combat.weapons).length > 0)) {
      fail(`ships.${shipId}`, 'A ship outside the loaded site holds no locks and no weapon runtime.');
      continue;
    }

    const targets = new Set<string>();
    for (const lock of combat.locks) {
      const path = `ships.${shipId}.locks.${lock.targetId}`;
      if (targets.has(lock.targetId)) fail(path, 'A target may be locked only once.');
      targets.add(lock.targetId);
      if (site?.objects[lock.targetId] === undefined) {
        fail(path, 'A lock must name an object present in the loaded site.');
      }
      if (lock.targetId === shipId) fail(path, 'A ship cannot lock itself.');
      if ((lock.status === 'locking') !== (lock.boundaryEntryId !== null)) {
        fail(path, 'A lock attempt carries its completion boundary and a completed lock does not.');
      }
      if ((lock.status === 'locking') !== (lock.completesAtMs !== null)) {
        fail(path, 'A lock attempt carries its completion time and a completed lock does not.');
      }
      if (lock.startedAtMs > state.time.simulationTimeMs) {
        fail(path, 'A lock cannot have started in the future.');
      }
      if (lock.outOfRangeSinceMs !== null && lock.outOfRangeSinceMs > state.time.simulationTimeMs) {
        fail(path, 'A lock cannot have left range in the future.');
      }
      checkBoundary(state, lock.boundaryEntryId, shipId, LOCK_COMPLETE_KIND, path, fail);
    }

    if (content !== undefined && inSite) {
      const combatant = combatantOf(state, content, shipId);
      if (combatant !== null &&
        combat.locks.length > attributeValue(combatant.derived, 'maxLockedTargets')) {
        fail(`ships.${shipId}.locks`, 'A ship cannot hold more locks than its hull allows.');
      }
    }

    for (const [key, weapon] of Object.entries(combat.weapons)) {
      const path = `ships.${shipId}.weapons.${key}`;
      const slot = parseSlotKey(key);
      if (slot === null || slot.kind !== 'weapon') fail(path, 'A weapon runtime key names a weapon slot.');
      if (weapon.cycle !== null && weapon.reload !== null) {
        fail(path, 'A weapon cannot be cycling and reloading at the same time.');
      }
      if (weapon.repeating && weapon.targetId === null) {
        fail(path, 'A repeating weapon names the target it fires at.');
      }
      if (weapon.targetId !== null && !targets.has(weapon.targetId)) {
        fail(path, 'A weapon may only name a target this ship has locked.');
      }
      const cycle = weapon.cycle;
      if (cycle !== null) {
        if (!targets.has(cycle.targetId)) fail(`${path}.cycle`, 'A running cycle names a locked target.');
        if (cycle.completesAtMs < cycle.startedAtMs) {
          fail(`${path}.cycle`, 'A cycle cannot complete before it started.');
        }
        checkBoundary(state, cycle.boundaryEntryId, shipId, WEAPON_CYCLE_KIND, `${path}.cycle`, fail);
      }
      const reload = weapon.reload;
      if (reload !== null) {
        if (reload.completesAtMs < reload.startedAtMs) {
          fail(`${path}.reload`, 'A reload cannot complete before it started.');
        }
        checkBoundary(state, reload.boundaryEntryId, shipId, RELOAD_COMPLETE_KIND, `${path}.reload`, fail);
      }
      if (content !== undefined) {
        for (const ammunitionId of [
          weapon.lastAmmunitionId,
          weapon.pendingReload?.ammunitionId ?? null,
          reload?.ammunitionId ?? null,
          cycle?.ammunitionId ?? null,
        ]) {
          if (ammunitionId !== null && content.ammunition(ammunitionId) === undefined) {
            fail(path, `Ammunition "${ammunitionId}" does not resolve.`);
          }
        }
      }
    }
  }
}

function checkBoundary(
  state: CampaignState,
  entryId: string | null,
  ownerId: string,
  kind: string,
  path: string,
  fail: (path: string, detail: string) => void,
): void {
  if (entryId === null) return;
  const entry = state.scheduler.entries.find((candidate) => candidate.entryId === entryId);
  if (entry === undefined || entry.ownerId !== ownerId || entry.kind !== kind) {
    fail(path, `The ${kind} boundary must exist and belong to this ship.`);
  }
}

function shipCombat(value: unknown): boolean {
  if (!shape(value, ['locks', 'weapons'])) return false;
  if (!Array.isArray(value['locks']) || !value['locks'].every(lock)) return false;
  const weapons = value['weapons'];
  if (!record(weapons)) return false;
  return Object.entries(weapons).every(
    ([key, entry]) => parseSlotKey(key) !== null && weapon(entry),
  );
}

function lock(value: unknown): value is LockState {
  return (
    shape(value, ['targetId', 'status', 'startedAtMs', 'completesAtMs', 'boundaryEntryId', 'outOfRangeSinceMs']) &&
    typeof value['targetId'] === 'string' &&
    (LOCK_STATUSES as readonly string[]).includes(value['status'] as string) &&
    count(value['startedAtMs']) &&
    (value['completesAtMs'] === null || count(value['completesAtMs'])) &&
    (value['boundaryEntryId'] === null || isEntityId(value['boundaryEntryId'])) &&
    (value['outOfRangeSinceMs'] === null || count(value['outOfRangeSinceMs']))
  );
}

function weapon(value: unknown): value is WeaponState {
  if (!shape(value, [
    'repeating', 'targetId', 'cycle', 'reload', 'pendingReload', 'lastAmmunitionId', 'stopReason',
  ])) return false;
  if (typeof value['repeating'] !== 'boolean') return false;
  if (value['targetId'] !== null && typeof value['targetId'] !== 'string') return false;
  if (!cycleState(value['cycle']) || !reloadState(value['reload'])) return false;
  if (value['pendingReload'] !== null) {
    const pending = value['pendingReload'];
    if (!shape(pending, ['ammunitionId', 'changing']) ||
      !isDefinitionIdIn(pending['ammunitionId'], 'ammo') ||
      typeof pending['changing'] !== 'boolean') return false;
  }
  if (value['lastAmmunitionId'] !== null && !isDefinitionIdIn(value['lastAmmunitionId'], 'ammo')) return false;
  return value['stopReason'] === null ||
    (WEAPON_STOP_REASONS as readonly string[]).includes(value['stopReason'] as string);
}

function cycleState(value: unknown): boolean {
  if (value === null) return true;
  return (
    shape(value, [
      'startedAtMs', 'completesAtMs', 'boundaryEntryId', 'targetId', 'ammunitionId',
      'reservedRounds', 'committedCapacitor',
    ]) &&
    count(value['startedAtMs']) && count(value['completesAtMs']) &&
    isEntityId(value['boundaryEntryId']) && typeof value['targetId'] === 'string' &&
    (value['ammunitionId'] === null || isDefinitionIdIn(value['ammunitionId'], 'ammo')) &&
    count(value['reservedRounds']) && nonNegative(value['committedCapacitor'])
  );
}

function reloadState(value: unknown): boolean {
  if (value === null) return true;
  return (
    shape(value, ['ammunitionId', 'startedAtMs', 'completesAtMs', 'boundaryEntryId', 'changing']) &&
    isDefinitionIdIn(value['ammunitionId'], 'ammo') &&
    count(value['startedAtMs']) && count(value['completesAtMs']) &&
    isEntityId(value['boundaryEntryId']) && typeof value['changing'] === 'boolean'
  );
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
