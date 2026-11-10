import type { ItemData, SlotRefData } from './assets';

export const ECONOMIC_ACTIONS = [
  'market.buy', 'market.sell', 'repair', 'resupply', 'insurance.enhance',
] as const;
export type EconomicAction = (typeof ECONOMIC_ACTIONS)[number];

/**
 * A hull as a market row. A hull is bought like anything else but never
 * occupies a hold, so it carries no unit volume.
 */
export interface HullItemData {
  readonly definitionId: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly kind: 'hull';
  readonly unitVolumeCubicDecimetres: 0;
  readonly referenceValueCredits: number;
}

/** Anything a station market can quote. */
export type MarketItemData = ItemData | HullItemData;

export interface FormulaOperandData {
  readonly key: string;
  readonly value: number;
}

export interface FormulaTraceData {
  readonly formulaKey: string;
  readonly operands: readonly FormulaOperandData[];
  readonly unroundedResult: number;
  readonly displayResult: number;
}

/** State-bound token from Technical Specification 7.4. */
export interface PreviewTokenData {
  readonly action: EconomicAction;
  readonly canonicalParameters: string;
  readonly campaignRevision: number;
  readonly relevantVersions: Readonly<Record<string, number>>;
  readonly valuesHash: string;
}

export interface PreviewBaseData {
  readonly action: EconomicAction;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly token: PreviewTokenData | null;
  /** Positive adds credits to the wallet; negative spends them. */
  readonly walletDeltaCredits: number;
  readonly totalCredits: number;
  readonly traces: readonly FormulaTraceData[];
}

export interface MarketTransactionPreviewData extends PreviewBaseData {
  readonly action: 'market.buy' | 'market.sell';
  readonly stationId: string;
  readonly item: MarketItemData;
  readonly quantity: number;
  readonly sourceStackId: string | null;
  readonly destinationInventoryId: string | null;
  readonly averageUnitPriceCredits: number;
  readonly firstUnitPriceCredits: number;
  readonly lastUnitPriceCredits: number;
  readonly initialStock: number | null;
  readonly remainingStock: number | null;
  readonly priceMovementCredits: number;
  readonly cargoVolumeDeltaCubicDecimetres: number;
}

export interface RepairPreviewData extends PreviewBaseData {
  readonly action: 'repair';
  readonly stationId: string;
  readonly shipId: string;
  readonly shieldDamage: number;
  readonly armorDamage: number;
  readonly hullDamage: number;
  readonly missingArmorFraction: number;
  readonly missingHullFraction: number;
  /**
   * What the capacitor holds now and what the repair leaves it holding: the
   * recharge is part of the free shield repair (Functional Specification 10).
   */
  readonly capacitorCharge: number;
  readonly capacitorCapacity: number;
  readonly serviceModifier: number;
  readonly standingServiceMultiplier: number;
}

export interface ResupplyLineData {
  readonly slot: SlotRefData;
  readonly ammunitionId: string | null;
  /** Name key of the loaded charge, so the line names it without a lookup. */
  readonly ammunitionNameKey: string | null;
  readonly loadedRounds: number;
  readonly magazineSize: number;
  readonly roundsFromInventory: number;
  readonly roundsPurchased: number;
  readonly totalCredits: number;
  readonly unavailableReason: string | null;
}

export interface ResupplyPreviewData extends PreviewBaseData {
  readonly action: 'resupply';
  readonly stationId: string;
  readonly shipId: string;
  readonly lines: readonly ResupplyLineData[];
}

export interface InsurancePreviewData extends PreviewBaseData {
  readonly action: 'insurance.enhance';
  readonly stationId: string;
  readonly shipId: string;
  readonly currentCoverage: 'basic' | 'enhanced';
  readonly resultingCoverage: 'enhanced';
  readonly basicPayoutCredits: number;
  readonly enhancedPayoutCredits: number;
  readonly premiumCredits: number;
}

export type TransactionPreviewData =
  | MarketTransactionPreviewData
  | RepairPreviewData
  | ResupplyPreviewData
  | InsurancePreviewData;

export interface ConfirmPreviewPayload { readonly token: PreviewTokenData }
export interface MarketBuyPreviewPayload {
  readonly stationId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly destinationInventoryId?: string;
}
export interface MarketSellPreviewPayload {
  readonly stationId: string;
  readonly stackId: string;
  readonly quantity: number;
}

export interface StationPayload { readonly stationId: string }
export interface StationServiceData {
  readonly service: 'market' | 'fitting' | 'repair' | 'resupply' | 'insurance';
  readonly available: boolean;
  readonly unavailableReason: string | null;
}
export interface StationServicesData {
  readonly revision: number;
  readonly stationId: string;
  readonly nameKey: string;
  /** The system the station is in, so a docked pilot can see where they are. */
  readonly systemNameKey: string;
  /** The system danger rating, as the site view reports it in space. */
  readonly dangerRating: number;
  readonly docked: boolean;
  readonly serviceModifier: number;
  readonly services: readonly StationServiceData[];
}

/** A weapon definition that can load a charge, and whether the active ship's committed fit carries one. */
export interface MarketCompatibleWeaponData {
  readonly definitionId: string;
  readonly nameKey: string;
  readonly fitted: boolean;
}

/**
 * How a charge relates to the active ship's committed fit. `compatible` means
 * at least one fitted weapon accepts it; it says nothing about whether that
 * weapon is online, loaded or able to fire.
 */
export type MarketFitMatch = 'compatible' | 'incompatible' | 'noWeapons' | 'noShip';

/**
 * What an item is for, before it is bought: the slot a module occupies, or the
 * weapons a charge suits. `null` for anything else.
 */
export type MarketSuitabilityData =
  | { readonly kind: 'module'; readonly slot: string; readonly hardpoint: string | null }
  | {
      readonly kind: 'ammunition';
      readonly weapons: readonly MarketCompatibleWeaponData[];
      readonly currentFit: MarketFitMatch;
    };

/**
 * A plain stack the player owns here and could offer for sale: in this
 * station's hangar, or in the hold of the active ship docked at it. Fitted
 * modules and loaded charges are never listed.
 */
export interface MarketOwnedStackData {
  readonly stackId: string;
  readonly inventoryId: string;
  readonly source: 'hangar' | 'cargo';
  readonly quantity: number;
  readonly item: ItemData;
  readonly recoveryGrant: boolean;
  /** What the station pays for one unit, or `null` when it does not trade the item. */
  readonly unitSalePriceCredits: number | null;
  readonly sellable: boolean;
  readonly unavailableReason: string | null;
  readonly suitability: MarketSuitabilityData | null;
}

export interface MarketListingData {
  readonly item: MarketItemData;
  readonly suitability: MarketSuitabilityData | null;
  readonly supply: 'dynamic' | 'fixed';
  readonly stock: number | null;
  readonly stationSellPriceCredits: number;
  readonly stationBuyPriceCredits: number;
  readonly stationSellTrace: FormulaTraceData;
  readonly stationBuyTrace: FormulaTraceData;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}
export interface MarketListingsData {
  readonly revision: number;
  readonly stationId: string;
  readonly simulationHour: number;
  readonly listings: readonly MarketListingData[];
  /** Local stacks for the sell side; empty unless docked here. */
  readonly owned: readonly MarketOwnedStackData[];
  readonly unavailableReason: string | null;
}

export interface ShipEconomicPayload { readonly shipId: string }
