import {
  APPLIED,
  reject,
  UNCHANGED,
  type CommandOutcome,
  type Transaction,
} from './transaction';
import {
  bookmarkOf,
  dockRefusal,
  instantiateSite,
  movementOrderOf,
  movementRefusal,
  retreatRefusal,
  selectBookmarkRefusal,
  selectDestinationRefusal,
  targetOrderRefusal,
  undockRefusal,
  warpDistanceKm,
  warpRefusal,
  warpToBookmarkRefusal,
  type CampaignDraft,
  type CommandRefusal,
  type MovementOrder,
  type EntityId,
  type NavigationRuleInput,
  type SiteLocation,
  type Vector2,
} from '@engine/domain';
import { cancelBoundary, materializeWrecks, orderMovement } from '@engine/simulation';
import type {
  DockPayload,
  MoveToPointPayload,
  SelectBookmarkPayload,
  TargetRangePayload,
  WarpPayload,
  WarpToBookmarkPayload,
} from '@protocol';
import type { EncounterId, SiteId, StationId } from '@shared';

/**
 * Phase 9 navigation commands (Functional Specification 7.1-7.4).
 *
 * Every order changes only the transaction draft. Simulation-time state
 * machines perform movement and transitions later; the UI never moves a ship.
 *
 * Whether an order is legal is decided by the shared predicates in
 * `@engine/domain`, which the site projection also asks, so the command bar
 * offers exactly the orders these handlers accept.
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
    | 'navigation.dock'
    | 'navigation.selectBookmark'
    | 'navigation.warpToBookmark',
  payload: unknown,
): CommandOutcome {
  switch (type) {
    case 'navigation.selectDestination':
      return selectDestination(transaction, (payload as { encounterId: string }).encounterId);
    case 'navigation.selectBookmark':
      return selectBookmark(transaction, (payload as SelectBookmarkPayload).bookmarkId);
    case 'navigation.warpToBookmark':
      return warpToBookmark(transaction, payload as WarpToBookmarkPayload);
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

/** The state and content the shared availability predicates read. */
function rules(transaction: Transaction): NavigationRuleInput {
  return { state: transaction.requireDraft(), content: transaction.content };
}

function refuse(refusal: CommandRefusal): CommandOutcome | null {
  return refusal === null ? null : reject(refusal);
}

function selectDestination(transaction: Transaction, encounterId: string): CommandOutcome {
  const draft = transaction.requireDraft();
  const refused = refuse(selectDestinationRefusal(rules(transaction), encounterId));
  if (refused !== null) return refused;
  if (draft.navigation.selectedEncounterId === encounterId) return UNCHANGED;
  const encounter = transaction.content.requireEncounter(encounterId as EncounterId);
  draft.navigation.selectedEncounterId = encounter.id as EncounterId;
  draft.navigation.selectedBookmarkId = null;
  changed(transaction, false);
  transaction.publish('navigation.destinationSelected', {
    encounterId: encounter.id,
    siteId: encounter.siteId,
  });
  return APPLIED;
}

/**
 * Chooses the player's own wreck as the destination at the station
 * (Functional Specification 5.4, 9.12). It replaces a chosen encounter, and
 * like it, it marks a destination rather than moving the ship.
 */
function selectBookmark(transaction: Transaction, bookmarkId: string): CommandOutcome {
  const draft = transaction.requireDraft();
  const refused = refuse(selectBookmarkRefusal(rules(transaction), bookmarkId));
  if (refused !== null) return refused;
  if (draft.navigation.selectedBookmarkId === bookmarkId) return UNCHANGED;
  const bookmark = bookmarkOf(draft, bookmarkId);
  if (bookmark === null) return reject('bookmarkUnknown');
  draft.navigation.selectedBookmarkId = bookmark.bookmarkId as EntityId;
  draft.navigation.selectedEncounterId = null;
  changed(transaction, false);
  transaction.publish('navigation.bookmarkSelected', {
    bookmarkId: bookmark.bookmarkId,
    siteId: bookmark.siteId,
  });
  return APPLIED;
}

function undock(transaction: Transaction): CommandOutcome {
  const draft = transaction.requireDraft();
  const refused = refuse(undockRefusal(rules(transaction)));
  if (refused !== null) return refused;
  const location = draft.assets.location;
  const ship = draft.assets.activeShipId === null ? undefined : draft.assets.ships[draft.assets.activeShipId];
  if (location.kind !== 'station' || ship === undefined) return reject('undockUnavailable');

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
  draft.navigation.movementOrders = {};
  orderMovement(transaction.simulation(), ship.id, { kind: 'stop' });
  draft.navigation.travel = null;
  draft.assets.location = siteLocation;
  ship.location = siteLocation;
  draft.assets.version += 1;
  // The station site can hold wrecks of its own, and the player's own wreck
  // will be one of them (Functional Specification 5.4, 9.12).
  materializeWrecks(transaction.simulation());
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
  const refused = refuse(targetOrderRefusal(rules(transaction), payload.targetId));
  if (refused !== null) return refused;
  return setMovement(transaction, { kind, targetId: payload.targetId, distanceKm: payload.distanceKm });
}

function setMovement(transaction: Transaction, order: MovementOrder): CommandOutcome {
  const draft = transaction.requireDraft();
  const refused = refuse(movementRefusal(rules(transaction)));
  if (refused !== null) return refused;
  replaceCurrentOrder(draft, transaction, order);
  changed(transaction, false);
  transaction.publish('navigation.movementOrdered', { kind: order.kind });
  return APPLIED;
}

function beginWarp(transaction: Transaction, payload: WarpPayload, retreating: boolean): CommandOutcome {
  const refused = refuse(warpRefusal(rules(transaction), payload.destinationSiteId));
  if (refused !== null) return refused;
  return startWarp(transaction, {
    destinationSiteId: payload.destinationSiteId as SiteId,
    bookmarkId: null,
    anchor: { x: 0, y: 0 },
    arrivalDistanceKm: payload.arrivalDistanceKm,
  }, retreating);
}

/**
 * Warps to the player's own wreck (Functional Specification 7.3, 9.12). The
 * ship arrives the chosen distance short of the wreck rather than of the
 * site's centre, so it can be looted and left.
 */
function warpToBookmark(transaction: Transaction, payload: WarpToBookmarkPayload): CommandOutcome {
  const refused = refuse(warpToBookmarkRefusal(rules(transaction), payload.bookmarkId));
  if (refused !== null) return refused;
  const bookmark = bookmarkOf(transaction.requireDraft(), payload.bookmarkId);
  if (bookmark === null) return reject('bookmarkUnknown');
  return startWarp(transaction, {
    destinationSiteId: bookmark.siteId,
    bookmarkId: bookmark.bookmarkId as EntityId,
    anchor: bookmark.anchor,
    arrivalDistanceKm: payload.arrivalDistanceKm,
  }, false);
}

interface WarpRequest {
  readonly destinationSiteId: SiteId;
  readonly bookmarkId: EntityId | null;
  readonly anchor: Vector2;
  readonly arrivalDistanceKm: number;
}

function startWarp(transaction: Transaction, request: WarpRequest, retreating: boolean): CommandOutcome {
  const draft = transaction.requireDraft();
  if (!transaction.content.rules.navigation.arrivalDistancesKm.includes(request.arrivalDistanceKm)) {
    return reject('invalidArrivalDistance');
  }
  const location = draft.assets.location;
  const playerId = draft.assets.activeShipId;
  if (location.kind !== 'site' || playerId === null) return reject('warpUnavailable');
  const destination = request.destinationSiteId;
  // The refusal already proved both ends resolve; this is the distance it
  // measured, not a second decision about whether the warp is legal.
  const distanceKm = warpDistanceKm(
    transaction.content,
    location.systemId,
    location.siteId,
    destination,
    request.anchor,
  );
  if (distanceKm === null) return reject('destinationUnknown');

  cancelTravel(draft);
  const current = movementOrderOf(draft, playerId);
  if (current !== null) {
    draft.navigation.lastCancellation = {
      orderKind: current.kind,
      reason: 'replaced',
      simulationTimeMs: draft.time.simulationTimeMs,
    };
  }
  orderMovement(transaction.simulation(), playerId, null);
  draft.navigation.travel = {
    kind: 'warp',
    phase: 'aligning',
    originSiteId: location.siteId,
    destinationSiteId: destination,
    bookmarkId: request.bookmarkId,
    anchor: { x: request.anchor.x, y: request.anchor.y },
    arrivalDistanceKm: request.arrivalDistanceKm,
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
  const refused = refuse(retreatRefusal(rules(transaction)));
  if (refused !== null) return refused;
  const station = transaction.content.requireStation(transaction.requireDraft().assets.lastDockedStationId);
  return beginWarp(transaction, { destinationSiteId: station.siteId, arrivalDistanceKm: 0 }, true);
}

function dock(transaction: Transaction, payload: DockPayload): CommandOutcome {
  const draft = transaction.requireDraft();
  const refused = refuse(dockRefusal(rules(transaction), payload.stationId));
  if (refused !== null) return refused;
  const station = transaction.content.requireStation(payload.stationId as StationId);

  const playerId = draft.assets.activeShipId;
  if (playerId === null) return reject('dockUnavailable');
  cancelTravel(draft);
  const current = movementOrderOf(draft, playerId);
  if (current !== null) {
    draft.navigation.lastCancellation = {
      orderKind: current.kind,
      reason: 'replaced',
      simulationTimeMs: draft.time.simulationTimeMs,
    };
  }
  orderMovement(transaction.simulation(), playerId, null);
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
  const playerId = draft.assets.activeShipId;
  if (playerId === null) return;
  const current = movementOrderOf(draft, playerId);
  if (draft.navigation.travel !== null) {
    const travel = draft.navigation.travel;
    cancelTravel(draft);
    draft.navigation.lastCancellation = {
      orderKind: travel.kind,
      reason: 'replaced',
      simulationTimeMs: draft.time.simulationTimeMs,
    };
  } else if (current !== null) {
    draft.navigation.lastCancellation = {
      orderKind: current.kind,
      reason: 'replaced',
      simulationTimeMs: draft.time.simulationTimeMs,
    };
  }
  orderMovement(transaction.simulation(), playerId, order);
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
