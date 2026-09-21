import type { NpcRole, SlotKind } from './definitions.ts';

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

/**
 * Tunable navigation thresholds (Functional Specification 7.2-7.4).
 *
 * Angles use radians and durations use whole simulation milliseconds after
 * loading. The authored JSON uses the same canonical units for this group.
 */
export interface NavigationRules {
  readonly approachToleranceKm: number;
  readonly minimumKeepRangeToleranceKm: number;
  readonly keepRangeToleranceFraction: number;
  readonly warpMinimumDistanceKm: number;
  readonly warpAlignmentRadians: number;
  readonly warpMinimumSpeedFraction: number;
  readonly warpPreparationMs: number;
  readonly dockRangeKm: number;
  readonly dockDurationMs: number;
  readonly undockDistanceKm: number;
  readonly stationRadiusKm: number;
  readonly separationSpeedKmPerSecond: number;
  readonly arrivalDistancesKm: readonly number[];
  /** Distances an approach, orbit or keep-range order offers, ascending. */
  readonly rangePresetsKm: readonly number[];
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
  /** How close a ship must be to open a wreck (Functional Specification 9.11). */
  readonly wreckAccessRangeKm: number;
  /** How often an opponent reconsiders its orders (Functional Specification 9.10). */
  readonly npcDecisionIntervalSeconds: number;
  /** Layer share below which an opponent runs its repair module. */
  readonly npcRepairThresholdFraction: number;
  /** Share of its preferred range an opponent tolerates before it burns. */
  readonly npcRangeToleranceFraction: number;
  readonly npcRoles: Readonly<Record<NpcRole, NpcRoleRules>>;
}

/**
 * The range band and movement order one NPC role commands
 * (Functional Specification 9.10).
 *
 * The preferred range is a fraction of the opponent's own best turret optimal
 * range, so a role stays a behaviour rather than a distance in kilometres that
 * would have to be retuned for every weapon.
 */
export interface NpcRoleRules {
  readonly movement: 'approach' | 'orbit' | 'keepRange';
  readonly preferredRangeFraction: number;
  readonly minimumRangeKm: number;
}

/**
 * One slot of the fit a new campaign starts with
 * (Functional Specification 3.1, 8.4).
 *
 * The modules and charges it names must be among the granted starting items:
 * a campaign fits what it was given rather than conjuring equipment.
 */
export interface StartingFitEntry {
  readonly slot: SlotKind;
  readonly index: number;
  readonly moduleId: string;
  readonly online: boolean;
  /** Loaded into the module when it accepts a charge. */
  readonly ammunitionId?: string;
}

export interface EconomyRules {
  readonly startingCredits: number;
  readonly startingStationId: string;
  readonly starterHullId: string;
  readonly startingItems: readonly { readonly definitionId: string; readonly quantity: number }[];
  readonly startingFit: readonly StartingFitEntry[];
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
  readonly navigation: NavigationRules;
  readonly combat: CombatRules;
  readonly economy: EconomyRules;
}

export const RULE_GROUPS = ['time', 'navigation', 'combat', 'economy'] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];
