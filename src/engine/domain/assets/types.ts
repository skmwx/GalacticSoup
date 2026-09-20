import type { DefinitionId, HullId, StationId, SystemId, Mutable } from '@shared';
import type { CampaignId, EntityId } from '../campaign/identity';

declare const inventoryBrand: unique symbol;
export type InventoryId = EntityId & { readonly [inventoryBrand]: 'inventory' };

/** Only locations implemented by this phase are stored. Travel adds its own cases. */
export interface DockedLocation {
  readonly kind: 'station';
  readonly stationId: StationId;
  readonly systemId: SystemId;
}
export type InventoryLocation =
  | { readonly kind: 'hangar'; readonly stationId: StationId }
  | { readonly kind: 'cargo'; readonly shipId: EntityId }
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
export interface ItemStack {
  readonly id: EntityId;
  readonly definitionId: DefinitionId;
  readonly quantity: number;
  readonly inventoryId: InventoryId;
  /** Phase 6 introduces operational instances; these items are all unfitted. */
  readonly state: 'plain';
  readonly provenance: Provenance;
}
export interface ShipIdentity {
  readonly id: EntityId;
  readonly hullId: HullId;
  readonly cargoInventoryId: InventoryId;
  readonly location: DockedLocation;
}
export interface AssetState {
  readonly credits: number;
  readonly location: DockedLocation;
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
  'invalidReservation', 'numericOverflow', 'insufficientCredits',
] as const;
export type InventoryFailure = (typeof INVENTORY_FAILURES)[number];
export class InventoryError extends Error {
  constructor(readonly reason: InventoryFailure) { super(reason); }
}
