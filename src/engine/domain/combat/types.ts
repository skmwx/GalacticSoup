import type { DefenseLayer, DamageProfile, DamageType, ModuleCategory } from '@engine/ports';
import type { AmmunitionId } from '@shared';

import type { EntityId } from '../campaign/identity';

/**
 * Locks, weapon cycles and reloads (Functional Specification 9.2, 9.4;
 * Technical Specification 8.2, 10.3).
 *
 * Combat runtime belongs to the ship that owns it, keyed by the entity id the
 * site knows it by. Nothing here is a host timer: a lock, a weapon cycle and a
 * reload are each a scheduled boundary, and the entry that will resolve them
 * is named so cancelling the action cancels exactly its own boundary and
 * nothing else the ship has queued.
 *
 * Committed costs are explicit. A cycle records the capacitor it already spent
 * and the rounds it holds back from the magazine, because cancelling must
 * return the rounds and must not refund the capacitor
 * (Functional Specification 9.4, 22.11).
 *
 * @implements FUNC-9.2, FUNC-9.4, TECH-8.2, TECH-10.3
 */

export const LOCK_STATUSES = ['locking', 'locked'] as const;
export type LockStatus = (typeof LOCK_STATUSES)[number];

export interface LockState {
  /** Site-object id of the target. */
  readonly targetId: string;
  readonly status: LockStatus;
  readonly startedAtMs: number;
  /** Simulation time the attempt is due to complete; `null` once locked. */
  readonly completesAtMs: number | null;
  /** The boundary that completes the attempt; `null` once locked. */
  readonly boundaryEntryId: EntityId | null;
  /**
   * When the target first went beyond maximum lock range, so the grace period
   * of Functional Specification 9.2 can be measured. `null` while in range.
   */
  readonly outOfRangeSinceMs: number | null;
}

export interface WeaponCycleState {
  readonly startedAtMs: number;
  readonly completesAtMs: number;
  readonly boundaryEntryId: EntityId;
  readonly targetId: string;
  /** The charge this cycle will fire, fixed when the cycle started. */
  readonly ammunitionId: AmmunitionId | null;
  /** Rounds held back from the magazine until the shot is applied. */
  readonly reservedRounds: number;
  /** Capacitor already spent. Cancellation never refunds it. */
  readonly committedCapacitor: number;
}

export interface WeaponReloadState {
  readonly ammunitionId: AmmunitionId;
  readonly startedAtMs: number;
  readonly completesAtMs: number;
  readonly boundaryEntryId: EntityId;
  /** True when the magazine was unloaded to cargo before this reload. */
  readonly changing: boolean;
}

/** Why a weapon stopped repeating (Functional Specification 9.4). */
export const WEAPON_STOP_REASONS = [
  'deactivated',
  'lockLost',
  'targetMissing',
  'ammunitionExhausted',
  'insufficientCapacitor',
  'siteLeft',
] as const;
export type WeaponStopReason = (typeof WEAPON_STOP_REASONS)[number];

export interface WeaponState {
  /** The player asked this weapon to keep cycling. */
  readonly repeating: boolean;
  /** The locked target it fires at, or `null` while inactive. */
  readonly targetId: string | null;
  readonly cycle: WeaponCycleState | null;
  readonly reload: WeaponReloadState | null;
  /**
   * A reload asked for while a cycle was still running. It begins when that
   * cycle completes (Functional Specification 9.4).
   */
  readonly pendingReload: { readonly ammunitionId: AmmunitionId; readonly changing: boolean } | null;
  /**
   * The charge this weapon last held. An empty magazine holds no stack, so
   * this is what an explicit or automatic reload refills with.
   */
  readonly lastAmmunitionId: AmmunitionId | null;
  /** Why it last stopped repeating, for the interface to display. */
  readonly stopReason: WeaponStopReason | null;
}

/**
 * One paid cycle of a non-weapon active module (Functional Specification 9.8).
 *
 * Propulsion receives its effect for the duration of this record. Repair
 * modules apply their result when the boundary completes. The committed cost
 * is retained explicitly so a save in the middle of a cycle cannot pay twice
 * or receive a refund after reload.
 */
export interface ActiveModuleCycleState {
  readonly startedAtMs: number;
  readonly completesAtMs: number;
  readonly boundaryEntryId: EntityId;
  readonly committedCapacitor: number;
}

export const ACTIVE_MODULE_STOP_REASONS = [
  'deactivated',
  'insufficientCapacitor',
  'destroyed',
  'siteLeft',
] as const;
export type ActiveModuleStopReason = (typeof ACTIVE_MODULE_STOP_REASONS)[number];

export interface ActiveModuleState {
  /** The operator should continue starting cycles until deactivated. */
  readonly repeating: boolean;
  readonly cycle: ActiveModuleCycleState | null;
  /** A repeating module with no cycle retries after capacitor regeneration. */
  readonly waitingForCapacitor: boolean;
  readonly stopReason: ActiveModuleStopReason | null;
}

/** A persisted recent-change window for the capacitor display. */
export interface CapacitorTrendState {
  readonly windowStartedAtMs: number;
  readonly lastChangedAtMs: number;
  /** Regeneration is positive and cycle payments are negative. */
  readonly netChange: number;
}

export interface ShipCombatState {
  readonly locks: readonly LockState[];
  /** Weapon runtime by slot key, for the weapon slots that have been used. */
  readonly weapons: Readonly<Record<string, WeaponState>>;
  /** Non-weapon active-module runtime by fitted slot key. */
  readonly modules: Readonly<Record<string, ActiveModuleState>>;
  /** Set after all committed completions at the timestamp have resolved. */
  readonly destroyedAtMs: number | null;
  readonly capacitorTrend: CapacitorTrendState | null;
}

export interface AggregatedDamageEvent {
  readonly kind: 'damage';
  readonly firstAtMs: number;
  readonly lastAtMs: number;
  readonly sourceId: string;
  readonly targetId: string;
  readonly slotKey: string;
  readonly count: number;
  readonly rawDamage: DamageProfile;
  /** Damage removed from hit-point layers, after resistance. */
  readonly appliedDamage: DamageProfile;
}

export interface AggregatedRepairEvent {
  readonly kind: 'repair';
  readonly firstAtMs: number;
  readonly lastAtMs: number;
  readonly shipId: string;
  readonly slotKey: string;
  readonly layer: DefenseLayer;
  readonly count: number;
  readonly repairedHitPoints: number;
}

export interface DestructionCombatEvent {
  readonly kind: 'destruction';
  readonly firstAtMs: number;
  readonly lastAtMs: number;
  readonly shipId: string;
  readonly count: 1;
}

/**
 * The bounded, persisted combat recorder (Technical Specification 10.3).
 * Routine repeated damage and repairs are aggregated while the semantic
 * domain events for each individual completion are still published.
 */
export type CombatEventRecord =
  | AggregatedDamageEvent
  | AggregatedRepairEvent
  | DestructionCombatEvent;

export interface CombatState {
  /** Changes whenever any combat runtime changes, for projection binding. */
  readonly version: number;
  /** Combat runtime by ship entity id. A ship outside a site holds none. */
  readonly ships: Readonly<Record<string, ShipCombatState>>;
  /** Oldest first, capped by the recorder. */
  readonly events: readonly CombatEventRecord[];
}

/** One resolved turret shot (Functional Specification 9.5). */
export interface ShotOutcome {
  readonly attackerId: string;
  readonly targetId: string;
  readonly slotKey: string;
  readonly moduleId: string;
  readonly ammunitionId: AmmunitionId | null;
  readonly hitChance: number;
  readonly hit: boolean;
  readonly critical: boolean;
  /** 0 on a miss; the variation or critical multiplier on a hit. */
  readonly damageMultiplier: number;
  /** Raw damage before any resistance, by damage type. */
  readonly damage: DamageProfile;
  readonly totalDamage: number;
}

/** A fitted module category that has a player-controlled repeating operator. */
export type OperatedModuleCategory = Extract<
  ModuleCategory,
  'propulsion' | 'shieldBooster' | 'armorRepairer'
>;

/** Applied damage by component is kept structurally complete. */
export type AppliedDamageByType = Readonly<Record<DamageType, number>>;
