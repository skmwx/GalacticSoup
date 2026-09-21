import type { SlotRefData } from './assets';
import type { FormulaTraceData } from './economy';
import type { CommandAvailabilityData } from './navigation';

/**
 * Targeting, weapon and tactical views
 * (Functional Specification 9.2-9.5, 19.3).
 *
 * Every number here is derived by the engine. Range, closing speed, transverse
 * velocity, angular velocity and hit chance travel with the trace that
 * produced them, because the tactical view has to explain why a shot missed
 * rather than assert that it did.
 */

/** Payloads of the targeting and weapon commands. */
export interface TargetPayloadData {
  readonly targetId: string;
}

export interface WeaponSlotPayload {
  readonly slotKind: string;
  readonly slotIndex: number;
}

export interface ActivateWeaponPayload extends WeaponSlotPayload {
  readonly targetId: string;
}

export interface ChangeAmmunitionPayload extends WeaponSlotPayload {
  readonly ammunitionId: string;
}

export interface LockData {
  readonly targetId: string;
  readonly status: 'locking' | 'locked';
  readonly startedAtMs: number;
  /** Simulation time the attempt completes at, or `null` once locked. */
  readonly completesAtMs: number | null;
  /** Seconds still to run on the attempt, or `null` once locked. */
  readonly remainingSeconds: number | null;
  /** The lock time the current values produce, with its calculation. */
  readonly lockTimeSeconds: number;
  readonly trace: FormulaTraceData;
  /** Simulation time the target left lock range at, or `null`. */
  readonly outOfRangeSinceMs: number | null;
  readonly commands: readonly CommandAvailabilityData[];
}

/** Relative motion against one object (Functional Specification 9.3). */
export interface TargetMotionData {
  readonly targetId: string;
  readonly rangeKm: number;
  /** Positive while the range is shrinking, negative while it grows. */
  readonly closingSpeedKmPerSecond: number;
  readonly transverseVelocityKmPerSecond: number;
  readonly angularVelocityRadiansPerSecond: number;
  readonly signatureRadiusMetres: number;
  readonly withinLockRange: boolean;
}

/** What one weapon would do against one target right now. */
export interface WeaponEffectData {
  readonly targetId: string;
  readonly hitChance: number;
  readonly trackingStrain: number;
  readonly rangeStrain: number;
  readonly withinAbsoluteRange: boolean;
  /** Listed damage of one shot, before variation and before resistances. */
  readonly listedDamage: Readonly<Record<string, number>>;
  readonly expectedDamagePerShot: number;
  readonly trace: FormulaTraceData;
}

export interface WeaponCycleData {
  readonly startedAtMs: number;
  readonly completesAtMs: number;
  readonly remainingSeconds: number;
  readonly targetId: string;
  readonly ammunitionId: string | null;
  readonly reservedRounds: number;
  readonly committedCapacitor: number;
}

export interface WeaponReloadData {
  readonly ammunitionId: string;
  readonly completesAtMs: number;
  readonly remainingSeconds: number;
  readonly changing: boolean;
}

export interface DefenseLayerData {
  readonly layer: 'shield' | 'armor' | 'hull';
  readonly currentHitPoints: number;
  readonly maximumHitPoints: number;
  readonly damageTaken: number;
  readonly fractionRemaining: number;
  readonly resistances: Readonly<Record<string, number>>;
  readonly hitPointsTrace: FormulaTraceData;
  readonly resistanceTraces: Readonly<Record<string, FormulaTraceData>>;
}

export interface DefenseStateData {
  readonly shipId: string;
  readonly destroyed: boolean;
  readonly destroyedAtMs: number | null;
  readonly layers: readonly DefenseLayerData[];
}

export interface CapacitorStateData {
  readonly charge: number;
  readonly capacity: number;
  readonly rechargePerSecond: number;
  readonly recentNetChangePerSecond: number;
  readonly projectedUsePerSecond: number;
  readonly projectedNetChangePerSecond: number;
  /** `null` means current repeating use is sustainable. */
  readonly enduranceSeconds: number | null;
  readonly stable: boolean;
  readonly capacityTrace: FormulaTraceData;
  readonly rechargeTrace: FormulaTraceData;
  readonly enduranceTrace: FormulaTraceData;
}

export interface ActiveModuleCycleData {
  readonly startedAtMs: number;
  readonly completesAtMs: number;
  readonly remainingSeconds: number;
  readonly committedCapacitor: number;
}

export interface ModuleEffectData {
  readonly kind: 'propulsion' | 'repair' | 'resistance' | 'capacitorSupport';
  readonly layer: string | null;
  readonly amountPerCycle: number;
  readonly sustainedPerSecond: number;
  readonly baseValue: number;
  readonly activeValue: number;
  readonly values: Readonly<Record<string, number>>;
  readonly trace: FormulaTraceData;
}

export interface ModuleRuntimeData {
  readonly slot: SlotRefData;
  readonly moduleId: string;
  readonly nameKey: string;
  readonly category: string;
  readonly online: boolean;
  readonly passive: boolean;
  readonly repeating: boolean;
  readonly waitingForCapacitor: boolean;
  readonly status: 'offline' | 'passive' | 'inactive' | 'active' | 'waiting' | 'deactivating';
  readonly cycleSeconds: number;
  readonly capacitorPerCycle: number;
  readonly cycle: ActiveModuleCycleData | null;
  readonly stopReason: string | null;
  readonly effect: ModuleEffectData;
  readonly commands: readonly CommandAvailabilityData[];
}

export type CombatEventData =
  | {
      readonly kind: 'damage';
      readonly firstAtMs: number;
      readonly lastAtMs: number;
      readonly sourceId: string;
      readonly targetId: string;
      readonly slotKey: string;
      readonly count: number;
      readonly rawDamage: Readonly<Record<string, number>>;
      readonly appliedDamage: Readonly<Record<string, number>>;
    }
  | {
      readonly kind: 'repair';
      readonly firstAtMs: number;
      readonly lastAtMs: number;
      readonly shipId: string;
      readonly slotKey: string;
      readonly layer: string;
      readonly count: number;
      readonly repairedHitPoints: number;
    }
  | {
      readonly kind: 'destruction';
      readonly firstAtMs: number;
      readonly lastAtMs: number;
      readonly shipId: string;
      readonly count: number;
    };

export interface WeaponRuntimeData {
  readonly slot: SlotRefData;
  readonly moduleId: string;
  readonly nameKey: string;
  readonly online: boolean;
  readonly ammunitionId: string | null;
  readonly loadedRounds: number;
  readonly magazineSize: number;
  readonly cycleSeconds: number;
  readonly capacitorPerCycle: number;
  readonly optimalRangeKm: number;
  readonly falloffKm: number;
  readonly absoluteRangeKm: number;
  readonly trackingRadiansPerSecond: number;
  readonly repeating: boolean;
  readonly targetId: string | null;
  readonly cycle: WeaponCycleData | null;
  readonly reload: WeaponReloadData | null;
  /** Why it last stopped repeating (Functional Specification 9.4). */
  readonly stopReason: string | null;
  /** Ammunition in cargo this weapon accepts, in stable order. */
  readonly compatibleAmmunition: readonly string[];
  /** Effectiveness against each locked target, in the order of `locks`. */
  readonly effects: readonly WeaponEffectData[];
  readonly commands: readonly CommandAvailabilityData[];
}

export interface CombatData {
  readonly revision: number;
  readonly simulationTimeMs: number;
  /** `null` while the player's ship is not present in a loaded site. */
  readonly shipId: string | null;
  readonly maxLockedTargets: number;
  readonly maxLockRangeKm: number;
  readonly scanResolution: number;
  readonly signatureRadiusMetres: number;
  readonly capacitorCharge: number;
  readonly capacitorCapacity: number;
  readonly defenses: DefenseStateData | null;
  readonly capacitor: CapacitorStateData | null;
  readonly modules: readonly ModuleRuntimeData[];
  readonly targetDefenses: readonly DefenseStateData[];
  readonly events: readonly CombatEventData[];
  readonly locks: readonly LockData[];
  readonly motion: readonly TargetMotionData[];
  readonly weapons: readonly WeaponRuntimeData[];
  /** Whether each object in the site may be locked, keyed by object id. */
  readonly lockCommands: readonly ObjectLockAvailabilityData[];
}

export interface ObjectLockAvailabilityData {
  readonly objectId: string;
  readonly commands: readonly CommandAvailabilityData[];
}
