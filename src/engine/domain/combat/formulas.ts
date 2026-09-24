import { DAMAGE_TYPES, type CombatRules, type DamageProfile, type DamageType } from '@engine/ports';
import { clamp } from '@shared';

import type { FormulaTrace } from '../formula';
import {
  angularVelocity,
  magnitude,
  radialSpeed,
  subtract,
  transverseVelocity,
} from '../navigation/geometry';
import type { Vector2 } from '../navigation/types';

/**
 * The combat formulas of Functional Specification 9.2-9.5, as pure functions.
 *
 * Each one takes plain numbers, returns plain numbers and reaches nothing: no
 * campaign state, no content lookup, no random draw. That is what lets a
 * fixture pin an authoritative example, and what lets a future Java engine be
 * held to the same values.
 *
 * Each result carries the trace that produced it, because the interface has to
 * explain a hit chance rather than assert one
 * (Functional Specification 19.3, 19.6).
 *
 * @implements FUNC-9.2, FUNC-9.3, FUNC-9.5, TECH-10.3
 */

export interface LockTimeInput {
  /** The attacker's current modified scan resolution. */
  readonly scanResolution: number;
  /** The target's current modified signature radius, in metres. */
  readonly targetSignatureMetres: number;
}

export interface LockTimeResult {
  readonly seconds: number;
  /** True when a bound of Functional Specification 9.2 changed the result. */
  readonly clamped: boolean;
  readonly trace: FormulaTrace;
}

/**
 * clamp(0.75, 20, 4 x sqrt(100 / scan resolution) x sqrt(40 / signature)).
 *
 * A non-positive scan resolution or signature has no meaningful root, so it
 * produces the slowest permitted lock rather than a non-finite number.
 */
export function lockTime(input: LockTimeInput, rules: CombatRules): LockTimeResult {
  const scan = input.scanResolution;
  const signature = input.targetSignatureMetres;
  const raw =
    scan > 0 && signature > 0
      ? rules.lockTimeCoefficient *
        Math.sqrt(rules.lockReferenceScanResolution / scan) *
        Math.sqrt(rules.lockReferenceSignatureMetres / signature)
      : rules.lockTimeMaximumSeconds;
  const seconds = clamp(rules.lockTimeMinimumSeconds, rules.lockTimeMaximumSeconds, raw);

  return {
    seconds,
    clamped: seconds !== raw,
    trace: {
      formulaKey: 'combat.formula.lockTime',
      operands: [
        { key: 'scanResolution', value: scan },
        { key: 'signatureRadiusMetres', value: signature },
        { key: 'referenceScanResolution', value: rules.lockReferenceScanResolution },
        { key: 'referenceSignatureMetres', value: rules.lockReferenceSignatureMetres },
        { key: 'coefficient', value: rules.lockTimeCoefficient },
        { key: 'unclampedSeconds', value: raw },
      ],
      unroundedResult: seconds,
      displayResult: Math.round(seconds * 10) / 10,
    },
  };
}

export interface MotionSubject {
  readonly position: Vector2;
  readonly velocity: Vector2;
}

export interface RelativeMotion {
  readonly rangeKm: number;
  /** Positive while the range is shrinking, negative while it grows. */
  readonly closingSpeedKmPerSecond: number;
  readonly transverseVelocityKmPerSecond: number;
  readonly angularVelocityRadiansPerSecond: number;
}

/**
 * Range, closing speed, transverse velocity and angular velocity between two
 * objects (Functional Specification 9.3).
 */
export function relativeMotion(attacker: MotionSubject, target: MotionSubject): RelativeMotion {
  const relativePosition = subtract(target.position, attacker.position);
  const relativeVelocity = subtract(target.velocity, attacker.velocity);

  return {
    rangeKm: magnitude(relativePosition),
    closingSpeedKmPerSecond: -radialSpeed(relativePosition, relativeVelocity),
    transverseVelocityKmPerSecond: transverseVelocity(relativePosition, relativeVelocity),
    angularVelocityRadiansPerSecond: angularVelocity(relativePosition, relativeVelocity),
  };
}

export interface TurretAccuracyInput {
  /** Optimal range after the loaded charge multiplier. */
  readonly optimalRangeKm: number;
  /** Falloff after the loaded charge multiplier. */
  readonly falloffKm: number;
  /** Tracking after the loaded charge multiplier. */
  readonly trackingRadiansPerSecond: number;
  readonly signatureResolutionMetres: number;
  readonly targetSignatureMetres: number;
  readonly rangeKm: number;
  readonly angularVelocityRadiansPerSecond: number;
}

export interface TurretAccuracy {
  readonly trackingStrain: number;
  readonly rangeStrain: number;
  readonly hitChance: number;
  /** optimal + 3 x falloff; beyond it a turret cannot hit at all. */
  readonly absoluteRangeKm: number;
  readonly withinAbsoluteRange: boolean;
  readonly trace: FormulaTrace;
}

/** Functional Specification 9.5 clamps a reachable shot to at least 1%. */
export const MINIMUM_HIT_CHANCE = 0.01;

/**
 * hit chance = 0.5 ^ (tracking strain squared + range strain squared),
 * clamped from 1% through 100% inside absolute range and zero beyond it
 * (Functional Specification 9.5).
 *
 * A turret with no falloff cannot reach past its optimal at all, which is the
 * one case where the exponential is not evaluated.
 */
export function turretAccuracy(input: TurretAccuracyInput, rules: CombatRules): TurretAccuracy {
  const tracking = input.trackingRadiansPerSecond * input.targetSignatureMetres;
  const trackingStrain =
    input.angularVelocityRadiansPerSecond === 0
      ? 0
      : tracking > 0
        ? (input.angularVelocityRadiansPerSecond * input.signatureResolutionMetres) / tracking
        : Number.POSITIVE_INFINITY;

  const beyondOptimal = input.rangeKm > input.optimalRangeKm;
  const rangeStrain =
    !beyondOptimal || input.falloffKm <= 0
      ? 0
      : (input.rangeKm - input.optimalRangeKm) / input.falloffKm;

  const absoluteRangeKm =
    input.optimalRangeKm + rules.absoluteRangeFalloffMultiples * Math.max(0, input.falloffKm);
  const withinAbsoluteRange = input.rangeKm <= absoluteRangeKm;
  const unreachable = (beyondOptimal && input.falloffKm <= 0) || !withinAbsoluteRange;

  const raw = unreachable
    ? 0
    : Math.pow(0.5, trackingStrain * trackingStrain + rangeStrain * rangeStrain);
  const hitChance = unreachable ? 0 : clamp(MINIMUM_HIT_CHANCE, 1, raw);

  return {
    trackingStrain,
    rangeStrain,
    hitChance,
    absoluteRangeKm,
    withinAbsoluteRange,
    trace: {
      formulaKey: 'combat.formula.hitChance',
      operands: [
        { key: 'rangeKm', value: input.rangeKm },
        { key: 'optimalRangeKm', value: input.optimalRangeKm },
        { key: 'falloffKm', value: input.falloffKm },
        { key: 'absoluteRangeKm', value: absoluteRangeKm },
        { key: 'angularVelocityRadiansPerSecond', value: input.angularVelocityRadiansPerSecond },
        { key: 'trackingRadiansPerSecond', value: input.trackingRadiansPerSecond },
        { key: 'signatureResolutionMetres', value: input.signatureResolutionMetres },
        { key: 'targetSignatureMetres', value: input.targetSignatureMetres },
        { key: 'trackingStrain', value: Number.isFinite(trackingStrain) ? trackingStrain : 0 },
        { key: 'rangeStrain', value: rangeStrain },
        { key: 'unclampedHitChance', value: Number.isFinite(raw) ? raw : 0 },
      ],
      unroundedResult: hitChance,
      displayResult: Math.round(hitChance * 1000) / 10,
    },
  };
}

export const TURRET_LIMITING_FACTORS = ['none', 'range', 'tracking'] as const;

export type TurretLimitingFactor = (typeof TURRET_LIMITING_FACTORS)[number];

/**
 * Which half of the turret formula costs the shot the most
 * (Functional Specification 9.5, 19.3).
 *
 * Hit chance falls with the sum of the squared range and tracking strains, so
 * the larger square is the larger loss. A target beyond absolute range is
 * limited by range whatever its motion, because nothing about tracking could
 * make that shot possible. Equal strains name range, the factor a movement
 * order changes most directly. No threshold is involved: a 97% shot still has
 * a main limiting factor, and only a shot that loses nothing to either has
 * none.
 */
export function turretLimitingFactor(accuracy: TurretAccuracy): TurretLimitingFactor {
  if (!accuracy.withinAbsoluteRange) return 'range';
  const range = accuracy.rangeStrain * accuracy.rangeStrain;
  const tracking = Number.isFinite(accuracy.trackingStrain)
    ? accuracy.trackingStrain * accuracy.trackingStrain
    : Number.POSITIVE_INFINITY;
  if (range === 0 && tracking === 0) return 'none';
  return range >= tracking ? 'range' : 'tracking';
}

/**
 * What one hit deals, as a share of listed damage
 * (Functional Specification 9.5).
 *
 * A critical hit replaces the variation rather than multiplying it, so the two
 * are never combined.
 */
export function shotDamageMultiplier(
  variationRoll: number,
  critical: boolean,
  rules: CombatRules,
): number {
  if (critical) {
    return rules.criticalHitMultiplier;
  }
  const span = rules.damageVariationMaximum - rules.damageVariationMinimum;
  return rules.damageVariationMinimum + clamp(0, 1, variationRoll) * span;
}

/** The listed damage of one shot: the charge profile times the turret multiplier. */
export function listedDamage(
  profile: DamageProfile | undefined,
  damageMultiplier: number,
): DamageProfile {
  const listed = {} as Record<DamageType, number>;
  for (const damageType of DAMAGE_TYPES) {
    listed[damageType] = (profile?.[damageType] ?? 0) * damageMultiplier;
  }
  return listed;
}

/** Scales a damage profile by one multiplier, keeping the four components. */
export function scaleDamage(profile: DamageProfile, multiplier: number): DamageProfile {
  const scaled = {} as Record<DamageType, number>;
  for (const damageType of DAMAGE_TYPES) {
    scaled[damageType] = profile[damageType] * multiplier;
  }
  return scaled;
}

export function totalDamage(profile: DamageProfile): number {
  return DAMAGE_TYPES.reduce((total, damageType) => total + profile[damageType], 0);
}
