import type { DamageType, DefenseLayer } from '@engine/ports';
import type { MessageKey } from '@shared';

/**
 * Attribute modifiers and the reviewed operator registry
 * (Functional Specification 4.4; Technical Specification 10.2).
 *
 * A modifier declares what it changes, how, by how much, at which stage, under
 * which condition and where it came from. Content never carries an expression:
 * the three operators below are the only arithmetic a modifier can ask for, so
 * a future engine in another language implements the same closed set.
 *
 * @implements FUNC-4.4, TECH-10.2
 */

/** Ship attributes the MVP derives. Each is a tunable hull value. */
export const SHIP_ATTRIBUTES = [
  'accelerationKmPerSecondSquared',
  'armorHitPoints',
  'brakingKmPerSecondSquared',
  'capacitorCapacity',
  'capacitorRechargeSeconds',
  'cargoCapacityCubicDecimetres',
  'hullHitPoints',
  'maxLockRangeKm',
  'maxLockedTargets',
  'maxSpeedKmPerSecond',
  'powerOutput',
  'processingOutput',
  'scanResolution',
  'shieldHitPoints',
  'shieldRechargeSeconds',
  'signatureRadiusMetres',
  'turnRateRadiansPerSecond',
  'warpSpeedKmPerSecond',
] as const;

export type ShipAttribute = (typeof SHIP_ATTRIBUTES)[number];

/** A resistance is one attribute per layer and damage type. */
export function resistanceAttribute(layer: DefenseLayer, damageType: DamageType): string {
  return `resistance.${layer}.${damageType}`;
}

/**
 * The stage a modifier is applied in (Technical Specification 10.2, steps 2-5).
 *
 * - `flat` values are added first, before any percentage.
 * - `fitted` percentages come from fitted modules and are diminished together
 *   by direction, which is the rule content cannot opt out of.
 * - `intrinsic` percentages come from hull traits, skills, ammunition,
 *   temporary effects and a module's effect on its own operation. They are
 *   never diminished unless their own description says they are.
 */
export const MODIFIER_STAGES = ['flat', 'fitted', 'intrinsic'] as const;

export type ModifierStage = (typeof MODIFIER_STAGES)[number];

/**
 * The reviewed operator registry. No other arithmetic may reach an attribute.
 *
 * - `add` adds a flat amount in the attribute's own unit.
 * - `percent` multiplies by `1 + value`, so `+0.75` is a 75% bonus.
 * - `resistance` combines a resistance the way layered mitigation composes: a
 *   bonus removes its share of the damage that still gets through, and a
 *   penalty scales the resistance down. Both stay inside the clamp of
 *   Functional Specification 4.2 without a special case.
 */
export const MODIFIER_OPERATIONS = ['add', 'percent', 'resistance'] as const;

export type ModifierOperation = (typeof MODIFIER_OPERATIONS)[number];

export interface AttributeModifier {
  readonly attribute: string;
  readonly operation: ModifierOperation;
  /** Magnitude in the operator's own terms; the sign decides its direction. */
  readonly value: number;
  readonly stage: ModifierStage;
  /** Definition id of the source, or `hull` for the hull itself. */
  readonly sourceId: string;
  /** Player-visible label of the source, for the calculation trace. */
  readonly sourceKey: MessageKey;
  /**
   * Named assumption this modifier depends on, such as a propulsion module
   * being active. Absent means it always applies.
   */
  readonly condition?: string;
}

/**
 * Effectiveness of the first through fifth fitted modifier in one direction
 * (Functional Specification 4.4). A sixth and later have no effect.
 */
export const STACKING_MULTIPLIERS: readonly number[] = [1, 0.87, 0.57, 0.28, 0.1];

export function stackingMultiplier(position: number): number {
  return STACKING_MULTIPLIERS[position] ?? 0;
}

export function applyOperation(
  operation: ModifierOperation,
  value: number,
  magnitude: number,
): number {
  switch (operation) {
    case 'add':
      return value + magnitude;
    case 'percent':
      return value * (1 + magnitude);
    case 'resistance':
      return magnitude >= 0 ? 1 - (1 - value) * (1 - magnitude) : value * (1 + magnitude);
    default:
      return unreachable(operation);
  }
}

function unreachable(operation: never): never {
  throw new TypeError(`Unknown modifier operation: ${String(operation)}.`);
}
