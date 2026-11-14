/** Phase 5 immutable asset views, in canonical whole dm3 and credits. */
export interface StackPayload { readonly stackId: string }
export interface SplitInventoryPayload extends StackPayload { readonly quantity: number }
export interface TransferInventoryPayload extends SplitInventoryPayload { readonly destinationInventoryId: string }
export interface MergeInventoryPayload { readonly sourceStackId: string; readonly targetStackId: string }
export interface MaximumInventoryPayload extends StackPayload { readonly destinationInventoryId: string }
export interface HangarPayload { readonly stationId: string }
export interface CargoPayload { readonly shipId: string }
export type LocationData =
  | { readonly kind: 'station'; readonly stationId: string; readonly systemId: string }
  | { readonly kind: 'site'; readonly siteId: string; readonly systemId: string }
  | { readonly kind: 'warp'; readonly fromSiteId: string; readonly toSiteId: string; readonly systemId: string };
export type InventoryLocationData =
  | { readonly kind: 'hangar'; readonly stationId: string }
  | { readonly kind: 'cargo'; readonly shipId: string }
  | { readonly kind: 'fitting'; readonly shipId: string }
  | { readonly kind: 'reserve'; readonly sourceInventoryId: string; readonly ownerId: string }
  | { readonly kind: 'wreck'; readonly wreckId: string };
/** Which slot a fitted module or a loaded charge occupies. */
export interface SlotRefData { readonly kind: string; readonly index: number }
export type StackStateData =
  | { readonly kind: 'plain' }
  | { readonly kind: 'fitted'; readonly slot: SlotRefData; readonly online: boolean }
  | { readonly kind: 'charge'; readonly slot: SlotRefData };
export interface ProvenanceData {
  readonly grantedQuantity: number; readonly purchasedQuantity: number; readonly purchaseCostCredits: number;
}
export interface ItemData {
  readonly definitionId: string; readonly nameKey: string; readonly descriptionKey: string;
  readonly kind: 'module' | 'ammunition' | 'item'; readonly unitVolumeCubicDecimetres: number;
  readonly referenceValueCredits: number;
}
export interface StackData {
  readonly id: string; readonly inventoryId: string; readonly quantity: number;
  readonly state: StackStateData; readonly provenance: ProvenanceData; readonly item: ItemData;
  /** Recovery-grant units: usable, never saleable or insurable (Functional Specification 9.12). */
  readonly recoveryGrant: boolean;
}
export interface InventoryData {
  readonly revision: number; readonly id: string; readonly location: InventoryLocationData;
  readonly accessible: boolean; readonly unavailableReason: string | null;
  readonly capacityCubicDecimetres: number | null; readonly usedCubicDecimetres: number;
  readonly freeCubicDecimetres: number | null; readonly stacks: readonly StackData[];
}
export interface ShipAssetData {
  readonly id: string; readonly owner: string; readonly hullId: string; readonly nameKey: string;
  readonly active: boolean; readonly location: LocationData; readonly cargoInventoryId: string;
  readonly fittingInventoryId: string;
  /** A recovery-grant hull has no insurance value (Functional Specification 9.12). */
  readonly recoveryGrant: boolean;
}
export interface WalletData { readonly revision: number; readonly credits: number }
export interface AssetsData extends WalletData {
  /** `null` while the pilot owns no ship at the station they are docked at. */
  readonly location: LocationData; readonly activeShipId: string | null;
  /** Where a destroyed pilot is recovered and where a retreat heads. */
  readonly lastDockedStationId: string;
  readonly ships: readonly ShipAssetData[]; readonly inventories: readonly InventoryData[];
}
export interface ItemInspectionData { readonly revision: number; readonly stack: StackData; readonly inventory: InventoryData }
export interface MaximumInventoryData {
  readonly revision: number; readonly stackId: string; readonly destinationInventoryId: string;
  readonly maximumQuantity: number; readonly unavailableReason: string | null;
}

/**
 * One figure of a ship comparison (Functional Specification 19.6;
 * FeatureSpec02 4.2, 9). `better` says which way is an advantage, so the
 * interface can mark it without reasoning about the rule itself.
 */
export interface ShipFigureData {
  readonly key: string;
  readonly labelKey: string;
  readonly value: number;
  readonly better: 'higher' | 'lower';
}

/** A layer's current and maximum hit points, for the ship list. */
export interface ShipLayerSummaryData {
  readonly layer: string;
  readonly hitPoints: number;
  readonly maximumHitPoints: number;
}

/**
 * One ship the player owns (Functional Specification 6.3; FeatureSpec02 4.2).
 *
 * `local` is true for the ships docked where the player is docked: those may
 * be made active, fitted and have their cargo moved. `activation` answers
 * whether this one can be made active now and, when not, why.
 */
export interface OwnedShipData {
  readonly id: string;
  readonly hullId: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly hullClass: string;
  readonly moduleSizes: readonly string[];
  readonly traitKeys: readonly string[];
  readonly active: boolean;
  readonly local: boolean;
  readonly location: LocationData;
  readonly cargoInventoryId: string;
  readonly cargoUsedCubicDecimetres: number;
  readonly cargoCapacityCubicDecimetres: number;
  readonly fittedModules: number;
  /** The fit breaks no rule, so the ship may undock once active. */
  readonly undockable: boolean;
  readonly layers: readonly ShipLayerSummaryData[];
  readonly capacitorCharge: number;
  readonly insuranceCoverage: 'basic' | 'enhanced';
  readonly recoveryGrant: boolean;
  readonly referenceValueCredits: number;
  readonly figures: readonly ShipFigureData[];
  readonly activation: { readonly available: boolean; readonly unavailableReason: string | null };
}

export interface ShipsListData {
  readonly revision: number;
  readonly activeShipId: string | null;
  /** The station the player is docked at, or `null` in space. */
  readonly stationId: string | null;
  /** The fitting draft is open on this ship, or `null`. Switching waits for it. */
  readonly draftShipId: string | null;
  readonly ships: readonly OwnedShipData[];
}
