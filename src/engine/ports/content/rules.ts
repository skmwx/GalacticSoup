/**
 * Grouped tunable constants (Technical Specification 6.1).
 *
 * The functional specification describes these as values rather than as
 * structure, so they are authored in `content/rules/*.json` and reach the
 * engine through the content port. Algorithms stay in engine code; only the
 * numbers they use live here.
 *
 * Each phase adds the group it needs. The values present are those the MVP
 * formulas in Functional Specification 9-11 refer to directly.
 *
 * @implements TECH-6.1
 */

export interface TimeRules {
  /**
   * Fixed simulation quantum in milliseconds
   * (Technical Specification 9.1; Functional Specification 3.3).
   */
  readonly simulationQuantumMs: number;
  /** Time rates the MVP offers. Pause is not a rate; it stops the clock. */
  readonly timeRates: readonly number[];
  /**
   * Largest single elapsed real delta the engine accepts. Anything above it is
   * discarded rather than replayed, so a suspended tab produces no catch-up
   * (Technical Specification 9.1).
   */
  readonly maxFrameDeltaMs: number;
}

export interface CombatRules {
  /** Upper bound applied to any resistance (Functional Specification 4.2). */
  readonly resistanceMaximum: number;
  /** A hit deals this share of listed damage at minimum and maximum. */
  readonly damageVariationMinimum: number;
  readonly damageVariationMaximum: number;
  readonly criticalHitChance: number;
  readonly criticalHitMultiplier: number;
  /** Lock time is `clamp(min, max, coefficient x sqrt(refScan / scan) x sqrt(refSignature / signature))`. */
  readonly lockTimeCoefficient: number;
  readonly lockTimeMinimumSeconds: number;
  readonly lockTimeMaximumSeconds: number;
  readonly lockReferenceScanResolution: number;
  readonly lockReferenceSignatureMetres: number;
  /** A lock attempt is dropped after this long out of range. */
  readonly lockRangeGraceSeconds: number;
  readonly reloadSeconds: number;
  /** Turret absolute range is `optimal + this x falloff`. */
  readonly absoluteRangeFalloffMultiples: number;
  readonly npcWreckLifetimeSeconds: number;
  readonly playerWreckLifetimeSeconds: number;
  /** Independent survival chance of each cargo stack and fitted module. */
  readonly destructionItemSurvivalChance: number;
}

export interface EconomyRules {
  readonly startingCredits: number;
  readonly startingStationId: string;
  readonly starterHullId: string;
  readonly startingItems: readonly { readonly definitionId: string; readonly quantity: number }[];
  readonly scarcityMinimum: number;
  readonly scarcityMaximum: number;
  readonly midPriceMultiplierMinimum: number;
  readonly midPriceMultiplierMaximum: number;
  readonly effectiveSpreadMinimum: number;
  readonly effectiveSpreadMaximum: number;
  readonly elasticityMinimum: number;
  readonly elasticityMaximum: number;
  readonly baseSpreadMinimum: number;
  readonly baseSpreadMaximum: number;
  readonly minimumUnitPriceCredits: number;
  /** Repair cost fractions of hull reference value (Functional Specification 10). */
  readonly repairArmorFraction: number;
  readonly repairHullFraction: number;
  readonly stationServiceModifierMinimum: number;
  readonly stationServiceModifierMaximum: number;
  /** Insurance shares of hull reference value (Functional Specification 9.12). */
  readonly basicInsurancePayoutFraction: number;
  readonly enhancedInsurancePremiumFraction: number;
  readonly enhancedInsurancePayoutFraction: number;
}

export interface RulesContent {
  readonly time: TimeRules;
  readonly combat: CombatRules;
  readonly economy: EconomyRules;
}

export const RULE_GROUPS = ['time', 'combat', 'economy'] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];
