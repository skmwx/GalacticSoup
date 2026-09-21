import {
  activeSiteObject,
  activeAttributeConditions,
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
} from '@engine/domain';
import type { SchedulerEntry } from '@engine/domain';
import { clearCombat } from './combat';
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
  if (site === null || actor === null || draft.assets.location.kind !== 'site') return;

  const attributes = movementAttributes(context, draft);
  const elapsedSeconds = (toTimeMs - fromTimeMs) / 1000;
  let control = null;
  const travel = draft.navigation.travel;

  if (travel?.kind === 'warp' && travel.phase !== 'transit') {
    const origin = siteDefinitionPosition(context.content, site.systemId, travel.originSiteId);
    const destination = siteDefinitionPosition(context.content, site.systemId, travel.destinationSiteId);
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
  } else if (draft.navigation.movement !== null) {
    const order = draft.navigation.movement;
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
  if (
    travel?.kind !== 'warp' ||
    travel.phase !== 'preparing' ||
    travel.boundaryEntryId !== entry.entryId ||
    actor === null ||
    draft.assets.location.kind !== 'site'
  ) return;

  const maximumSpeed = movementAttributes(context, draft).maxSpeedKmPerSecond;
  if (!warpReady(context, actor, travel, maximumSpeed)) {
    draft.navigation.travel = { ...travel, phase: 'aligning', boundaryEntryId: null };
    return;
  }

  const ship = draft.assets.ships[draft.assets.activeShipId];
  if (ship === undefined) return;
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
  clearCombat(context, ship.id);
  draft.assets.location = location;
  ship.location = location;
  draft.assets.version += 1;
  draft.navigation.currentSite = null;
  draft.navigation.movement = null;
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
  const ship = draft.assets.ships[draft.assets.activeShipId];
  const location = draft.assets.location;
  if (
    travel?.kind !== 'warp' ||
    travel.phase !== 'transit' ||
    travel.boundaryEntryId !== entry.entryId ||
    ship === undefined ||
    location.kind !== 'warp'
  ) return;

  const origin = siteDefinitionPosition(context.content, location.systemId, travel.originSiteId);
  const destination = siteDefinitionPosition(context.content, location.systemId, travel.destinationSiteId);
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
    scale(direction, -travel.arrivalDistanceKm),
    Math.atan2(direction.y, direction.x),
  );
  draft.assets.location = siteLocation;
  ship.location = siteLocation;
  draft.assets.version += 1;
  draft.navigation.travel = null;
  draft.navigation.movement = { kind: 'stop' };
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
  const ship = draft.assets.ships[draft.assets.activeShipId];
  if (ship === undefined) return;
  clearCombat(context, ship.id);
  const docked = { kind: 'station' as const, stationId: station.id, systemId: station.systemId };
  draft.assets.location = docked;
  ship.location = docked;
  draft.assets.version += 1;
  draft.navigation.currentSite = null;
  draft.navigation.travel = null;
  draft.navigation.movement = null;
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
  travel: { readonly originSiteId: string; readonly destinationSiteId: string },
  maximumSpeed: number,
): boolean {
  const origin = siteDefinitionPosition(context.content, context.draft.assets.location.systemId, travel.originSiteId);
  const destination = siteDefinitionPosition(context.content, context.draft.assets.location.systemId, travel.destinationSiteId);
  if (origin === null || destination === null) return false;
  const angle = Math.atan2(destination.y - origin.y, destination.x - origin.x);
  return (
    Math.abs(angularDifference(actor.facingRadians, angle)) <= context.content.rules.navigation.warpAlignmentRadians &&
    magnitude(actor.velocity) >= maximumSpeed * context.content.rules.navigation.warpMinimumSpeedFraction
  );
}

function movementAttributes(context: SimulationContext, draft: CampaignDraft) {
  const ship = draft.assets.ships[draft.assets.activeShipId];
  if (ship === undefined) throw new TypeError('The active ship does not exist.');
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
  draft.navigation.movement = { kind: 'stop' };
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
