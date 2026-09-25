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
  | { readonly kind: 'reserve'; readonly sourceInventoryId: InventoryId; readonly ownerId: EntityId }
  /** The contents of one wreck, which anyone in range may take from. */
  | { readonly kind: 'wreck'; readonly wreckId: EntityId };

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
  /**
   * The units came from the recovery service's last-resort grant
   * (Functional Specification 9.12; Technical Specification 8.3, 10.9).
   *
   * They may be fitted, flown, fired and moved like any other unit, but they
   * never acquire sale or insurance value. The mark belongs to the units, so it
   * travels through every split, move, fit and removal, and a marked stack only
   * merges with another marked one. The one exception is a loaded magazine,
   * which is a single physical charge: rounds loaded into a marked magazine, or
   * marked rounds loaded into an unmarked one, leave the whole magazine marked.
   * Restriction can therefore spread but never wash out.
   */
  readonly recoveryGrant: boolean;
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

/**
 * Who a ship answers to (Functional Specification 9.10).
 *
 * An opponent is an ordinary ship so that it uses the same fitting, movement,
 * targeting and damage rules the player does. This field is what keeps it out
 * of the player's hangar, market, repair and insurance surfaces all the same.
 */
export type ShipOwner = 'player' | 'npc';

export interface ShipIdentity {
  readonly id: EntityId;
  readonly owner: ShipOwner;
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
  /**
   * The hull was supplied by the recovery service (Functional Specification
   * 9.12). It has zero insurance value, so it pays nothing on destruction and
   * cannot be given enhanced cover.
   */
  readonly recoveryGrant: boolean;
}
export interface AssetState {
  /** Version of the asset aggregate used to bind economic previews. */
  readonly version: number;
  readonly credits: number;
  readonly location: ShipLocation;
  /**
   * The ship the player controls, or `null` while they own none at the
   * station they are docked at (Functional Specification 9.12). Losing the
   * only ship with enough credits to buy another leaves the player docked and
   * shipless; they are never shipless anywhere else.
   */
  readonly activeShipId: EntityId | null;
  /**
   * The most recently docked accessible station: where a destroyed pilot is
   * recovered and where a retreat heads (Technical Specification 8.1;
   * Functional Specification 9.12).
   */
  readonly lastDockedStationId: StationId;
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
