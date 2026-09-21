import {
  APPLIED,
  reject,
  UNCHANGED,
  type CommandOutcome,
  type Transaction,
} from './transaction';
import {
  assessFit,
  deriveShipAttributes,
  instantiateSite,
  shipFit,
  siteDefinitionPosition,
  type CampaignDraft,
  type MovementOrder,
  type SiteLocation,
} from '@engine/domain';
import { distance } from '@engine/domain';
import { cancelBoundary } from '@engine/simulation';
import type {
  DockPayload,
  MoveToPointPayload,
  TargetRangePayload,
  WarpPayload,
} from '@protocol';
import type { EncounterId, SiteId, StationId } from '@shared';

/**
 * Phase 9 navigation commands (Functional Specification 7.1-7.4).
 *
 * Every order changes only the transaction draft. Simulation-time state
 * machines perform movement and transitions later; the UI never moves a ship.
 *
 * @implements FUNC-7.1, FUNC-7.2, FUNC-7.3, FUNC-7.4, FUNC-22.5, FUNC-22.10, FUNC-22.11, MVP-AC-03, MVP-AC-08
 */
export function handleNavigationCommand(
  transaction: Transaction,
  type:
    | 'navigation.selectDestination'
    | 'ship.undock'
    | 'movement.approach'
    | 'movement.orbit'
    | 'movement.keepRange'
    | 'movement.moveToPoint'
    | 'movement.stop'
    | 'navigation.warp'
    | 'navigation.retreat'
    | 'navigation.dock',
  payload: unknown,
): CommandOutcome {
  switch (type) {
    case 'navigation.selectDestination':
      return selectDestination(transaction, (payload as { encounterId: string }).encounterId);
    case 'ship.undock':
      return undock(transaction);
    case 'movement.approach':
    case 'movement.orbit':
    case 'movement.keepRange':
      return targetOrder(transaction, type.slice('movement.'.length) as 'approach' | 'orbit' | 'keepRange', payload as TargetRangePayload);
    case 'movement.moveToPoint':
      return setMovement(transaction, {
        kind: 'moveToPoint',
        point: { x: (payload as MoveToPointPayload).xKm, y: (payload as MoveToPointPayload).yKm },
      });
    case 'movement.stop':
      return setMovement(transaction, { kind: 'stop' });
    case 'navigation.warp':
      return beginWarp(transaction, payload as WarpPayload, false);
    case 'navigation.retreat':
      return retreat(transaction);
    case 'navigation.dock':
      return dock(transaction, payload as DockPayload);
    default:
      return assertUnreachable(type);
  }
}

function selectDestination(transaction: Transaction, encounterId: string): CommandOutcome {
  const draft = transaction.requireDraft();
  if (draft.assets.location.kind !== 'station') return reject('destinationSelectionUnavailable');
  const encounter = transaction.content.encounter(encounterId);
  if (
    encounter === undefined ||
    encounter.systemId !== draft.assets.location.systemId ||
    !draft.navigation.knownDestinationSiteIds.includes(encounter.siteId)
  ) {
    return reject('destinationUnknown');
  }
  if (draft.navigation.selectedEncounterId === encounter.id) return UNCHANGED;
  draft.navigation.selectedEncounterId = encounter.id as EncounterId;
  changed(transaction, false);
  transaction.publish('navigation.destinationSelected', {
    encounterId: encounter.id,
    siteId: encounter.siteId,
  });
  return APPLIED;
}

function undock(transaction: Transaction): CommandOutcome {
  const draft = transaction.requireDraft();
  const location = draft.assets.location;
  if (location.kind !== 'station') return reject('undockUnavailable');
  if (draft.fitting !== null) return reject('fittingDraftOpen');
  const ship = draft.assets.ships[draft.assets.activeShipId];
  if (ship === undefined || ship.location.kind !== 'station') return reject('undockUnavailable');
  const hull = transaction.content.requireHull(ship.hullId);
  const assessment = assessFit({
    hull,
    fit: shipFit(draft.assets, ship.id),
    content: transaction.content,
    derived: deriveShipAttributes({
      hull,
      fit: shipFit(draft.assets, ship.id),
      content: transaction.content,
    }),
  });
  if (assessment.violations.length > 0) return reject('undockInvalidFit');

  const station = transaction.content.requireStation(location.stationId);
  const siteLocation: SiteLocation = {
    kind: 'site',
    systemId: location.systemId,
    siteId: station.siteId,
  };
  draft.navigation.currentSite = instantiateSite(
    draft,
    transaction.content,
    station.siteId,
    ship,
    { x: transaction.content.rules.navigation.undockDistanceKm, y: 0 },
    0,
  );
  draft.navigation.movement = { kind: 'stop' };
  draft.navigation.travel = null;
  draft.assets.location = siteLocation;
  ship.location = siteLocation;
  draft.assets.version += 1;
  changed(transaction, true);
  transaction.publish('navigation.undocked', { stationId: station.id, siteId: station.siteId });
  transaction.requestAutosave();
  return APPLIED;
}

function targetOrder(
  transaction: Transaction,
  kind: 'approach' | 'orbit' | 'keepRange',
  payload: TargetRangePayload,
): CommandOutcome {
  const draft = transaction.requireDraft();
  const target = draft.navigation.currentSite?.objects[payload.targetId];
  if (target === undefined || target.id === draft.assets.activeShipId) return reject('movementTargetUnavailable');
  return setMovement(transaction, { kind, targetId: payload.targetId, distanceKm: payload.distanceKm });
}

function setMovement(transaction: Transaction, order: MovementOrder): CommandOutcome {
  const draft = transaction.requireDraft();
  if (draft.assets.location.kind !== 'site' || draft.navigation.currentSite === null) {
    return reject('movementUnavailable');
  }
  replaceCurrentOrder(draft, transaction, order);
  changed(transaction, false);
  transaction.publish('navigation.movementOrdered', { kind: order.kind });
  return APPLIED;
}

function beginWarp(transaction: Transaction, payload: WarpPayload, retreating: boolean): CommandOutcome {
  const draft = transaction.requireDraft();
  const location = draft.assets.location;
  if (location.kind !== 'site' || draft.navigation.currentSite === null) return reject('warpUnavailable');
  const destination = payload.destinationSiteId as SiteId;
  if (!draft.navigation.knownDestinationSiteIds.includes(destination)) return reject('destinationUnknown');
  if (destination === location.siteId) return reject('destinationCurrent');
  if (!transaction.content.rules.navigation.arrivalDistancesKm.includes(payload.arrivalDistanceKm)) {
    return reject('invalidArrivalDistance');
  }
  const originPosition = siteDefinitionPosition(transaction.content, location.systemId, location.siteId);
  const destinationPosition = siteDefinitionPosition(transaction.content, location.systemId, destination);
  if (originPosition === null || destinationPosition === null) return reject('destinationUnknown');
  const distanceKm = distance(originPosition, destinationPosition);
  if (distanceKm < transaction.content.rules.navigation.warpMinimumDistanceKm) {
    return reject('warpTooClose');
  }

  cancelTravel(draft);
  if (draft.navigation.movement !== null) {
    draft.navigation.lastCancellation = {
      orderKind: draft.navigation.movement.kind,
      reason: 'replaced',
      simulationTimeMs: draft.time.simulationTimeMs,
    };
  }
  draft.navigation.movement = null;
  draft.navigation.travel = {
    kind: 'warp',
    phase: 'aligning',
    originSiteId: location.siteId,
    destinationSiteId: destination,
    arrivalDistanceKm: payload.arrivalDistanceKm,
    distanceKm,
    boundaryEntryId: null,
  };
  changed(transaction, false);
  transaction.publish(retreating ? 'navigation.retreatOrdered' : 'navigation.warpOrdered', {
    originSiteId: location.siteId,
    destinationSiteId: destination,
  });
  return APPLIED;
}

function retreat(transaction: Transaction): CommandOutcome {
  const draft = transaction.requireDraft();
  if (draft.assets.location.kind !== 'site') return reject('retreatUnavailable');
  const station = transaction.content.requireStation(transaction.content.rules.economy.startingStationId as StationId);
  if (draft.assets.location.siteId === station.siteId) return reject('retreatUnavailable');
  return beginWarp(transaction, { destinationSiteId: station.siteId, arrivalDistanceKm: 0 }, true);
}

function dock(transaction: Transaction, payload: DockPayload): CommandOutcome {
  const draft = transaction.requireDraft();
  const location = draft.assets.location;
  if (location.kind !== 'site' || draft.navigation.currentSite === null) return reject('dockUnavailable');
  const station = transaction.content.station(payload.stationId);
  const target = draft.navigation.currentSite.objects[payload.stationId];
  if (station === undefined || target?.kind !== 'station' || station.siteId !== location.siteId) {
    return reject('dockUnavailable');
  }

  cancelTravel(draft);
  if (draft.navigation.movement !== null) {
    draft.navigation.lastCancellation = {
      orderKind: draft.navigation.movement.kind,
      reason: 'replaced',
      simulationTimeMs: draft.time.simulationTimeMs,
    };
  }
  draft.navigation.movement = null;
  draft.navigation.travel = {
    kind: 'dock',
    phase: 'approaching',
    stationId: station.id,
    boundaryEntryId: null,
  };
  changed(transaction, false);
  transaction.publish('navigation.dockOrdered', { stationId: station.id });
  return APPLIED;
}

function replaceCurrentOrder(
  draft: CampaignDraft,
  transaction: Transaction,
  order: MovementOrder,
): void {
  if (draft.navigation.travel !== null) {
    const travel = draft.navigation.travel;
    cancelTravel(draft);
    draft.navigation.lastCancellation = {
      orderKind: travel.kind,
      reason: 'replaced',
      simulationTimeMs: draft.time.simulationTimeMs,
    };
  } else if (draft.navigation.movement !== null) {
    draft.navigation.lastCancellation = {
      orderKind: draft.navigation.movement.kind,
      reason: 'replaced',
      simulationTimeMs: draft.time.simulationTimeMs,
    };
  }
  draft.navigation.movement = order;
  void transaction;
}

function cancelTravel(draft: CampaignDraft): void {
  const boundary = draft.navigation.travel?.boundaryEntryId;
  if (boundary !== null && boundary !== undefined) cancelBoundary(draft, boundary);
  draft.navigation.travel = null;
}

function changed(transaction: Transaction, locationChanged: boolean): void {
  transaction.requireDraft().navigation.version += 1;
  transaction.invalidate('navigation');
  transaction.invalidate('site');
  transaction.invalidate('destinations');
  transaction.invalidate('frame');
  if (locationChanged) {
    transaction.invalidate('assets');
    transaction.invalidate('ship');
    transaction.invalidate('inventory');
    transaction.invalidate('station');
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled navigation command ${String(value)}.`);
}
