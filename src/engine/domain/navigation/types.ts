import type { EncounterId, SiteId, StationId, SystemId } from '@shared';
import type { EntityId } from '../campaign/identity';

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export const MOVEMENT_ORDER_KINDS = [
  'approach',
  'orbit',
  'keepRange',
  'moveToPoint',
  'stop',
] as const;
export type MovementOrderKind = (typeof MOVEMENT_ORDER_KINDS)[number];

export type MovementOrder =
  | {
      readonly kind: 'approach' | 'orbit' | 'keepRange';
      readonly targetId: string;
      readonly distanceKm: number;
    }
  | { readonly kind: 'moveToPoint'; readonly point: Vector2 }
  | { readonly kind: 'stop' };

export const MOVEMENT_CANCELLATION_REASONS = [
  'replaced',
  'targetMissing',
  'warpStarted',
  'siteTransition',
  'docked',
] as const;
export type MovementCancellationReason = (typeof MOVEMENT_CANCELLATION_REASONS)[number];

export interface MovementCancellation {
  readonly orderKind: MovementOrderKind | 'warp' | 'dock';
  readonly reason: MovementCancellationReason;
  readonly simulationTimeMs: number;
}

export interface SiteObjectState {
  /** Entity id for a ship, authored definition id for a permanent object. */
  readonly id: string;
  readonly kind: 'ship' | 'station';
  readonly definitionId: string;
  readonly nameKey: string;
  readonly position: Vector2;
  readonly velocity: Vector2;
  readonly facingRadians: number;
  readonly radiusKm: number;
  readonly movable: boolean;
}

export interface SiteRuntime {
  readonly instanceId: EntityId;
  readonly systemId: SystemId;
  readonly siteId: SiteId;
  readonly objects: Readonly<Record<string, SiteObjectState>>;
}

export interface WarpTravelState {
  readonly kind: 'warp';
  readonly phase: 'aligning' | 'preparing' | 'transit';
  readonly originSiteId: SiteId;
  readonly destinationSiteId: SiteId;
  readonly arrivalDistanceKm: number;
  readonly distanceKm: number;
  readonly boundaryEntryId: EntityId | null;
}

export interface DockTravelState {
  readonly kind: 'dock';
  readonly phase: 'approaching' | 'preparing';
  readonly stationId: StationId;
  readonly boundaryEntryId: EntityId | null;
}

export type TravelState = WarpTravelState | DockTravelState;

export interface NavigationState {
  readonly version: number;
  readonly knownDestinationSiteIds: readonly SiteId[];
  readonly selectedEncounterId: EncounterId | null;
  readonly currentSite: SiteRuntime | null;
  readonly movement: MovementOrder | null;
  readonly travel: TravelState | null;
  readonly lastCancellation: MovementCancellation | null;
}

export interface MutableKinematics {
  position: Vector2;
  velocity: Vector2;
  facingRadians: number;
}

