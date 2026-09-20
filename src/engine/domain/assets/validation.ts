import type { ContentRepository } from '@engine/ports';
import { isDefinitionId, isCount, canonicalJson } from '@shared';
import { isEntityId } from '../campaign/identity';
import type { CampaignState } from '../campaign/state';
import { usedVolume } from './inventory';
import type { AssetState } from './types';

type Report = (rule: string, path: string, detail: string) => void;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function definition(value: unknown, prefix: string): boolean {
  return isDefinitionId(value) && value.startsWith(`${prefix}.`);
}
function docked(value: unknown): boolean {
  return shape(value, ['kind', 'stationId', 'systemId']) && value['kind'] === 'station' &&
    definition(value['stationId'], 'station') && definition(value['systemId'], 'system');
}
function location(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value['kind']) {
    case 'hangar': return shape(value, ['kind', 'stationId']) && definition(value['stationId'], 'station');
    case 'cargo': return shape(value, ['kind', 'shipId']) && isEntityId(value['shipId']);
    case 'reserve': return shape(value, ['kind', 'sourceInventoryId', 'ownerId']) &&
      isEntityId(value['sourceInventoryId']) && isEntityId(value['ownerId']);
    default: return false;
  }
}
function capacity(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value['kind']) {
    case 'unlimited': return shape(value, ['kind']);
    case 'limited': return shape(value, ['kind', 'volumeCubicDecimetres']) && isCount(value['volumeCubicDecimetres']);
    case 'shared': return shape(value, ['kind', 'inventoryId']) && isEntityId(value['inventoryId']);
    default: return false;
  }
}
/** Strict runtime counterpart of the save schema; runs before dereferencing any stored entity. */
export function isAssetState(value: unknown): value is AssetState {
  if (!shape(value, ['credits', 'location', 'activeShipId', 'ships', 'inventories', 'stacks']) ||
      !isCount(value['credits']) || !docked(value['location']) || !isEntityId(value['activeShipId'])) return false;
  const ships = value['ships'], inventories = value['inventories'], stacks = value['stacks'];
  if (!record(ships) || !record(inventories) || !record(stacks)) return false;
  if (![ships, inventories, stacks].every((map) => Object.keys(map).every(isEntityId))) return false;
  if (!Object.values(ships).every((ship) => shape(ship, ['id', 'hullId', 'cargoInventoryId', 'location']) &&
    isEntityId(ship['id']) && definition(ship['hullId'], 'hull') && isEntityId(ship['cargoInventoryId']) && docked(ship['location']))) return false;
  if (!Object.values(inventories).every((inv) => shape(inv, ['id', 'location', 'capacity']) &&
    isEntityId(inv['id']) && location(inv['location']) && capacity(inv['capacity']))) return false;
  return Object.values(stacks).every((s) => {
    if (!shape(s, ['id', 'definitionId', 'quantity', 'inventoryId', 'state', 'provenance']) ||
      !isEntityId(s['id']) || !isEntityId(s['inventoryId']) || !isDefinitionId(s['definitionId']) ||
      !/^(item|module|ammo)\./.test(s['definitionId']) || !isCount(s['quantity']) || s['quantity'] === 0 || s['state'] !== 'plain') return false;
    const p = s['provenance'];
    return shape(p, ['grantedQuantity', 'purchasedQuantity', 'purchaseCostCredits']) && Object.values(p).every(isCount);
  });
}

/** @implements TECH-15.3, TECH-8.3, FUNC-22.2, FUNC-22.3 */
export function validateAssets(state: CampaignState, add: Report, content?: ContentRepository): void {
  if (!isAssetState(state.assets)) {
    add('assetShape', 'assets', 'Assets have an unknown field, missing field or invalid value.');
    return;
  }
  const a = state.assets;
  const fail = (path: string, detail: string) => add('assetOwnership', `assets.${path}`, detail);
  const seen = new Set<string>(state.scheduler.entries.map((entry) => entry.entryId));
  for (const [name, map] of Object.entries({ ships: a.ships, inventories: a.inventories, stacks: a.stacks })) {
    for (const [key, entity] of Object.entries(map)) {
      const ordinal = Number(key.split('-e')[1]);
      if (entity.id !== key || seen.has(key) || !key.startsWith(`${state.campaignId}-e`) ||
          !Number.isSafeInteger(ordinal) || ordinal >= state.nextEntityOrdinal) fail(`${name}.${key}`, 'Identity is duplicated, foreign or beyond the allocated ordinal.');
      seen.add(key);
    }
  }
  const active = a.ships[a.activeShipId];
  if (active === undefined || canonicalJson(active.location) !== canonicalJson(a.location)) fail('activeShipId', 'One active ship must share the campaign location.');
  const hangars = new Set<string>();
  for (const inv of Object.values(a.inventories)) {
    const loc = inv.location, cap = inv.capacity;
    if (loc.kind === 'hangar') {
      if (cap.kind !== 'unlimited' || hangars.has(loc.stationId)) fail(`inventories.${inv.id}`, 'Each station has one unlimited hangar.');
      hangars.add(loc.stationId);
      if (content && !content.station(loc.stationId)) fail(`inventories.${inv.id}`, 'Station does not resolve.');
    } else if (loc.kind === 'cargo') {
      if (cap.kind !== 'limited' || a.ships[loc.shipId]?.cargoInventoryId !== inv.id) fail(`inventories.${inv.id}`, 'Cargo must belong to exactly one ship.');
    } else {
      const source = a.inventories[loc.sourceInventoryId];
      if (!a.ships[loc.ownerId] || !source || source.location.kind === 'reserve' ||
          cap.kind !== 'shared' || cap.inventoryId !== loc.sourceInventoryId) fail(`inventories.${inv.id}`, 'Reserve owner, source or capacity is invalid.');
    }
  }
  for (const ship of Object.values(a.ships)) {
    const cargo = a.inventories[ship.cargoInventoryId];
    if (cargo?.location.kind !== 'cargo' || cargo.location.shipId !== ship.id) fail(`ships.${ship.id}`, 'Ship cargo does not resolve.');
    if (content) {
      if (!content.hull(ship.hullId)?.playerUsable) fail(`ships.${ship.id}.hullId`, 'Hull is not player-usable.');
      if (content.station(ship.location.stationId)?.systemId !== ship.location.systemId) fail(`ships.${ship.id}.location`, 'Station and system do not agree.');
    }
  }
  for (const stack of Object.values(a.stacks)) {
    if (!a.inventories[stack.inventoryId]) fail(`stacks.${stack.id}`, 'An item must occupy one existing inventory.');
    const p = stack.provenance;
    if (!Number.isSafeInteger(p.grantedQuantity + p.purchasedQuantity) || p.grantedQuantity + p.purchasedQuantity !== stack.quantity ||
        (p.purchasedQuantity === 0 && p.purchaseCostCredits !== 0)) fail(`stacks.${stack.id}.provenance`, 'Provenance must account for every unit and credit.');
    if (content && !content.tradeable(stack.definitionId)) fail(`stacks.${stack.id}.definitionId`, 'Item definition does not resolve.');
  }
  if (content) {
    for (const inv of Object.values(a.inventories)) {
      try {
        const used = usedVolume(a, content, inv.id);
        if (inv.capacity.kind === 'limited' && used > inv.capacity.volumeCubicDecimetres) fail(`inventories.${inv.id}.capacity`, 'Inventory exceeds capacity.');
      } catch { fail(`inventories.${inv.id}.capacity`, 'Volume or capacity reference is invalid.'); }
    }
  }
}
