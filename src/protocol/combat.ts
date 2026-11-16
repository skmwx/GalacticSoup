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

/**
 * Starts an operated module. A targeted module (the web) names the locked
 * target it acts on; any other module takes no target.
 */
export interface ActivateModulePayload extends WeaponSlotPayload {
  readonly targetId?: string;
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

/**
 * Which half of the turret formula costs a shot the most
 * (Functional Specification 19.3). `none` only when neither costs anything.
 */
/** Turret: range or tracking. Guided: signature or speed (Functional Specification 9.5-9.6). */
export type LimitingFactorData = 'none' | 'range' | 'tracking' | 'signature' | 'speed';

/**
 * Guided application against one target now (Functional Specification 9.6).
 * It is an estimate from current values: the target's signature and speed at
 * impact decide the real result.
 */
export interface GuidedEffectData {
  readonly estimatedFlightSeconds: number;
  /** False when the target is beyond the stationary-target flight distance. */
  readonly withinFlightRange: boolean;
  readonly targetSpeedKmPerSecond: number;
  readonly signatureFactor: number;
  readonly speedFactor: number;
  readonly damageMultiplier: number;
}

/** What one weapon would do against one target right now. */
export interface WeaponEffectData {
  readonly targetId: string;
  readonly kind: 'turret' | 'guided';
  /** Turret hit chance; for a guided weapon 1 within flight range and 0 beyond it. */
  readonly hitChance: number;
  readonly trackingStrain: number;
  readonly rangeStrain: number;
  readonly withinAbsoluteRange: boolean;
  readonly limitingFactor: LimitingFactorData;
  /** Listed damage of one shot, before variation and before resistances. */
  readonly listedDamage: Readonly<Record<string, number>>;
  readonly expectedDamagePerShot: number;
  /** `null` for a turret. */
  readonly guided: GuidedEffectData | null;
  readonly trace: FormulaTraceData;
}

/** One guided projectile in flight (Functional Specification 9.6, 19.3). */
export interface ProjectileData {
  readonly id: string;
  /** Retained source attribution; the source may already be gone. */
  readonly sourceId: string;
  readonly sourceSlot: string;
  readonly targetId: string;
  readonly ammunitionId: string;
  readonly ammunitionNameKey: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly launchedAtMs: number;
  readonly expiresAtMs: number;
  readonly remainingFlightSeconds: number;
  /** True when the player's ship launched it. */
  readonly fromPlayer: boolean;
  /** True when it follows the player's ship. */
  readonly atPlayer: boolean;
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

/**
 * A module a ship is running right now, as another pilot would see it
 * (Functional Specification 19.3). Burning propulsion or cycling a repairer
 * is visible, so it is published for opponents as well as for the player.
 */
export interface ActiveEffectData {
  readonly slot: SlotRefData;
  readonly moduleId: string;
  readonly nameKey: string;
  readonly category: string;
}

export interface DefenseStateData {
  readonly shipId: string;
  readonly destroyed: boolean;
  readonly destroyedAtMs: number | null;
  readonly layers: readonly DefenseLayerData[];
  /** Modules the ship is cycling, in slot order. */
  readonly activeEffects: readonly ActiveEffectData[];
  /** Temporary speed reductions on the ship, in application order. */
  readonly speedEffects: readonly SpeedEffectData[];
  readonly speed: SpeedLimitData;
}

/**
 * One temporary speed reduction on a ship (Functional Specification 9.9).
 * Its source is a retained attribution: `sourcePresent` is false once that
 * ship has been destroyed or has left, and the effect still runs out its time.
 */
export interface SpeedEffectData {
  readonly effectId: string;
  readonly sourceId: string;
  readonly sourceSlot: string;
  readonly sourcePresent: boolean;
  /** True when the player's own ship applied it. */
  readonly fromPlayer: boolean;
  readonly moduleId: string;
  readonly nameKey: string;
  /** Maximum speed is multiplied by this while it lasts. */
  readonly speedFactor: number;
  readonly appliedAtMs: number;
  readonly expiresAtMs: number;
  readonly remainingSeconds: number;
}

/**
 * A ship's maximum normal speed with and without the effects on it
 * (Functional Specification 9.9, 19.6). `atFloor` says the floor - a share of
 * the hull's unmodified maximum - held the result up.
 */
export interface SpeedLimitData {
  readonly unaffectedMaximumKmPerSecond: number;
  readonly maximumKmPerSecond: number;
  readonly floorKmPerSecond: number;
  readonly currentKmPerSecond: number;
  readonly atFloor: boolean;
  readonly trace: FormulaTraceData;
}

/** Whether a targeted module could act on one locked target now (Functional Specification 9.9). */
export interface ModuleTargetData {
  readonly targetId: string;
  readonly rangeKm: number;
  readonly withinRange: boolean;
  readonly command: CommandAvailabilityData;
}

/**
 * Another ship's lock on the player's ship
 * (Functional Specification 19.1, 19.7). Being targeted is the first warning
 * a fight gives, so the tactical view publishes it rather than leaving the
 * player to infer it from incoming fire.
 */
export interface HostileLockData {
  readonly shipId: string;
  readonly status: 'locking' | 'locked';
}

/**
 * One charge a weapon could fire, and what firing it would mean
 * (Functional Specification 9.4, 19.6). Values are after the turret's own
 * multipliers, so two options compare directly.
 */
export interface AmmunitionOptionData {
  readonly ammunitionId: string;
  readonly nameKey: string;
  /** True for the charge in the magazine now. */
  readonly loaded: boolean;
  /** Rounds of it in the ship's hold. */
  readonly cargoRounds: number;
  readonly listedDamage: Readonly<Record<string, number>>;
  readonly optimalRangeKm: number;
  readonly falloffKm: number;
  readonly trackingRadiansPerSecond: number;
  /** Guided charges only; 0 for a turret charge. */
  readonly maximumFlightDistanceKm: number;
  readonly explosionRadiusMetres: number;
  readonly explosionVelocityKmPerSecond: number;
  /** Whether the weapon could change to it now, and why not. */
  readonly commands: readonly CommandAvailabilityData[];
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
  /** The target a targeted module's cycle acts on; `null` otherwise. */
  readonly targetId: string | null;
}

export interface ModuleEffectData {
  readonly kind: 'propulsion' | 'repair' | 'resistance' | 'capacitorSupport' | 'passive' | 'web';
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
  /** True for a module that acts on a locked target (the web). */
  readonly targeted: boolean;
  /** The target it is repeating on, or `null`. */
  readonly targetId: string | null;
  /** For a targeted module: each completed lock and whether it could act on it. */
  readonly targets: readonly ModuleTargetData[];
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
      /** Applied damage by the layer it came off. */
      readonly layerDamage: Readonly<Record<string, number>>;
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
    }
  | {
      /** Web applications by one source on one target (Functional Specification 9.9). */
      readonly kind: 'control';
      readonly firstAtMs: number;
      readonly lastAtMs: number;
      readonly sourceId: string;
      readonly targetId: string;
      readonly slotKey: string;
      readonly moduleId: string;
      readonly count: number;
      readonly speedFactor: number;
      readonly expiresAtMs: number;
    };

export interface WeaponRuntimeData {
  readonly slot: SlotRefData;
  readonly moduleId: string;
  readonly nameKey: string;
  /** Turret range fields apply to a turret, flight fields to a launcher; the rest are 0. */
  readonly kind: 'turret' | 'guided';
  readonly family: 'projectile' | 'hybrid' | 'guided';
  readonly online: boolean;
  readonly ammunitionId: string | null;
  readonly ammunitionNameKey: string | null;
  readonly loadedRounds: number;
  readonly magazineSize: number;
  readonly cycleSeconds: number;
  readonly capacitorPerCycle: number;
  readonly optimalRangeKm: number;
  readonly falloffKm: number;
  readonly absoluteRangeKm: number;
  readonly trackingRadiansPerSecond: number;
  readonly flightSpeedKmPerSecond: number;
  readonly flightTimeSeconds: number;
  /** Reach against a stationary target; a target moving away can escape. */
  readonly maximumFlightDistanceKm: number;
  readonly explosionRadiusMetres: number;
  readonly explosionVelocityKmPerSecond: number;
  readonly repeating: boolean;
  readonly targetId: string | null;
  readonly cycle: WeaponCycleData | null;
  readonly reload: WeaponReloadData | null;
  /** Why it last stopped repeating (Functional Specification 9.4). */
  readonly stopReason: string | null;
  /** Ammunition in cargo this weapon accepts, in stable order. */
  readonly compatibleAmmunition: readonly string[];
  /** The loaded charge and every accepted one in cargo, in stable order. */
  readonly ammunitionOptions: readonly AmmunitionOptionData[];
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
  /** Ships in the site locking or locked onto the player, by ship id. */
  readonly hostileLocks: readonly HostileLockData[];
  readonly events: readonly CombatEventData[];
  readonly locks: readonly LockData[];
  readonly motion: readonly TargetMotionData[];
  readonly weapons: readonly WeaponRuntimeData[];
  /** Guided projectiles in flight in the site, in launch order. */
  readonly projectiles: readonly ProjectileData[];
  /** Whether each object in the site may be locked, keyed by object id. */
  readonly lockCommands: readonly ObjectLockAvailabilityData[];
}

export interface ObjectLockAvailabilityData {
  readonly objectId: string;
  readonly commands: readonly CommandAvailabilityData[];
}
