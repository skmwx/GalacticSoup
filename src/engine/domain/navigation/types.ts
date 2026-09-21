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

export const SITE_OBJECT_KINDS = ['ship', 'station', 'wreck'] as const;
export type SiteObjectKind = (typeof SITE_OBJECT_KINDS)[number];

export interface SiteObjectState {
  /** Entity id for a ship or wreck, authored definition id for a permanent object. */
  readonly id: string;
  readonly kind: SiteObjectKind;
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
  /**
   * The standing order of every ship in the loaded site, keyed by its entity
   * id. A movement order belongs to the ship aggregate (Technical
   * Specification 8.2), and an opponent commands its ship with the same orders
   * the player commands theirs with (Technical Specification 10.3).
   */
  readonly movementOrders: Readonly<Record<string, MovementOrder>>;
  readonly travel: TravelState | null;
  /** The player's most recent cancelled order, for the interface to explain. */
  readonly lastCancellation: MovementCancellation | null;
}

export interface MutableKinematics {
  position: Vector2;
  velocity: Vector2;
  facingRadians: number;
}

