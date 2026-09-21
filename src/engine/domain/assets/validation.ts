import { DEFENSE_LAYERS, type ContentRepository } from '@engine/ports';
import { isDefinitionId, isCount, isNonNegativeNumber, canonicalJson } from '@shared';
import { attributeValue, deriveShipAttributes } from '../attributes';
import { isEntityId } from '../campaign/identity';
import type { CampaignState } from '../campaign/state';
import { shipFit } from '../fitting/fit';
import { parseSlotKey, slotKey } from '../fitting/types';
import { assessFit, structuralViolations } from '../fitting/validity';
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
function shipLocation(value: unknown): boolean {
  if (docked(value)) return true;
  if (!record(value)) return false;
  if (value['kind'] === 'site') {
    return shape(value, ['kind', 'siteId', 'systemId']) &&
      definition(value['siteId'], 'site') && definition(value['systemId'], 'system');
  }
  if (value['kind'] === 'warp') {
    return shape(value, ['kind', 'fromSiteId', 'toSiteId', 'systemId']) &&
      definition(value['fromSiteId'], 'site') && definition(value['toSiteId'], 'site') &&
      definition(value['systemId'], 'system');
  }
  return false;
}
function location(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value['kind']) {
    case 'hangar': return shape(value, ['kind', 'stationId']) && definition(value['stationId'], 'station');
    case 'cargo': case 'fitting': return shape(value, ['kind', 'shipId']) && isEntityId(value['shipId']);
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
function slot(value: unknown): boolean {
  return shape(value, ['kind', 'index']) && typeof value['kind'] === 'string' &&
    typeof value['index'] === 'number' && parseSlotKey(`${value['kind']}:${String(value['index'])}`) !== null;
}
/** What a stack is doing (Functional Specification 8.4). */
function stackState(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value['kind']) {
    case 'plain': return shape(value, ['kind']);
    case 'fitted': return shape(value, ['kind', 'slot', 'online']) && slot(value['slot']) &&
      typeof value['online'] === 'boolean';
    case 'charge': return shape(value, ['kind', 'slot']) && slot(value['slot']);
    default: return false;
  }
}
function condition(value: unknown): boolean {
  if (!shape(value, ['damage', 'capacitorCharge']) || !isNonNegativeNumber(value['capacitorCharge'])) return false;
  const damage = value['damage'];
  return shape(damage, [...DEFENSE_LAYERS]) && Object.values(damage).every(isNonNegativeNumber);
}
function insurance(value: unknown): boolean {
  return shape(value, ['coverage', 'premiumPaidCredits']) &&
    (value['coverage'] === 'basic' || value['coverage'] === 'enhanced') &&
    isCount(value['premiumPaidCredits']);
}
/** Strict runtime counterpart of the save schema; runs before dereferencing any stored entity. */
export function isAssetState(value: unknown): value is AssetState {
  if (!shape(value, ['version', 'credits', 'location', 'activeShipId', 'ships', 'inventories', 'stacks']) ||
      !isCount(value['version']) || value['version'] === 0 || !isCount(value['credits']) ||
      !shipLocation(value['location']) || !isEntityId(value['activeShipId'])) return false;
  const ships = value['ships'], inventories = value['inventories'], stacks = value['stacks'];
  if (!record(ships) || !record(inventories) || !record(stacks)) return false;
  if (![ships, inventories, stacks].every((map) => Object.keys(map).every(isEntityId))) return false;
  if (!Object.values(ships).every((ship) => shape(ship, ['id', 'hullId', 'cargoInventoryId', 'fittingInventoryId', 'location', 'condition', 'insurance']) &&
    isEntityId(ship['id']) && definition(ship['hullId'], 'hull') && isEntityId(ship['cargoInventoryId']) &&
    isEntityId(ship['fittingInventoryId']) && shipLocation(ship['location']) && condition(ship['condition']) &&
    insurance(ship['insurance']))) return false;
  if (!Object.values(inventories).every((inv) => shape(inv, ['id', 'location', 'capacity']) &&
    isEntityId(inv['id']) && location(inv['location']) && capacity(inv['capacity']))) return false;
  return Object.values(stacks).every((s) => {
    if (!shape(s, ['id', 'definitionId', 'quantity', 'inventoryId', 'state', 'provenance']) ||
      !isEntityId(s['id']) || !isEntityId(s['inventoryId']) || !isDefinitionId(s['definitionId']) ||
      !/^(item|module|ammo)\./.test(s['definitionId']) || !isCount(s['quantity']) || s['quantity'] === 0 ||
      !stackState(s['state'])) return false;
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
    } else if (loc.kind === 'fitting') {
      if (cap.kind !== 'unlimited' || a.ships[loc.shipId]?.fittingInventoryId !== inv.id) fail(`inventories.${inv.id}`, 'A fitting store must belong to exactly one ship.');
    } else {
      const source = a.inventories[loc.sourceInventoryId];
      if (!a.ships[loc.ownerId] || !source || source.location.kind === 'reserve' ||
          cap.kind !== 'shared' || cap.inventoryId !== loc.sourceInventoryId) fail(`inventories.${inv.id}`, 'Reserve owner, source or capacity is invalid.');
    }
  }
  for (const ship of Object.values(a.ships)) {
    const cargo = a.inventories[ship.cargoInventoryId];
    if (cargo?.location.kind !== 'cargo' || cargo.location.shipId !== ship.id) fail(`ships.${ship.id}`, 'Ship cargo does not resolve.');
    const fitting = a.inventories[ship.fittingInventoryId];
    if (fitting?.location.kind !== 'fitting' || fitting.location.shipId !== ship.id) fail(`ships.${ship.id}`, 'Ship fitting store does not resolve.');
    if (content) {
      if (!content.hull(ship.hullId)?.playerUsable) fail(`ships.${ship.id}.hullId`, 'Hull is not player-usable.');
      const system = content.system(ship.location.systemId);
      if (system === undefined) {
        fail(`ships.${ship.id}.location`, 'System does not resolve.');
      } else if (ship.location.kind === 'station') {
        if (content.station(ship.location.stationId)?.systemId !== ship.location.systemId) {
          fail(`ships.${ship.id}.location`, 'Station and system do not agree.');
        }
      } else {
        const siteIds = new Set(system.sites.map((site) => site.id));
        if (ship.location.kind === 'site' && !siteIds.has(ship.location.siteId)) {
          fail(`ships.${ship.id}.location`, 'Site and system do not agree.');
        }
        if (ship.location.kind === 'warp' &&
          (!siteIds.has(ship.location.fromSiteId) || !siteIds.has(ship.location.toSiteId))) {
          fail(`ships.${ship.id}.location`, 'Warp endpoints and system do not agree.');
        }
      }
    }
  }
  for (const stack of Object.values(a.stacks)) {
    const inventory = a.inventories[stack.inventoryId];
    if (!inventory) fail(`stacks.${stack.id}`, 'An item must occupy one existing inventory.');
    else if ((inventory.location.kind === 'fitting') !== (stack.state.kind !== 'plain')) {
      fail(`stacks.${stack.id}.state`, 'Only a fitting store holds fitted modules and loaded charges.');
    }
    const p = stack.provenance;
    if (!Number.isSafeInteger(p.grantedQuantity + p.purchasedQuantity) || p.grantedQuantity + p.purchasedQuantity !== stack.quantity ||
        (p.purchasedQuantity === 0 && p.purchaseCostCredits !== 0)) fail(`stacks.${stack.id}.provenance`, 'Provenance must account for every unit and credit.');
    if (content && !content.tradeable(stack.definitionId)) fail(`stacks.${stack.id}.definitionId`, 'Item definition does not resolve.');
  }
  validateFits(state, add, content);
  if (content) {
    for (const inv of Object.values(a.inventories)) {
      try {
        const used = usedVolume(a, content, inv.id);
        if (inv.capacity.kind === 'limited' && used > inv.capacity.volumeCubicDecimetres) fail(`inventories.${inv.id}.capacity`, 'Inventory exceeds capacity.');
      } catch { fail(`inventories.${inv.id}.capacity`, 'Volume or capacity reference is invalid.'); }
    }
  }
}

/**
 * Fitting consistency (Technical Specification 15.3, check 6).
 *
 * Slots hold at most one module, a charge needs the weapon that holds it, and
 * stored condition stays inside what the fit derives. Slot counts, hardpoints
 * and fitting resources are checked here too, so a campaign can never persist
 * a fit the fitting rules would refuse.
 */
function validateFits(state: CampaignState, add: Report, content?: ContentRepository): void {
  const assets = state.assets;
  const fail = (path: string, detail: string) => add('fittingConsistency', path, detail);

  for (const ship of Object.values(assets.ships)) {
    const occupied = new Set<string>();
    const charged = new Set<string>();

    for (const stack of Object.values(assets.stacks)) {
      if (stack.inventoryId !== ship.fittingInventoryId || stack.state.kind === 'plain') continue;
      const key = slotKey(stack.state.slot);
      if (stack.state.kind === 'fitted') {
        if (stack.quantity !== 1) fail(`assets.stacks.${stack.id}`, 'A fitted module is exactly one unit.');
        if (occupied.has(key)) fail(`assets.stacks.${stack.id}`, `Slot ${key} holds more than one module.`);
        occupied.add(key);
        if (!stack.definitionId.startsWith('module.')) fail(`assets.stacks.${stack.id}`, 'Only a module can be fitted.');
      } else {
        if (charged.has(key)) fail(`assets.stacks.${stack.id}`, `Slot ${key} holds more than one charge.`);
        charged.add(key);
        if (!stack.definitionId.startsWith('ammo.')) fail(`assets.stacks.${stack.id}`, 'Only ammunition can be loaded.');
      }
    }

    for (const key of charged) {
      if (!occupied.has(key)) fail(`assets.ships.${ship.id}`, `Slot ${key} holds a charge but no module.`);
    }

    if (content === undefined) continue;
    const hull = content.hull(ship.hullId);
    if (hull === undefined) continue;
    const fit = shipFit(assets, ship.id);
    const derived = deriveShipAttributes({ hull, fit, content });
    for (const layer of DEFENSE_LAYERS) {
      if (ship.condition.damage[layer] > attributeValue(derived, `${layer}HitPoints`) + TOLERANCE) {
        fail(`assets.ships.${ship.id}.condition.damage.${layer}`, 'Damage exceeds the derived maximum.');
      }
    }
    if (ship.condition.capacitorCharge > attributeValue(derived, 'capacitorCapacity') + TOLERANCE) {
      fail(`assets.ships.${ship.id}.condition.capacitorCharge`, 'Charge exceeds the derived capacity.');
    }
    // A power or processing overrun is a fit the player may keep and correct;
    // it blocks undocking rather than storage (Functional Specification 8.4).
    for (const violation of structuralViolations(assessFit({ hull, fit, content, derived }).violations)) {
      fail(`assets.ships.${ship.id}.fit`, `The stored fit breaks the ${violation.code} rule.`);
    }
  }

  const draft = state.fitting;
  if (draft === null) return;
  if (assets.ships[draft.shipId] === undefined) {
    fail('fitting.shipId', 'A fitting draft must belong to an owned ship.');
  }
  if (!Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0) {
    fail('fitting.baseRevision', 'A fitting draft records the revision it was opened at.');
  }
  for (const key of Object.keys(draft.slots)) {
    const planned = draft.slots[key];
    if (parseSlotKey(key) === null) fail(`fitting.slots.${key}`, 'Unknown slot key.');
    if (planned === undefined) continue;
    if (!planned.moduleId.startsWith('module.')) fail(`fitting.slots.${key}.moduleId`, 'A planned slot names a module.');
    if (planned.ammunitionId !== null && !planned.ammunitionId.startsWith('ammo.')) {
      fail(`fitting.slots.${key}.ammunitionId`, 'A planned charge names ammunition.');
    }
    if (content !== undefined) {
      if (content.module(planned.moduleId) === undefined) fail(`fitting.slots.${key}.moduleId`, 'Module does not resolve.');
      if (planned.ammunitionId !== null && content.ammunition(planned.ammunitionId) === undefined) {
        fail(`fitting.slots.${key}.ammunitionId`, 'Ammunition does not resolve.');
      }
    }
  }
}

/** Derived maxima are fractional; stored condition may sit exactly on them. */
const TOLERANCE = 1e-9;
