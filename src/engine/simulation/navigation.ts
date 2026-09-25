import {
  activeSiteObject,
  activeAttributeConditions,
  add,
  isDestroyed,
  movementOrderOf,
  setMovementOrder,
  siteShipIds,
  angularDifference,
  attributeValue,
  deterministicDirection,
  distance,
  instantiateSite,
  integrateKinematics,
  magnitude,
  movementControl,
  normalized,
  replaceSiteObject,
  scale,
  shipFit,
  shipCombat,
  siteDefinitionPosition,
  subtract,
  deriveShipAttributes,
  type CampaignDraft,
  type SiteObjectState,
  type WarpLocation,
  type WarpTravelState,
} from '@engine/domain';
import type { SchedulerEntry } from '@engine/domain';
import { clearCombat } from './combat';
import { abandonEncounter, instantiateEncounter, materializeWrecks } from './encounter';
import type { SimulationContext } from './context';
import { cancelBoundary, scheduleBoundary } from './scheduler';

export const WARP_PREPARED_BOUNDARY = 'navigation.warpPrepared';
export const WARP_ARRIVAL_BOUNDARY = 'navigation.warpArrival';
export const DOCK_COMPLETE_BOUNDARY = 'navigation.dockComplete';

/**
 * Integrates player movement before scheduled completions at each fixed
 * simulation interval (Technical Specification 9.2-9.3).
 *
 * @implements TECH-9.2, TECH-9.3, TECH-10.1, FUNC-7.2, FUNC-7.3, FUNC-7.4
 */
export function advanceNavigation(
  context: SimulationContext,
  fromTimeMs: number,
  toTimeMs: number,
): void {
  if (toTimeMs <= fromTimeMs) return;
  const draft = context.draft;
  const site = draft.navigation.currentSite;
  const actor = activeSiteObject(draft);
  const playerId = draft.assets.activeShipId;
  if (site === null || actor === null || playerId === null || draft.assets.location.kind !== 'site') return;

  const attributes = movementAttributes(context, draft, playerId);
  const elapsedSeconds = (toTimeMs - fromTimeMs) / 1000;

  // Every ship present is integrated, not only the player's: an opponent
  // commands its ship with the same orders and the same controllers
  // (Technical Specification 10.3).
  for (const shipId of siteShipIds(draft)) {
    if (shipId === playerId) continue;
    integrateShip(context, shipId, elapsedSeconds);
  }

  let control = null;
  const travel = draft.navigation.travel;

  if (travel?.kind === 'warp' && travel.phase !== 'transit') {
    const origin = siteDefinitionPosition(context.content, site.systemId, travel.originSiteId);
    const destination = warpTarget(context, site.systemId, travel);
    if (origin !== null && destination !== null) {
      control = {
        direction: normalized(subtract(destination, origin)),
        speedKmPerSecond: attributes.maxSpeedKmPerSecond,
      };
    }
  } else if (travel?.kind === 'dock') {
    const target = site.objects[travel.stationId] ?? null;
    if (target === null) {
      cancelForMissingTarget(context, 'dock');
    } else {
      control = movementControl(
        { kind: 'approach', targetId: target.id, distanceKm: 0 },
        actor,
        target,
        attributes,
        context.content.rules.navigation,
      );
    }
  } else {
    const order = movementOrderOf(draft, playerId);
    if (order !== null) {
      const target =
        order.kind === 'approach' || order.kind === 'orbit' || order.kind === 'keepRange'
          ? site.objects[order.targetId] ?? null
          : null;
      if ((order.kind === 'approach' || order.kind === 'orbit' || order.kind === 'keepRange') && target === null) {
        cancelForMissingTarget(context, order.kind);
        control = movementControl({ kind: 'stop' }, actor, null, attributes, context.content.rules.navigation);
      } else {
        control = movementControl(order, actor, target, attributes, context.content.rules.navigation);
      }
    }
  }

  if (control !== null) {
    const next = integrateKinematics(actor, control, attributes, elapsedSeconds);
    replaceSiteObject(draft, { ...actor, ...next });
  }
  separateSite(draft, context.content.rules.navigation.separationSpeedKmPerSecond, elapsedSeconds);
  evaluateTravel(context, toTimeMs, attributes.maxSpeedKmPerSecond);
  draft.navigation.version += 1;
  context.invalidate('navigation');
  context.invalidate('site');
  context.invalidate('frame');
}

export function resolveWarpPrepared(context: SimulationContext, entry: SchedulerEntry): void {
  const draft = context.draft;
  const travel = draft.navigation.travel;
  const actor = activeSiteObject(draft);
  const ship = draftShip(draft);
  if (
    travel?.kind !== 'warp' ||
    travel.phase !== 'preparing' ||
    travel.boundaryEntryId !== entry.entryId ||
    actor === null ||
    ship === null ||
    draft.assets.location.kind !== 'site'
  ) return;

  const maximumSpeed = movementAttributes(context, draft, ship.id).maxSpeedKmPerSecond;
  if (!warpReady(context, actor, travel, maximumSpeed)) {
    draft.navigation.travel = { ...travel, phase: 'aligning', boundaryEntryId: null };
    return;
  }

  const location: WarpLocation = {
    kind: 'warp',
    systemId: draft.assets.location.systemId,
    fromSiteId: travel.originSiteId,
    toSiteId: travel.destinationSiteId,
  };
  const warpSpeed = attributeValue(
    deriveShipAttributes({
      hull: context.content.requireHull(ship.hullId),
      fit: shipFit(draft.assets, ship.id),
      content: context.content,
    }),
    'warpSpeedKmPerSecond',
  );
  const durationMs = Math.max(
    context.content.rules.time.simulationQuantumMs,
    Math.ceil((travel.distanceKm / warpSpeed) * 1000),
  );
  // Leaving the site ends the instance it held (Functional Specification 9.11).
  abandonEncounter(context);
  clearCombat(context, ship.id);
  draft.assets.location = location;
  ship.location = location;
  draft.assets.version += 1;
  draft.navigation.currentSite = null;
  draft.navigation.movementOrders = {};
  const arrival = scheduleBoundary(draft, {
    kind: WARP_ARRIVAL_BOUNDARY,
    dueAtMs: draft.time.simulationTimeMs + durationMs,
    ownerId: ship.id,
  });
  draft.navigation.travel = { ...travel, phase: 'transit', boundaryEntryId: arrival.entryId };
  navigationChanged(context, true);
  context.publish('navigation.warpStarted', {
    originSiteId: travel.originSiteId,
    destinationSiteId: travel.destinationSiteId,
  });
}

export function resolveWarpArrival(context: SimulationContext, entry: SchedulerEntry): void {
  const draft = context.draft;
  const travel = draft.navigation.travel;
  const ship = draftShip(draft);
  const location = draft.assets.location;
  if (
    travel?.kind !== 'warp' ||
    travel.phase !== 'transit' ||
    travel.boundaryEntryId !== entry.entryId ||
    ship === null ||
    location.kind !== 'warp'
  ) return;

  const origin = siteDefinitionPosition(context.content, location.systemId, travel.originSiteId);
  const destination = warpTarget(context, location.systemId, travel);
  const direction =
    origin === null || destination === null
      ? { x: 1, y: 0 }
      : normalized(subtract(destination, origin));
  const siteLocation = {
    kind: 'site' as const,
    systemId: location.systemId,
    siteId: travel.destinationSiteId,
  };
  draft.navigation.currentSite = instantiateSite(
    draft,
    context.content,
    travel.destinationSiteId,
    ship,
    // A bookmark warp arrives at the chosen distance short of the bookmarked
    // point; a site warp short of the site's origin (Functional Specification 7.3).
    add(travel.anchor, scale(direction, -travel.arrivalDistanceKm)),
    Math.atan2(direction.y, direction.x),
  );
  draft.assets.location = siteLocation;
  ship.location = siteLocation;
  draft.assets.version += 1;
  draft.navigation.travel = null;
  setMovementOrder(draft, ship.id, { kind: 'stop' });
  materializeWrecks(context);
  instantiateEncounter(context, travel.destinationSiteId);
  navigationChanged(context, true);
  context.publish('navigation.warpArrived', { siteId: travel.destinationSiteId });
  context.requestAutosave();
}

export function resolveDockComplete(context: SimulationContext, entry: SchedulerEntry): void {
  const draft = context.draft;
  const travel = draft.navigation.travel;
  const actor = activeSiteObject(draft);
  const site = draft.navigation.currentSite;
  if (
    travel?.kind !== 'dock' ||
    travel.phase !== 'preparing' ||
    travel.boundaryEntryId !== entry.entryId ||
    actor === null ||
    site === null
  ) return;
  const stationObject = site.objects[travel.stationId];
  const station = context.content.station(travel.stationId);
  if (
    stationObject === undefined ||
    station === undefined ||
    distance(actor.position, stationObject.position) > context.content.rules.navigation.dockRangeKm
  ) {
    draft.navigation.travel = { ...travel, phase: 'approaching', boundaryEntryId: null };
    return;
  }
  const ship = draftShip(draft);
  if (ship === null) return;
  abandonEncounter(context);
  clearCombat(context, ship.id);
  const docked = { kind: 'station' as const, stationId: station.id, systemId: station.systemId };
  draft.assets.location = docked;
  ship.location = docked;
  // This is now where a destroyed pilot is recovered (Functional Specification 9.12).
  draft.assets.lastDockedStationId = station.id;
  draft.assets.version += 1;
  draft.navigation.currentSite = null;
  draft.navigation.travel = null;
  draft.navigation.movementOrders = {};
  draft.navigation.lastCancellation = {
    orderKind: 'dock',
    reason: 'docked',
    simulationTimeMs: draft.time.simulationTimeMs,
  };
  navigationChanged(context, true);
  context.publish('navigation.docked', { stationId: station.id });
  context.requestAutosave();
}

function evaluateTravel(
  context: SimulationContext,
  intervalEndMs: number,
  maximumSpeed: number,
): void {
  const draft = context.draft;
  const actor = activeSiteObject(draft);
  const travel = draft.navigation.travel;
  const site = draft.navigation.currentSite;
  if (actor === null || travel === null || site === null) return;

  if (travel.kind === 'warp' && travel.phase === 'aligning' && warpReady(context, actor, travel, maximumSpeed)) {
    const boundary = scheduleBoundary(draft, {
      kind: WARP_PREPARED_BOUNDARY,
      dueAtMs: intervalEndMs + context.content.rules.navigation.warpPreparationMs,
      ownerId: draft.assets.activeShipId,
    });
    draft.navigation.travel = { ...travel, phase: 'preparing', boundaryEntryId: boundary.entryId };
    context.publish('navigation.warpPreparing', { destinationSiteId: travel.destinationSiteId });
  }

  if (travel.kind === 'dock' && travel.phase === 'approaching') {
    const target = site.objects[travel.stationId];
    if (target !== undefined && distance(actor.position, target.position) <= context.content.rules.navigation.dockRangeKm) {
      const boundary = scheduleBoundary(draft, {
        kind: DOCK_COMPLETE_BOUNDARY,
        dueAtMs: intervalEndMs + context.content.rules.navigation.dockDurationMs,
        ownerId: draft.assets.activeShipId,
      });
      draft.navigation.travel = { ...travel, phase: 'preparing', boundaryEntryId: boundary.entryId };
      context.publish('navigation.dockPreparing', { stationId: travel.stationId });
    }
  }
}

function warpReady(
  context: SimulationContext,
  actor: SiteObjectState,
  travel: WarpTravelState,
  maximumSpeed: number,
): boolean {
  const origin = siteDefinitionPosition(context.content, context.draft.assets.location.systemId, travel.originSiteId);
  const destination = warpTarget(context, context.draft.assets.location.systemId, travel);
  if (origin === null || destination === null) return false;
  const angle = Math.atan2(destination.y - origin.y, destination.x - origin.x);
  return (
    Math.abs(angularDifference(actor.facingRadians, angle)) <= context.content.rules.navigation.warpAlignmentRadians &&
    magnitude(actor.velocity) >= maximumSpeed * context.content.rules.navigation.warpMinimumSpeedFraction
  );
}

/**
 * The point a warp heads for in system coordinates: the destination site's
 * position, moved to the bookmarked point for a bookmark warp.
 */
function warpTarget(
  context: SimulationContext,
  systemId: string,
  travel: WarpTravelState,
): { readonly x: number; readonly y: number } | null {
  const site = siteDefinitionPosition(context.content, systemId, travel.destinationSiteId);
  return site === null ? null : add(site, travel.anchor);
}

/** The player's ship as a mutable part of the draft, or `null` without one. */
function draftShip(draft: CampaignDraft) {
  const shipId = draft.assets.activeShipId;
  return shipId === null ? null : (draft.assets.ships[shipId] ?? null);
}

function movementAttributes(context: SimulationContext, draft: CampaignDraft, shipId: string) {
  const ship = draft.assets.ships[shipId];
  if (ship === undefined) throw new TypeError(`Ship "${shipId}" does not exist.`);
  const fit = shipFit(draft.assets, ship.id);
  const derived = deriveShipAttributes({
    hull: context.content.requireHull(ship.hullId),
    fit,
    content: context.content,
    conditions: activeAttributeConditions(fit, context.content, shipCombat(draft, ship.id)),
  });
  return {
    maxSpeedKmPerSecond: attributeValue(derived, 'maxSpeedKmPerSecond'),
    accelerationKmPerSecondSquared: attributeValue(derived, 'accelerationKmPerSecondSquared'),
    brakingKmPerSecondSquared: attributeValue(derived, 'brakingKmPerSecondSquared'),
    turnRateRadiansPerSecond: attributeValue(derived, 'turnRateRadiansPerSecond'),
  };
}

/**
 * Moves one ship other than the player's under its own standing order.
 *
 * A destroyed ship drifts: it keeps its velocity and stops steering, which is
 * what a wreck-to-be should do until the encounter replaces it.
 */
function integrateShip(context: SimulationContext, shipId: string, elapsedSeconds: number): void {
  const draft = context.draft;
  const site = draft.navigation.currentSite;
  const object = site?.objects[shipId];
  if (site === null || object === undefined || draft.assets.ships[shipId] === undefined) return;

  const attributes = movementAttributes(context, draft, shipId);
  const order = isDestroyed(draft, shipId) ? { kind: 'stop' as const } : movementOrderOf(draft, shipId);
  if (order === null) return;

  const target =
    order.kind === 'approach' || order.kind === 'orbit' || order.kind === 'keepRange'
      ? site.objects[order.targetId] ?? null
      : null;
  // Functional Specification 22.5: a dependent order stops safely when its
  // target disappears. An opponent's cancellation is not reported to the
  // player, whose own cancellations are what the interface explains.
  const missingTarget =
    (order.kind === 'approach' || order.kind === 'orbit' || order.kind === 'keepRange') &&
    target === null;
  if (missingTarget) setMovementOrder(draft, shipId, { kind: 'stop' });

  const control = movementControl(
    missingTarget ? { kind: 'stop' } : order,
    object,
    target,
    attributes,
    context.content.rules.navigation,
  );
  if (control === null) return;
  replaceSiteObject(draft, { ...object, ...integrateKinematics(object, control, attributes, elapsedSeconds) });
}

function separateSite(draft: CampaignDraft, speed: number, elapsedSeconds: number): void {
  const site = draft.navigation.currentSite;
  if (site === null) return;
  const objects = Object.values(site.objects).sort((a, b) => a.id.localeCompare(b.id));
  for (let first = 0; first < objects.length; first += 1) {
    for (let second = first + 1; second < objects.length; second += 1) {
      const a = objects[first];
      const b = objects[second];
      if (a === undefined || b === undefined || (!a.movable && !b.movable)) continue;
      const separation = subtract(b.position, a.position);
      const range = magnitude(separation);
      const overlap = a.radiusKm + b.radiusKm - range;
      if (overlap <= 0) continue;
      const direction = normalized(separation, deterministicDirection(a.id, b.id));
      const correction = Math.min(overlap, speed * elapsedSeconds);
      const movable = Number(a.movable) + Number(b.movable);
      if (a.movable) {
        const moved = { ...a, position: subtract(a.position, scale(direction, correction / movable)) };
        replaceSiteObject(draft, moved);
        objects[first] = moved;
      }
      if (b.movable) {
        const moved = { ...b, position: subtract(b.position, scale(direction, -correction / movable)) };
        replaceSiteObject(draft, moved);
        objects[second] = moved;
      }
    }
  }
}

function cancelForMissingTarget(context: SimulationContext, orderKind: 'approach' | 'orbit' | 'keepRange' | 'dock'): void {
  const draft = context.draft;
  const boundary = draft.navigation.travel?.boundaryEntryId;
  if (boundary !== null && boundary !== undefined) cancelBoundary(draft, boundary);
  draft.navigation.travel = null;
  if (draft.assets.activeShipId !== null) setMovementOrder(draft, draft.assets.activeShipId, { kind: 'stop' });
  draft.navigation.lastCancellation = {
    orderKind,
    reason: 'targetMissing',
    simulationTimeMs: draft.time.simulationTimeMs,
  };
  context.publish('navigation.movementCancelled', { orderKind, reason: 'targetMissing' });
}

function navigationChanged(context: SimulationContext, locationChanged: boolean): void {
  context.draft.navigation.version += 1;
  context.invalidate('navigation');
  context.invalidate('site');
  context.invalidate('destinations');
  context.invalidate('frame');
  if (locationChanged) {
    context.invalidate('assets');
    context.invalidate('ship');
    context.invalidate('inventory');
    context.invalidate('station');
  }
}
