import { DAMAGE_TYPES, DEFENSE_LAYERS, type ContentRepository } from '@engine/ports';
import { isDefinitionId, isDefinitionIdIn } from '@shared';

import { isEntityId } from '../campaign/identity';
import type { CampaignState } from '../campaign/state';
import { parseSlotKey } from '../fitting/types';

import {
  LOSS_DISABLING_KINDS,
  LOSS_ITEM_ORIGINS,
  LOSS_RECOVERY_OUTCOMES,
  type RecoveryState,
} from './types';

/**
 * Loss-record shape and consistency (Technical Specification 15.3, checks 1,
 * 2 and 11).
 *
 * The record is history: the ship it describes and the wreck it names may
 * both be gone, so only its shape, its timing and the definitions it names are
 * held to account here.
 *
 * @implements TECH-15.3, FUNC-9.12
 */

type Report = (rule: string, path: string, detail: string) => void;

export function isRecoveryState(value: unknown): value is RecoveryState {
  return shape(value, ['version', 'losses', 'lastLoss']) && count(value['version']) &&
    value['version'] >= 1 && count(value['losses']) && lossRecord(value['lastLoss']);
}

export function validateRecovery(
  state: CampaignState,
  add: Report,
  content?: ContentRepository,
): void {
  if (!isRecoveryState(state.recovery)) {
    add('recoveryShape', 'recovery', 'Recovery state has an unknown field, missing field or invalid value.');
    return;
  }
  const fail = (path: string, detail: string) => add('recoveryConsistency', `recovery.${path}`, detail);
  const loss = state.recovery.lastLoss;
  if (loss === null) return;
  if (state.recovery.losses < 1) fail('losses', 'A recorded loss must be counted.');
  if (loss.destroyedAtMs > state.time.simulationTimeMs) {
    fail('lastLoss.destroyedAtMs', 'A loss cannot be recorded in the future.');
  }
  if (loss.wreckExpiresAtMs <= loss.destroyedAtMs) {
    fail('lastLoss.wreckExpiresAtMs', 'The wreck must outlast the moment it was left.');
  }
  if (state.assets.ships[loss.shipId] !== undefined) {
    fail('lastLoss.shipId', 'A destroyed ship can no longer be owned.');
  }
  const wreck = state.encounter.wrecks[loss.wreckId];
  if (wreck !== undefined && wreck.owner !== 'player') {
    fail('lastLoss.wreckId', 'A loss names the player\'s own wreck.');
  }
  if (content !== undefined) {
    if (content.hull(loss.hullId) === undefined) fail('lastLoss.hullId', 'The lost hull does not resolve.');
    if (content.station(loss.recoveryStationId) === undefined) {
      fail('lastLoss.recoveryStationId', 'The recovery station does not resolve.');
    }
    for (const [index, item] of loss.items.entries()) {
      if (content.tradeable(item.definitionId) === undefined) {
        fail(`lastLoss.items[${String(index)}]`, 'A lost item does not resolve.');
      }
    }
  }
}

function lossRecord(value: unknown): boolean {
  if (value === null) return true;
  return shape(value, [
    'lossId', 'shipId', 'hullId', 'destroyedAtMs', 'systemId', 'siteId', 'encounterId', 'wreckId',
    'wreckExpiresAtMs', 'recoveryStationId', 'incoming', 'finalDamage', 'disablingEffects', 'items',
    'insurance', 'recovery',
  ]) && isEntityId(value['lossId']) && isEntityId(value['shipId']) &&
    isDefinitionIdIn(value['hullId'], 'hull') && count(value['destroyedAtMs']) &&
    isDefinitionIdIn(value['systemId'], 'system') && isDefinitionIdIn(value['siteId'], 'site') &&
    (value['encounterId'] === null || isDefinitionIdIn(value['encounterId'], 'encounter')) &&
    isEntityId(value['wreckId']) && count(value['wreckExpiresAtMs']) &&
    isDefinitionIdIn(value['recoveryStationId'], 'station') &&
    Array.isArray(value['incoming']) && value['incoming'].every(damageSource) &&
    (value['finalDamage'] === null || finalDamage(value['finalDamage'])) &&
    Array.isArray(value['disablingEffects']) && value['disablingEffects'].every(disabling) &&
    Array.isArray(value['items']) && value['items'].every(item) &&
    insurance(value['insurance']) && recovery(value['recovery']);
}

function damageSource(value: unknown): boolean {
  return shape(value, [
    'sourceId', 'nameKey', 'hits', 'firstAtMs', 'lastAtMs', 'rawDamage', 'appliedDamage', 'layerDamage',
  ]) && isEntityId(value['sourceId']) && messageKey(value['nameKey']) && count(value['hits']) &&
    count(value['firstAtMs']) && count(value['lastAtMs']) && value['lastAtMs'] >= value['firstAtMs'] &&
    profile(value['rawDamage']) && profile(value['appliedDamage']) && layers(value['layerDamage']);
}

function finalDamage(value: unknown): boolean {
  return shape(value, ['sourceId', 'nameKey', 'slotKey', 'hits', 'atMs', 'rawDamage', 'appliedDamage']) &&
    isEntityId(value['sourceId']) && messageKey(value['nameKey']) &&
    typeof value['slotKey'] === 'string' && parseSlotKey(value['slotKey']) !== null &&
    count(value['hits']) && count(value['atMs']) &&
    profile(value['rawDamage']) && profile(value['appliedDamage']);
}

function disabling(value: unknown): boolean {
  if (!shape(value, ['kind', 'slot', 'moduleId'])) return false;
  const slot = value['slot'];
  return (LOSS_DISABLING_KINDS as readonly unknown[]).includes(value['kind']) &&
    shape(slot, ['kind', 'index']) && typeof slot['kind'] === 'string' && typeof slot['index'] === 'number' &&
    parseSlotKey(`${slot['kind']}:${String(slot['index'])}`) !== null &&
    isDefinitionIdIn(value['moduleId'], 'module');
}

function item(value: unknown): boolean {
  return shape(value, ['definitionId', 'quantity', 'origin', 'survived', 'recoveryGrant']) &&
    isDefinitionId(value['definitionId']) && /^(item|module|ammo)\./.test(value['definitionId']) &&
    count(value['quantity']) && value['quantity'] > 0 &&
    (LOSS_ITEM_ORIGINS as readonly unknown[]).includes(value['origin']) &&
    typeof value['survived'] === 'boolean' && typeof value['recoveryGrant'] === 'boolean' &&
    !(value['origin'] === 'loaded' && value['survived'] === true);
}

function insurance(value: unknown): boolean {
  return shape(value, [
    'coverage', 'hullReferenceValueCredits', 'payoutFraction', 'payoutCredits', 'enhancedConsumed',
    'recoveryGrantHull',
  ]) && (value['coverage'] === 'basic' || value['coverage'] === 'enhanced') &&
    count(value['hullReferenceValueCredits']) && fraction(value['payoutFraction']) &&
    count(value['payoutCredits']) && typeof value['enhancedConsumed'] === 'boolean' &&
    typeof value['recoveryGrantHull'] === 'boolean' &&
    value['enhancedConsumed'] === (value['coverage'] === 'enhanced') &&
    (value['recoveryGrantHull'] !== true || value['payoutCredits'] === 0);
}

function recovery(value: unknown): boolean {
  return shape(value, ['outcome', 'activeShipId', 'creditsAfter', 'starterReferenceValueCredits']) &&
    (LOSS_RECOVERY_OUTCOMES as readonly unknown[]).includes(value['outcome']) &&
    (value['activeShipId'] === null || isEntityId(value['activeShipId'])) &&
    (value['outcome'] === 'noShip') === (value['activeShipId'] === null) &&
    count(value['creditsAfter']) && count(value['starterReferenceValueCredits']);
}

function profile(value: unknown): boolean {
  return shape(value, [...DAMAGE_TYPES]) && Object.values(value).every(nonNegative);
}
function layers(value: unknown): boolean {
  return shape(value, [...DEFENSE_LAYERS]) && Object.values(value).every(nonNegative);
}
function messageKey(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
function fraction(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function nonNegative(value: unknown): boolean {
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
