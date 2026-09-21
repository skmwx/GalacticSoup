import type { DefenseLayer } from '@engine/ports';
import type { DefinitionId, HullId, SiteId, StationId, SystemId, Mutable } from '@shared';
import type { CampaignId, EntityId } from '../campaign/identity';
import type { SlotRef } from '../fitting/types';

declare const inventoryBrand: unique symbol;
export type InventoryId = EntityId & { readonly [inventoryBrand]: 'inventory' };

export interface DockedLocation {
  readonly kind: 'station';
  readonly stationId: StationId;
  readonly systemId: SystemId;
}

/** The ship is present in one loaded tactical site. */
export interface SiteLocation {
  readonly kind: 'site';
  readonly siteId: SiteId;
  readonly systemId: SystemId;
}

/** The ship has left its source site and has not reached its destination. */
export interface WarpLocation {
  readonly kind: 'warp';
  readonly fromSiteId: SiteId;
  readonly toSiteId: SiteId;
  readonly systemId: SystemId;
}

export type ShipLocation = DockedLocation | SiteLocation | WarpLocation;
export type InventoryLocation =
  | { readonly kind: 'hangar'; readonly stationId: StationId }
  | { readonly kind: 'cargo'; readonly shipId: EntityId }
  | { readonly kind: 'fitting'; readonly shipId: EntityId }
  | { readonly kind: 'reserve'; readonly sourceInventoryId: InventoryId; readonly ownerId: EntityId };

export type CapacityPolicy =
  | { readonly kind: 'unlimited' }
  | { readonly kind: 'limited'; readonly volumeCubicDecimetres: number }
  | { readonly kind: 'shared'; readonly inventoryId: InventoryId };

export interface Inventory {
  readonly id: InventoryId;
  readonly location: InventoryLocation;
  readonly capacity: CapacityPolicy;
}

/** Rational acquisition record; integer totals never drift after split/merge. */
export interface Provenance {
  readonly grantedQuantity: number;
  readonly purchasedQuantity: number;
  readonly purchaseCostCredits: number;
}

/**
 * What a physical stack is currently doing (Functional Specification 8.4).
 *
 * A fitted module and a loaded charge are the same physical units as the ones
 * that sat in the hangar: the state records the slot they occupy rather than
 * copying them into a second place. Two stacks merge only when their state is
 * identical, so a module in one slot can never be confused with the same
 * module in another.
 */
export type StackState =
  | { readonly kind: 'plain' }
  | { readonly kind: 'fitted'; readonly slot: SlotRef; readonly online: boolean }
  | { readonly kind: 'charge'; readonly slot: SlotRef };

export const PLAIN_STATE: StackState = { kind: 'plain' };

export interface ItemStack {
  readonly id: EntityId;
  readonly definitionId: DefinitionId;
  readonly quantity: number;
  readonly inventoryId: InventoryId;
  readonly state: StackState;
  readonly provenance: Provenance;
}

/**
 * Damage taken and capacitor charge (Functional Specification 8.2, 9.7-9.8).
 *
 * Damage is stored as hit points lost rather than as hit points remaining, so
 * changing the fit changes the maximum without silently healing or destroying
 * the ship. Charge is stored directly and is clamped whenever the derived
 * capacity changes.
 */
export interface ShipCondition {
  readonly damage: Readonly<Record<DefenseLayer, number>>;
  readonly capacitorCharge: number;
}

export interface ShipIdentity {
  readonly id: EntityId;
  readonly hullId: HullId;
  readonly cargoInventoryId: InventoryId;
  /** Holds the physical units of every fitted module and loaded charge. */
  readonly fittingInventoryId: InventoryId;
  readonly location: ShipLocation;
  readonly condition: ShipCondition;
  readonly insurance: {
    readonly coverage: 'basic' | 'enhanced';
    readonly premiumPaidCredits: number;
  };
}
export interface AssetState {
  /** Version of the asset aggregate used to bind economic previews. */
  readonly version: number;
  readonly credits: number;
  readonly location: ShipLocation;
  readonly activeShipId: EntityId;
  readonly ships: Readonly<Record<string, ShipIdentity>>;
  readonly inventories: Readonly<Record<string, Inventory>>;
  readonly stacks: Readonly<Record<string, ItemStack>>;
}
export interface AssetDraft {
  campaignId: CampaignId;
  nextEntityOrdinal: number;
  assets: Mutable<AssetState>;
}

export const INVENTORY_FAILURES = [
  'inventoryNotFound', 'itemNotFound', 'invalidQuantity', 'insufficientItems',
  'insufficientCapacity', 'incompatibleStacks', 'sameInventory', 'inventoryUnavailable',
  'invalidReservation', 'numericOverflow', 'insufficientCredits', 'stackNotDivisible',
] as const;
export type InventoryFailure = (typeof INVENTORY_FAILURES)[number];
export class InventoryError extends Error {
  constructor(readonly reason: InventoryFailure) { super(reason); }
}
