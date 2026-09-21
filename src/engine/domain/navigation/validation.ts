import type { ContentRepository } from '@engine/ports';
import { isDefinitionIdIn, isNonNegativeNumber } from '@shared';
import { isEntityId } from '../campaign/identity';
import type { CampaignState } from '../campaign/state';
import {
  MOVEMENT_CANCELLATION_REASONS,
  MOVEMENT_ORDER_KINDS,
  type NavigationState,
  type SiteObjectState,
  type Vector2,
} from './types';

type Report = (rule: string, path: string, detail: string) => void;

export function isNavigationState(value: unknown): value is NavigationState {
  if (!shape(value, [
    'version', 'knownDestinationSiteIds', 'selectedEncounterId', 'currentSite',
    'movement', 'travel', 'lastCancellation',
  ])) return false;
  if (!count(value['version']) || value['version'] < 1) return false;
  if (!Array.isArray(value['knownDestinationSiteIds']) ||
    !value['knownDestinationSiteIds'].every((id) => isDefinitionIdIn(id, 'site'))) return false;
  if (value['selectedEncounterId'] !== null && !isDefinitionIdIn(value['selectedEncounterId'], 'encounter')) return false;
  if (!siteRuntime(value['currentSite']) || !movement(value['movement']) ||
    !travel(value['travel']) || !cancellation(value['lastCancellation'])) return false;
  return true;
}

/** Navigation consistency and target/scheduler reference checks. */
export function validateNavigation(
  state: CampaignState,
  add: Report,
  content?: ContentRepository,
): void {
  if (!isNavigationState(state.navigation)) {
    add('navigationShape', 'navigation', 'Navigation has an unknown field, missing field or invalid value.');
    return;
  }
  const navigation = state.navigation;
  const location = state.assets.location;
  const site = navigation.currentSite;
  const fail = (path: string, detail: string) => add('navigationConsistency', `navigation.${path}`, detail);

  if (new Set(navigation.knownDestinationSiteIds).size !== navigation.knownDestinationSiteIds.length) {
    fail('knownDestinationSiteIds', 'Known destination sites must be unique.');
  }

  if (location.kind === 'site') {
    if (site === null || site.siteId !== location.siteId || site.systemId !== location.systemId) {
      fail('currentSite', 'A site location must have its matching loaded runtime.');
    }
  } else if (site !== null) {
    fail('currentSite', 'A docked or warping ship cannot retain a loaded tactical site.');
  }
  if (site !== null) {
    const player = site.objects[state.assets.activeShipId];
    if (player?.kind !== 'ship' || !player.movable) fail('currentSite.objects', 'The active ship must be the movable player object.');
    const ordinal = Number(site.instanceId.split('-e')[1]);
    if (!Number.isSafeInteger(ordinal) || ordinal >= state.nextEntityOrdinal ||
      state.assets.ships[site.instanceId] !== undefined || state.scheduler.entries.some((entry) => entry.entryId === site.instanceId)) {
      fail('currentSite.instanceId', 'The site instance identity is invalid or duplicated.');
    }
    for (const [id, object] of Object.entries(site.objects)) {
      if (object.id !== id) fail(`currentSite.objects.${id}`, 'The object key and id must agree.');
    }
  }

  const movementOrder = navigation.movement;
  if (movementOrder !== null && location.kind !== 'site') {
    fail('movement', 'A normal-space movement order requires a loaded site.');
  }
  if (movementOrder !== null && 'targetId' in movementOrder && site?.objects[movementOrder.targetId] === undefined) {
    fail('movement.targetId', 'A movement target must be present in the loaded site.');
  }
  const travelState = navigation.travel;
  if (travelState?.kind === 'warp') {
    if (travelState.phase === 'transit') {
      if (location.kind !== 'warp' || travelState.boundaryEntryId === null) {
        fail('travel.phase', 'An in-transit warp requires its warp location and arrival boundary.');
      }
    } else if (
      location.kind !== 'site' ||
      location.siteId !== travelState.originSiteId ||
      (travelState.phase === 'aligning') !== (travelState.boundaryEntryId === null)
    ) {
      fail('travel.phase', 'Warp alignment and preparation require the origin site and matching boundary state.');
    }
  } else if (travelState?.kind === 'dock') {
    if (
      location.kind !== 'site' ||
      site?.objects[travelState.stationId]?.kind !== 'station' ||
      (travelState.phase === 'approaching') !== (travelState.boundaryEntryId === null)
    ) {
      fail('travel.phase', 'Docking requires its station target and matching boundary state.');
    }
  }
  if (travelState?.boundaryEntryId !== null && travelState?.boundaryEntryId !== undefined) {
    const scheduled = state.scheduler.entries.find((entry) => entry.entryId === travelState.boundaryEntryId);
    const expectedKind = travelState.kind === 'dock'
      ? 'navigation.dockComplete'
      : travelState.phase === 'preparing'
        ? 'navigation.warpPrepared'
        : 'navigation.warpArrival';
    if (
      scheduled === undefined ||
      scheduled.ownerId !== state.assets.activeShipId ||
      scheduled.kind !== expectedKind
    ) {
      fail('travel.boundaryEntryId', 'The travel completion boundary must exist and belong to the active ship.');
    }
  }

  if (navigation.lastCancellation !== null && navigation.lastCancellation.simulationTimeMs > state.time.simulationTimeMs) {
    fail('lastCancellation.simulationTimeMs', 'A cancellation cannot occur in the future.');
  }

  if (content !== undefined) {
    const system = content.system(location.systemId);
    const authoredSites = new Set(system?.sites.map((entry) => entry.id) ?? []);
    for (const siteId of navigation.knownDestinationSiteIds) {
      if (!authoredSites.has(siteId)) fail('knownDestinationSiteIds', `Known site "${siteId}" does not resolve in this system.`);
    }
    if (navigation.selectedEncounterId !== null) {
      const encounter = content.encounter(navigation.selectedEncounterId);
      if (
        encounter === undefined ||
        encounter.systemId !== location.systemId ||
        !navigation.knownDestinationSiteIds.includes(encounter.siteId)
      ) {
        fail('selectedEncounterId', 'The selected encounter does not resolve in this system.');
      }
    }
    if (site !== null) {
      if (!authoredSites.has(site.siteId)) fail('currentSite.siteId', 'The loaded site does not resolve.');
      for (const object of Object.values(site.objects)) {
        const resolves = object.kind === 'ship'
          ? content.hull(object.definitionId) !== undefined
          : content.station(object.definitionId) !== undefined;
        if (!resolves) fail(`currentSite.objects.${object.id}.definitionId`, 'The object definition does not resolve.');
      }
    }
  }
}

function siteRuntime(value: unknown): boolean {
  if (value === null) return true;
  if (!shape(value, ['instanceId', 'systemId', 'siteId', 'objects']) ||
    !isEntityId(value['instanceId']) || !isDefinitionIdIn(value['systemId'], 'system') ||
    !isDefinitionIdIn(value['siteId'], 'site') || !record(value['objects'])) return false;
  return Object.values(value['objects']).every(siteObject);
}

function siteObject(value: unknown): value is SiteObjectState {
  return shape(value, [
    'id', 'kind', 'definitionId', 'nameKey', 'position', 'velocity',
    'facingRadians', 'radiusKm', 'movable',
  ]) && typeof value['id'] === 'string' &&
    (value['kind'] === 'ship' || value['kind'] === 'station') &&
    typeof value['definitionId'] === 'string' && typeof value['nameKey'] === 'string' &&
    vector(value['position']) && vector(value['velocity']) && finite(value['facingRadians']) &&
    isNonNegativeNumber(value['radiusKm']) && typeof value['movable'] === 'boolean';
}

function movement(value: unknown): boolean {
  if (value === null) return true;
  if (!record(value) || typeof value['kind'] !== 'string') return false;
  if (value['kind'] === 'stop') return shape(value, ['kind']);
  if (value['kind'] === 'moveToPoint') return shape(value, ['kind', 'point']) && vector(value['point']);
  return ['approach', 'orbit', 'keepRange'].includes(value['kind']) &&
    shape(value, ['kind', 'targetId', 'distanceKm']) && typeof value['targetId'] === 'string' &&
    isNonNegativeNumber(value['distanceKm']);
}

function travel(value: unknown): boolean {
  if (value === null) return true;
  if (!record(value)) return false;
  if (value['kind'] === 'warp') {
    return shape(value, [
      'kind', 'phase', 'originSiteId', 'destinationSiteId', 'arrivalDistanceKm',
      'distanceKm', 'boundaryEntryId',
    ]) && ['aligning', 'preparing', 'transit'].includes(value['phase'] as string) &&
      isDefinitionIdIn(value['originSiteId'], 'site') && isDefinitionIdIn(value['destinationSiteId'], 'site') &&
      isNonNegativeNumber(value['arrivalDistanceKm']) && isNonNegativeNumber(value['distanceKm']) &&
      (value['boundaryEntryId'] === null || isEntityId(value['boundaryEntryId']));
  }
  return value['kind'] === 'dock' && shape(value, ['kind', 'phase', 'stationId', 'boundaryEntryId']) &&
    ['approaching', 'preparing'].includes(value['phase'] as string) && isDefinitionIdIn(value['stationId'], 'station') &&
    (value['boundaryEntryId'] === null || isEntityId(value['boundaryEntryId']));
}

function cancellation(value: unknown): boolean {
  return value === null || (shape(value, ['orderKind', 'reason', 'simulationTimeMs']) &&
    typeof value['orderKind'] === 'string' &&
    ([...MOVEMENT_ORDER_KINDS, 'warp', 'dock'] as readonly string[]).includes(value['orderKind']) &&
    typeof value['reason'] === 'string' &&
    (MOVEMENT_CANCELLATION_REASONS as readonly string[]).includes(value['reason']) &&
    count(value['simulationTimeMs']));
}

function vector(value: unknown): value is Vector2 {
  return shape(value, ['x', 'y']) && finite(value['x']) && finite(value['y']);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
