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
  readonly docked: boolean;
  readonly serviceModifier: number;
  readonly services: readonly StationServiceData[];
}

export interface MarketListingData {
  readonly item: MarketItemData;
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
  readonly unavailableReason: string | null;
}

export interface ShipEconomicPayload { readonly shipId: string }
