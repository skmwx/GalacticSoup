import {
  DAMAGE_TYPES,
  type DamageProfile,
  type DamageType,
  type DefenseLayer,
  type ResistanceProfile,
} from '@engine/ports';
import { clamp } from '@shared';

/**
 * Pure damage, repair and capacitor formulas
 * (Functional Specification 4.2, 9.7-9.8; Technical Specification 10.3).
 *
 * Damage components are always handled together. When a layer breaks, the
 * same proportion of every raw component crosses the boundary. Iterating the
 * four damage types in a different order can therefore never change which
 * layer receives the remainder.
 *
 * @implements FUNC-4.2, FUNC-9.7, FUNC-9.8, TECH-10.3, MVP-AC-04
 */

export interface DefenseLayerInput {
  readonly layer: DefenseLayer;
  readonly maximumHitPoints: number;
  readonly currentHitPoints: number;
  readonly resistances: ResistanceProfile;
}

export interface LayerDamageResult {
  readonly layer: DefenseLayer;
  readonly beforeHitPoints: number;
  readonly afterHitPoints: number;
  /** Raw damage that reached this layer. */
  readonly rawReceived: DamageProfile;
  /** Raw damage consumed here; the rest spills into the next layer. */
  readonly rawConsumed: DamageProfile;
  readonly rawRemaining: DamageProfile;
  /** Hit points removed after this layer's resistance. */
  readonly appliedDamage: DamageProfile;
  readonly resistedDamage: DamageProfile;
  readonly appliedTotal: number;
}

export interface LayeredDamageResult {
  readonly rawDamage: DamageProfile;
  readonly layers: readonly LayerDamageResult[];
  /** Raw damage left after hull. It has no further target in this phase. */
  readonly remainingRawDamage: DamageProfile;
  readonly appliedDamage: DamageProfile;
  readonly appliedTotal: number;
  readonly destroyed: boolean;
}

export function emptyDamageProfile(): Record<DamageType, number> {
  return {
    electromagnetic: 0,
    thermal: 0,
    kinetic: 0,
    explosive: 0,
  };
}

/** Applies one four-component hit through shield, armour and hull in order. */
export function applyLayeredDamage(
  rawDamage: DamageProfile,
  layers: readonly DefenseLayerInput[],
): LayeredDamageResult {
  const raw = sanitizeProfile(rawDamage);
  let remaining: DamageProfile = raw;
  const applied = emptyDamageProfile();
  const results: LayerDamageResult[] = [];

  for (const input of layers) {
    const maximum = nonNegative(input.maximumHitPoints);
    const before = clamp(0, maximum, nonNegative(input.currentHitPoints));
    const received = copyProfile(remaining);
    const effective = mapProfile(received, (value, type) =>
      value * (1 - clamp(0, 0.9, finiteOrZero(input.resistances[type]))),
    );
    const effectiveTotal = totalProfile(effective);
    const consumedFraction =
      effectiveTotal <= 0 ? 0 : Math.min(1, before / effectiveTotal);
    const rawConsumed = scaleProfile(received, consumedFraction);
    const rawRemaining = subtractProfiles(received, rawConsumed);
    const appliedHere = scaleProfile(effective, consumedFraction);
    const resisted = subtractProfiles(rawConsumed, appliedHere);
    const appliedTotal = Math.min(before, totalProfile(appliedHere));
    const after = round(Math.max(0, before - appliedTotal));

    for (const type of DAMAGE_TYPES) {
      applied[type] = round(applied[type] + appliedHere[type]);
    }
    results.push({
      layer: input.layer,
      beforeHitPoints: before,
      afterHitPoints: after,
      rawReceived: received,
      rawConsumed,
      rawRemaining,
      appliedDamage: appliedHere,
      resistedDamage: resisted,
      appliedTotal,
    });
    remaining = rawRemaining;
  }

  const hull = [...results].reverse().find((result) => result.layer === 'hull');
  return {
    rawDamage: raw,
    layers: results,
    remainingRawDamage: remaining,
    appliedDamage: applied,
    appliedTotal: totalProfile(applied),
    destroyed: hull !== undefined && hull.afterHitPoints <= 0,
  };
}

export interface RepairResult {
  readonly beforeDamage: number;
  readonly afterDamage: number;
  readonly repairedHitPoints: number;
}

/** Repairs damage already recorded on one layer, never beyond full. */
export function applyRepair(damage: number, amount: number): RepairResult {
  const beforeDamage = nonNegative(damage);
  const repairedHitPoints = Math.min(beforeDamage, nonNegative(amount));
  return {
    beforeDamage,
    afterDamage: round(beforeDamage - repairedHitPoints),
    repairedHitPoints: round(repairedHitPoints),
  };
}

export interface RegenerationResult {
  readonly before: number;
  readonly after: number;
  readonly regenerated: number;
  readonly ratePerSecond: number;
}

/** Linear regeneration specified by Functional Specification 9.7-9.8. */
export function regeneratePool(
  current: number,
  maximum: number,
  rechargeSeconds: number,
  elapsedMs: number,
): RegenerationResult {
  const cap = nonNegative(maximum);
  const before = clamp(0, cap, nonNegative(current));
  const duration = nonNegative(rechargeSeconds);
  const ratePerSecond = duration > 0 ? cap / duration : 0;
  const potential = ratePerSecond * (nonNegative(elapsedMs) / 1000);
  const after = round(clamp(0, cap, before + potential));
  return {
    before,
    after,
    regenerated: round(after - before),
    ratePerSecond,
  };
}

export interface CapacitorPaymentResult {
  readonly paid: boolean;
  readonly before: number;
  readonly after: number;
  readonly committed: number;
}

/** A cycle either pays its complete non-negative cost or pays nothing. */
export function payCapacitor(current: number, cost: number): CapacitorPaymentResult {
  const before = nonNegative(current);
  const required = nonNegative(cost);
  if (before + 1e-9 < required) {
    return { paid: false, before, after: before, committed: 0 };
  }
  return {
    paid: true,
    before,
    after: round(Math.max(0, before - required)),
    committed: required,
  };
}

export function totalProfile(profile: DamageProfile): number {
  return DAMAGE_TYPES.reduce((total, type) => total + profile[type], 0);
}

export function addProfiles(left: DamageProfile, right: DamageProfile): DamageProfile {
  return mapProfile(left, (value, type) => round(value + right[type]));
}

function sanitizeProfile(profile: DamageProfile): DamageProfile {
  return mapProfile(profile, (value) => nonNegative(value));
}

function copyProfile(profile: DamageProfile): DamageProfile {
  return mapProfile(profile, (value) => value);
}

function mapProfile(
  profile: DamageProfile,
  map: (value: number, type: DamageType) => number,
): DamageProfile {
  const result = emptyDamageProfile();
  for (const type of DAMAGE_TYPES) result[type] = round(map(profile[type], type));
  return result;
}

function scaleProfile(profile: DamageProfile, multiplier: number): DamageProfile {
  return mapProfile(profile, (value) => value * multiplier);
}

function subtractProfiles(left: DamageProfile, right: DamageProfile): DamageProfile {
  return mapProfile(left, (value, type) => Math.max(0, value - right[type]));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nonNegative(value: number): number {
  return Math.max(0, finiteOrZero(value));
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
