import type { LocationData } from './assets';

/** Phase 9 navigation command payloads. */
export interface SelectDestinationPayload { readonly encounterId: string }
export interface TargetPayload { readonly targetId: string }
export interface TargetRangePayload extends TargetPayload { readonly distanceKm: number }
export interface MoveToPointPayload { readonly xKm: number; readonly yKm: number }
export interface WarpPayload { readonly destinationSiteId: string; readonly arrivalDistanceKm: number }
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

export interface SiteObjectData {
  readonly id: string;
  readonly kind: 'ship' | 'station' | 'wreck';
  readonly definitionId: string;
  readonly nameKey: string;
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
  /** How often the player has completed it; sites stay repeatable (MVP-AC-09). */
  readonly completionCount: number;
  /** Choosing this encounter, and warping to its site. */
  readonly commands: readonly CommandAvailabilityData[];
}

export interface DestinationsData {
  readonly revision: number;
  readonly selectedEncounterId: string | null;
  readonly destinations: readonly DestinationData[];
}

