import type { DefinitionId, StationId } from '@shared';

/** Mutable market state layered over immutable authored listing definitions. */
export interface MarketListingState {
  readonly itemId: DefinitionId;
  /** Whole units currently held by the station. Fixed listings never consume this value. */
  readonly stock: number;
  /** Fractional production/consumption carried between hourly boundaries. */
  readonly stockAccumulator: number;
  readonly lastProcessedHour: number;
  readonly eventFactor: number;
  /** Changes only when a value used by a quote changes. */
  readonly version: number;
}

export const ECONOMY_SERVICE_NAMES = ['market', 'repair', 'resupply', 'insurance'] as const;
export type EconomyServiceName = (typeof ECONOMY_SERVICE_NAMES)[number];

export interface StationServiceState {
  readonly available: boolean;
  readonly version: number;
}

export interface StationEconomyState {
  readonly stationId: StationId;
  readonly services: Readonly<Record<EconomyServiceName, StationServiceState>>;
  readonly listings: Readonly<Record<string, MarketListingState>>;
}

export interface EconomyState {
  readonly stations: Readonly<Record<string, StationEconomyState>>;
}

export type MarketSide = 'stationSells' | 'stationBuys';

export interface FormulaOperand {
  readonly key: string;
  readonly value: number;
}

export interface FormulaTrace {
  readonly formulaKey: string;
  readonly operands: readonly FormulaOperand[];
  readonly unroundedResult: number;
  readonly displayResult: number;
}

export interface UnitQuote {
  readonly side: MarketSide;
  readonly unitPriceCredits: number;
  readonly scarcity: number;
  readonly midPriceCredits: number;
  readonly effectiveSpread: number;
  readonly trace: FormulaTrace;
}

export interface BulkQuote {
  readonly side: MarketSide;
  readonly quantity: number;
  readonly totalCredits: number;
  readonly averageUnitPriceCredits: number;
  readonly firstUnitPriceCredits: number;
  readonly lastUnitPriceCredits: number;
  readonly initialStock: number | null;
  readonly remainingStock: number | null;
  readonly priceMovementCredits: number;
  readonly firstUnitTrace: FormulaTrace;
  readonly lastUnitTrace: FormulaTrace;
}

export class EconomyError extends Error {
  constructor(
    readonly reason:
      | 'stationNotFound'
      | 'serviceUnavailable'
      | 'listingNotFound'
      | 'insufficientStock'
      | 'invalidPreview',
  ) {
    super(reason);
    this.name = 'EconomyError';
  }
}
