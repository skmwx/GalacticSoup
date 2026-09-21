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
}
export interface WalletData { readonly revision: number; readonly credits: number }
export interface AssetsData extends WalletData {
  readonly location: LocationData; readonly activeShipId: string;
  readonly ships: readonly ShipAssetData[]; readonly inventories: readonly InventoryData[];
}
export interface ItemInspectionData { readonly revision: number; readonly stack: StackData; readonly inventory: InventoryData }
export interface MaximumInventoryData {
  readonly revision: number; readonly stackId: string; readonly destinationInventoryId: string;
  readonly maximumQuantity: number; readonly unavailableReason: string | null;
}
