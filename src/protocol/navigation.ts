import type { LocationData } from './assets';

/** Phase 9 navigation command payloads. */
export interface SelectDestinationPayload { readonly encounterId: string }
export interface TargetPayload { readonly targetId: string }
export interface TargetRangePayload extends TargetPayload { readonly distanceKm: number }
export interface MoveToPointPayload { readonly xKm: number; readonly yKm: number }
export interface WarpPayload { readonly destinationSiteId: string; readonly arrivalDistanceKm: number }
/** A bookmark - in the MVP, the player's own wreck - chosen at the station. */
export interface SelectBookmarkPayload { readonly bookmarkId: string }
export interface WarpToBookmarkPayload { readonly bookmarkId: string; readonly arrivalDistanceKm: number }
export interface DockPayload { readonly stationId: string }

export interface VectorData { readonly x: number; readonly y: number }

/**
 * Whether one command may be issued against this subject right now
 * (Technical Specification 12.3).
 *
 * `command` is the protocol request type the control would send, so the action
 * registry, the command bar and the engine all name the same thing. The reason
 * is the message key the command itself would refuse with.
 */
export interface CommandAvailabilityData {
  readonly command: string;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

/**
 * How the player stands toward an object (Functional Specification 9.1).
 * The engine decides it; the interface draws it with a shape as well as a
 * colour.
 */
export type ObjectAttitudeData = 'own' | 'hostile' | 'neutral';

export interface SiteObjectData {
  readonly id: string;
  readonly kind: 'ship' | 'station' | 'wreck';
  readonly definitionId: string;
  readonly nameKey: string;
  readonly attitude: ObjectAttitudeData;
  readonly position: VectorData;
  readonly velocity: VectorData;
  readonly facingRadians: number;
  readonly radiusKm: number;
  readonly rangeFromPlayerKm: number;
  readonly player: boolean;
  /** Orders that act on this object: approach, orbit, keep range and dock. */
  readonly commands: readonly CommandAvailabilityData[];
}

export type MovementOrderData =
  | { readonly kind: 'approach' | 'orbit' | 'keepRange'; readonly targetId: string; readonly distanceKm: number }
  | { readonly kind: 'moveToPoint'; readonly point: VectorData }
  | { readonly kind: 'stop' };

export type TravelStatusData =
  | {
      readonly kind: 'warp';
      readonly phase: 'aligning' | 'preparing' | 'transit';
      readonly originSiteId: string;
      readonly destinationSiteId: string;
      /** The bookmark the warp is aimed at, or `null` for the site itself. */
      readonly bookmarkId: string | null;
      readonly arrivalDistanceKm: number;
      readonly distanceKm: number;
      readonly completionAtMs: number | null;
    }
  | {
      readonly kind: 'dock';
      readonly phase: 'approaching' | 'preparing';
      readonly stationId: string;
      readonly completionAtMs: number | null;
    };

export interface MovementCancellationData {
  readonly orderKind: string;
  readonly reason: string;
  readonly simulationTimeMs: number;
}

export interface SiteRuntimeData {
  readonly instanceId: string;
  readonly systemId: string;
  readonly systemNameKey: string;
  readonly dangerRating: number;
  readonly siteId: string;
  readonly siteNameKey: string;
  readonly objects: readonly SiteObjectData[];
}

export interface SiteData {
  readonly revision: number;
  readonly simulationTimeMs: number;
  readonly location: LocationData;
  readonly site: SiteRuntimeData | null;
  readonly movementOrder: MovementOrderData | null;
  readonly travelStatus: TravelStatusData | null;
  readonly lastCancellation: MovementCancellationData | null;
  /** Orders that name no target: undock, move to point, stop and retreat. */
  readonly commands: readonly CommandAvailabilityData[];
  /** Authored distances a range order offers, ascending. */
  readonly rangePresetsKm: readonly number[];
  /** Authored distances a warp may arrive at, ascending. */
  readonly arrivalDistancesKm: readonly number[];
}

/** One authored spawn group, disclosed before entry (MVP Scope 4.2). */
export interface DestinationSpawnData {
  readonly npcProfileId: string;
  readonly nameKey: string;
  readonly role: string;
  readonly count: number;
  readonly bountyCredits: number;
}

/** One item an encounter's opponents can drop (MVP Scope 4.2). */
export interface DestinationLootData {
  readonly itemId: string;
  readonly nameKey: string;
}

export interface DestinationData {
  readonly encounterId: string;
  readonly siteId: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly rewardSummaryKey: string;
  readonly tier: number;
  readonly selected: boolean;
  readonly current: boolean;
  readonly known: boolean;
  /** Opponents the site is authored to hold, in authored order. */
  readonly spawns: readonly DestinationSpawnData[];
  /** Total authored bounty of every opponent, before loot. */
  readonly totalBountyCredits: number;
  /** Every item its loot tables can drop, in stable order. */
  readonly possibleLootItemIds: readonly string[];
  /** The same items with the names they are shown by, in the same order. */
  readonly possibleLoot: readonly DestinationLootData[];
  /** How often the player has completed it; sites stay repeatable (MVP-AC-09). */
  readonly completionCount: number;
  /** Choosing this encounter, and warping to its site. */
  readonly commands: readonly CommandAvailabilityData[];
}

/**
 * A bookmark offered as a destination (Functional Specification 5.4, 7.3,
 * 9.12). The MVP's only bookmark is the automatic one on the player's own
 * wreck, reached through the same station choice and warp control as an
 * encounter, without a system map.
 */
export interface BookmarkDestinationData {
  readonly bookmarkId: string;
  readonly kind: 'playerWreck';
  readonly siteId: string;
  readonly siteNameKey: string;
  /** The hull the wreck was, for its name. */
  readonly hullNameKey: string;
  /** The authored encounter at that site, whose opponents a visit meets. */
  readonly encounterId: string | null;
  readonly encounterNameKey: string | null;
  readonly tier: number | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly remainingSeconds: number;
  /** Stacks still in the wreck. */
  readonly itemCount: number;
  readonly selected: boolean;
  /** The player is in the bookmark's site now. */
  readonly current: boolean;
  /** Choosing the bookmark at the station, and warping to it. */
  readonly commands: readonly CommandAvailabilityData[];
}

export interface DestinationsData {
  readonly revision: number;
  readonly selectedEncounterId: string | null;
  readonly selectedBookmarkId: string | null;
  readonly destinations: readonly DestinationData[];
  /** The player's own wrecks, oldest first. */
  readonly bookmarks: readonly BookmarkDestinationData[];
}

