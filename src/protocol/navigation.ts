import type { LocationData } from './assets';

/** Phase 9 navigation command payloads. */
export interface SelectDestinationPayload { readonly encounterId: string }
export interface TargetPayload { readonly targetId: string }
export interface TargetRangePayload extends TargetPayload { readonly distanceKm: number }
export interface MoveToPointPayload { readonly xKm: number; readonly yKm: number }
export interface WarpPayload { readonly destinationSiteId: string; readonly arrivalDistanceKm: number }
export interface DockPayload { readonly stationId: string }

export interface VectorData { readonly x: number; readonly y: number }

export interface SiteObjectData {
  readonly id: string;
  readonly kind: 'ship' | 'station';
  readonly definitionId: string;
  readonly nameKey: string;
  readonly position: VectorData;
  readonly velocity: VectorData;
  readonly facingRadians: number;
  readonly radiusKm: number;
  readonly rangeFromPlayerKm: number;
  readonly player: boolean;
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
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

export interface DestinationsData {
  readonly revision: number;
  readonly selectedEncounterId: string | null;
  readonly destinations: readonly DestinationData[];
}

