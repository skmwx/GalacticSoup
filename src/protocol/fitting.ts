import type { ItemData, LocationData, SlotRefData } from './assets';

/**
 * Ship, fitting, derived-stat and comparison views
 * (Functional Specification 8.2-8.5, 19.6).
 *
 * Every number here is derived by the engine and copied into an immutable view
 * model. A derived statistic always travels with the trace that produced it,
 * because the interface must be able to explain a value rather than assert it
 * (Functional Specification 4.4, 19.6).
 */

/** One step of a calculation, in the order it was applied. */
export interface AttributeStepData {
  readonly sourceId: string;
  readonly sourceKey: string;
  readonly operation: string;
  readonly stage: string;
  readonly value: number;
  readonly stackingMultiplier: number;
  readonly effectiveValue: number;
  readonly result: number;
}

export interface DerivedStatData {
  readonly attribute: string;
  readonly labelKey: string;
  readonly base: number;
  readonly value: number;
  /** True when a bound of Functional Specification 4.2 changed the result. */
  readonly clamped: boolean;
  readonly steps: readonly AttributeStepData[];
}

export interface FitIssueData {
  readonly code: string;
  readonly messageKey: string;
  readonly slot: SlotRefData | null;
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export interface MissingItemData {
  readonly definitionId: string;
  readonly nameKey: string;
  readonly required: number;
  readonly available: number;
}

export interface LoadedChargeData {
  readonly item: ItemData;
  readonly quantity: number;
  readonly stackId: string | null;
}

export interface FittedSlotData {
  readonly slot: SlotRefData;
  /** `null` for a slot the hull offers but nothing occupies. */
  readonly module: ItemData | null;
  readonly online: boolean;
  readonly charge: LoadedChargeData | null;
  readonly stackId: string | null;
  /** What the module needs while online, whether or not it is online. */
  readonly powerUse: number;
  readonly processingUse: number;
  readonly category: string | null;
  readonly hardpoint: string | null;
}

export interface ResourceUseData {
  readonly used: number;
  readonly available: number;
}

export interface WeaponStatData {
  readonly slot: SlotRefData;
  readonly moduleId: string;
  readonly online: boolean;
  readonly ammunitionId: string | null;
  readonly loadedRounds: number;
  readonly magazineSize: number;
  readonly optimalRangeKm: number;
  readonly falloffKm: number;
  readonly absoluteRangeKm: number;
  readonly trackingRadiansPerSecond: number;
  readonly signatureResolutionMetres: number;
  readonly cycleSeconds: number;
  readonly capacitorPerCycle: number;
  readonly damagePerShot: Readonly<Record<string, number>>;
  readonly volleyDamage: number;
  readonly damagePerSecond: number;
}

export interface CapacitorStatData {
  readonly charge: number;
  readonly capacity: number;
  readonly rechargeSeconds: number;
  readonly rechargePerSecond: number;
  readonly drainPerSecond: number;
  readonly stable: boolean;
  readonly enduranceSeconds: number | null;
}

export interface LayerConditionData {
  readonly layer: string;
  readonly hitPoints: number;
  readonly maximumHitPoints: number;
  readonly resistances: readonly { readonly damageType: string; readonly value: number }[];
}

export interface DefenseStatData {
  readonly burstHitPoints: Readonly<Record<string, number>>;
  readonly sustainedHitPointsPerSecond: Readonly<Record<string, number>>;
}

export interface ShipData {
  readonly revision: number;
  readonly id: string;
  readonly hullId: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly traitKeys: readonly string[];
  readonly active: boolean;
  readonly location: LocationData;
  readonly cargoInventoryId: string;
  readonly fittingInventoryId: string;
  readonly slots: readonly FittedSlotData[];
  readonly slotUse: Readonly<Record<string, ResourceUseData>>;
  readonly hardpointUse: Readonly<Record<string, ResourceUseData>>;
  readonly power: ResourceUseData;
  readonly processing: ResourceUseData;
  /** Ordered by attribute, each with the trace that produced it. */
  readonly attributes: readonly DerivedStatData[];
  readonly layers: readonly LayerConditionData[];
  readonly capacitor: CapacitorStatData;
  readonly weapons: readonly WeaponStatData[];
  readonly defense: DefenseStatData;
  readonly violations: readonly FitIssueData[];
  readonly warnings: readonly FitIssueData[];
  readonly undockable: boolean;
}

export interface PlannedSlotData {
  readonly slot: SlotRefData;
  readonly module: ItemData | null;
  readonly online: boolean;
  readonly charge: ItemData | null;
}

export interface OpenFittingDraftData {
  readonly shipId: string;
  readonly baseRevision: number;
  /** False while the draft still describes the fit the ship is wearing. */
  readonly changed: boolean;
  readonly slots: readonly PlannedSlotData[];
  readonly missing: readonly MissingItemData[];
  /** False when committing would fail outright, such as a full cargo hold. */
  readonly committable: boolean;
  readonly blockedReason: string | null;
  /** The ship as committing the draft would leave it. */
  readonly preview: ShipData | null;
}

export interface FittingDraftData {
  readonly revision: number;
  readonly draft: OpenFittingDraftData | null;
}

export interface UndockValidityData {
  readonly revision: number;
  readonly shipId: string;
  readonly undockable: boolean;
  readonly violations: readonly FitIssueData[];
  /** Message key stating why undocking is unavailable, or `null`. */
  readonly unavailableReason: string | null;
}

/** How a difference reads for the player (Functional Specification 19.6). */
export const COMPARISON_DIRECTIONS = ['better', 'worse', 'equal', 'neutral'] as const;

export type ComparisonDirection = (typeof COMPARISON_DIRECTIONS)[number];

export interface ComparisonEntryData {
  readonly key: string;
  readonly labelKey: string;
  /** Purpose the row belongs to, so the interface can group differences. */
  readonly group: string;
  readonly left: number | null;
  readonly right: number | null;
  readonly difference: number | null;
  readonly direction: ComparisonDirection;
}

export interface ComparisonData {
  readonly revision: number;
  readonly left: ItemData;
  readonly right: ItemData;
  /** False when the two definitions have nothing meaningful in common. */
  readonly comparable: boolean;
  readonly entries: readonly ComparisonEntryData[];
}

/** Payloads of the fitting commands and queries. */
export interface ShipPayload {
  readonly shipId: string;
}

export interface BeginFittingPayload {
  readonly shipId: string;
}

export interface SetFittingSlotPayload {
  readonly slotKind: string;
  readonly slotIndex: number;
  readonly moduleId: string;
  readonly online: boolean;
  /** Absent leaves the slot without a charge. */
  readonly ammunitionId?: string;
}

export interface ClearFittingSlotPayload {
  readonly slotKind: string;
  readonly slotIndex: number;
}

export interface ComparePayload {
  readonly definitionId: string;
  readonly againstDefinitionId: string;
}
