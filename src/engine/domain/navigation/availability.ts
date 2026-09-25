import type { ContentRepository } from '@engine/ports';
import type { EncounterId, SiteId } from '@shared';

import { deriveShipAttributes } from '../attributes/shipAttributes';
import { assessFit } from '../fitting/validity';
import { shipFit } from '../fitting/fit';
import type { CampaignState } from '../campaign/state';
import { distance } from './geometry';
import { siteDefinitionPosition } from './state';
import type { Vector2 } from './types';

/**
 * Whether each navigation command may be issued right now, and why not
 * (Technical Specification 12.3).
 *
 * Availability is a rule, so it is decided here and projected, never inferred
 * by a button. The command handlers ask the same predicates before they act,
 * which is what stops a command bar from offering an order the engine would
 * refuse - or hiding one it would accept.
 *
 * Each predicate returns the refusal reason the corresponding command would
 * return, so the interface shows the same sentence whether the player was
 * stopped before or after pressing the control.
 *
 * @implements TECH-12.3, FUNC-7.1, FUNC-22.10
 */

/** Commands whose availability this module decides. */
export const NAVIGATION_COMMANDS = [
  'ship.undock',
  'movement.approach',
  'movement.orbit',
  'movement.keepRange',
  'movement.moveToPoint',
  'movement.stop',
  'navigation.warp',
  'navigation.retreat',
  'navigation.dock',
  'navigation.selectDestination',
  'navigation.selectBookmark',
  'navigation.warpToBookmark',
] as const;

export type NavigationCommand = (typeof NAVIGATION_COMMANDS)[number];

/**
 * Why a navigation command would be refused. The names are the protocol's
 * rule-violation reasons, but the domain may not import the protocol, so the
 * vocabulary is declared here and the application and projection layers turn
 * it into an error or a message key. A test checks the two against each other.
 */
export const NAVIGATION_REFUSALS = [
  'bookmarkUnknown',
  'destinationCurrent',
  'destinationSelectionUnavailable',
  'destinationUnknown',
  'dockUnavailable',
  'fittingDraftOpen',
  'movementTargetUnavailable',
  'movementUnavailable',
  'noActiveShip',
  'retreatUnavailable',
  'undockInvalidFit',
  'undockUnavailable',
  'warpTooClose',
  'warpUnavailable',
] as const;

export type NavigationRefusal = (typeof NAVIGATION_REFUSALS)[number];

/** `null` means the command may be issued. */
export type CommandRefusal = NavigationRefusal | null;

export interface NavigationRuleInput {
  readonly state: CampaignState;
  readonly content: ContentRepository;
}

/** Refuses every order that needs the ship to be in a site (Functional Specification 7.1). */
export function movementRefusal({ state }: NavigationRuleInput): CommandRefusal {
  return state.assets.location.kind === 'site' && state.navigation.currentSite !== null
    ? null
    : 'movementUnavailable';
}

/** Refuses an order aimed at an object (Functional Specification 7.2). */
export function targetOrderRefusal(input: NavigationRuleInput, targetId: string): CommandRefusal {
  const blocked = movementRefusal(input);
  if (blocked !== null) return blocked;
  const target = input.state.navigation.currentSite?.objects[targetId];
  return target === undefined || target.id === input.state.assets.activeShipId
    ? 'movementTargetUnavailable'
    : null;
}

/** Refuses undocking, including for a fit that may not leave (Functional Specification 8.4). */
export function undockRefusal({ state, content }: NavigationRuleInput): CommandRefusal {
  if (state.assets.location.kind !== 'station') return 'undockUnavailable';
  // A pilot who lost their only ship buys another before leaving
  // (Functional Specification 9.12).
  if (state.assets.activeShipId === null) return 'noActiveShip';
  if (state.fitting !== null) return 'fittingDraftOpen';
  const ship = state.assets.ships[state.assets.activeShipId];
  if (ship === undefined || ship.location.kind !== 'station') return 'undockUnavailable';
  const hull = content.requireHull(ship.hullId);
  const fit = shipFit(state.assets, ship.id);
  const assessment = assessFit({
    hull,
    fit,
    content,
    derived: deriveShipAttributes({ hull, fit, content }),
  });
  return assessment.violations.length > 0 ? 'undockInvalidFit' : null;
}

/** Refuses warp to one destination site (Functional Specification 7.3). */
export function warpRefusal(input: NavigationRuleInput, destinationSiteId: string): CommandRefusal {
  const { state } = input;
  const location = state.assets.location;
  if (location.kind !== 'site' || state.navigation.currentSite === null) return 'warpUnavailable';
  if (!state.navigation.knownDestinationSiteIds.includes(destinationSiteId as SiteId)) {
    return 'destinationUnknown';
  }
  if (destinationSiteId === location.siteId) return 'destinationCurrent';
  return warpDistanceRefusal(input, destinationSiteId, ORIGIN);
}

/**
 * Refuses a warp to one bookmark (Functional Specification 7.3).
 *
 * The MVP's only bookmark is the automatic one on the player's own wreck
 * (Functional Specification 5.4, 9.12). A bookmark in the site the ship is
 * already in is reached by flying, not by warping.
 */
export function warpToBookmarkRefusal(input: NavigationRuleInput, bookmarkId: string): CommandRefusal {
  const { state } = input;
  const location = state.assets.location;
  if (location.kind !== 'site' || state.navigation.currentSite === null) return 'warpUnavailable';
  const bookmark = bookmarkOf(state, bookmarkId);
  if (bookmark === null || bookmark.systemId !== location.systemId) return 'bookmarkUnknown';
  if (bookmark.siteId === location.siteId) return 'destinationCurrent';
  return warpDistanceRefusal(input, bookmark.siteId, bookmark.anchor);
}

/**
 * Refuses the retreat that carries the ship back to the station it last
 * docked at (Functional Specification 9.11).
 */
export function retreatRefusal(input: NavigationRuleInput): CommandRefusal {
  const { state, content } = input;
  if (state.assets.location.kind !== 'site') return 'retreatUnavailable';
  const station = content.requireStation(state.assets.lastDockedStationId);
  if (state.assets.location.siteId === station.siteId) return 'retreatUnavailable';
  return warpRefusal(input, station.siteId);
}

/** Refuses choosing a bookmark as the destination at the station (Functional Specification 7.1). */
export function selectBookmarkRefusal(input: NavigationRuleInput, bookmarkId: string): CommandRefusal {
  const { state } = input;
  const location = state.assets.location;
  if (location.kind !== 'station') return 'destinationSelectionUnavailable';
  const bookmark = bookmarkOf(state, bookmarkId);
  return bookmark === null || bookmark.systemId !== location.systemId ? 'bookmarkUnknown' : null;
}

/** Where a bookmark is: its site and the site-local point a warp arrives at. */
export interface BookmarkTarget {
  readonly bookmarkId: string;
  readonly systemId: string;
  readonly siteId: SiteId;
  readonly anchor: Vector2;
}

/**
 * Resolves a bookmark. The player's own wreck is the MVP's only bookmark, so
 * its id is the wreck's (Functional Specification 5.4).
 */
export function bookmarkOf(state: CampaignState, bookmarkId: string): BookmarkTarget | null {
  const wreck = Object.hasOwn(state.encounter.wrecks, bookmarkId)
    ? state.encounter.wrecks[bookmarkId]
    : undefined;
  if (wreck === undefined || wreck.owner !== 'player') return null;
  return {
    bookmarkId: wreck.id,
    systemId: wreck.systemId,
    siteId: wreck.siteId,
    anchor: { x: wreck.position.x, y: wreck.position.y },
  };
}

/**
 * The straight-line distance a warp from the current site covers, to a
 * site-local anchor in the destination (Functional Specification 7.3).
 */
export function warpDistanceKm(
  content: ContentRepository,
  systemId: string,
  originSiteId: string,
  destinationSiteId: string,
  anchor: Vector2,
): number | null {
  const origin = siteDefinitionPosition(content, systemId, originSiteId);
  const destination = siteDefinitionPosition(content, systemId, destinationSiteId);
  if (origin === null || destination === null) return null;
  return distance(origin, { x: destination.x + anchor.x, y: destination.y + anchor.y });
}

const ORIGIN: Vector2 = { x: 0, y: 0 };

function warpDistanceRefusal(
  { state, content }: NavigationRuleInput,
  destinationSiteId: string,
  anchor: Vector2,
): CommandRefusal {
  const location = state.assets.location;
  if (location.kind !== 'site') return 'warpUnavailable';
  const covered = warpDistanceKm(content, location.systemId, location.siteId, destinationSiteId, anchor);
  if (covered === null) return 'destinationUnknown';
  return covered < content.rules.navigation.warpMinimumDistanceKm ? 'warpTooClose' : null;
}

/** Refuses docking with one station object (Functional Specification 7.4). */
export function dockRefusal(input: NavigationRuleInput, stationId: string): CommandRefusal {
  const { state, content } = input;
  const location = state.assets.location;
  if (location.kind !== 'site' || state.navigation.currentSite === null) return 'dockUnavailable';
  const station = content.station(stationId);
  const object = state.navigation.currentSite.objects[stationId];
  return station === undefined || object?.kind !== 'station' || station.siteId !== location.siteId
    ? 'dockUnavailable'
    : null;
}

/** Refuses choosing an encounter as the current destination (Functional Specification 7.1). */
export function selectDestinationRefusal(
  input: NavigationRuleInput,
  encounterId: string,
): CommandRefusal {
  const { state, content } = input;
  if (state.assets.location.kind !== 'station') return 'destinationSelectionUnavailable';
  const encounter = content.encounter(encounterId as EncounterId);
  if (
    encounter === undefined ||
    encounter.systemId !== state.assets.location.systemId ||
    !state.navigation.knownDestinationSiteIds.includes(encounter.siteId)
  ) {
    return 'destinationUnknown';
  }
  return null;
}
