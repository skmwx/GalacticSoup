/**
 * Shared clamping and final-step rounding (Functional Specification 4.1, 4.2).
 *
 * Bounds are applied after each defined operation rather than after an
 * arbitrary sequence, so every clamp is one named call. Rounding here is the
 * *final step* of a rule; intermediate arithmetic keeps full precision and
 * display rounding belongs to projections and interface formatting.
 *
 * @implements FUNC-4.1, FUNC-4.2
 */

/** Probabilities and other fractions are clamped from 0 through 1. */
export const FRACTION_MINIMUM = 0;
export const FRACTION_MAXIMUM = 1;

/** Resistances are clamped from 0% through 90% (Functional Specification 4.2). */
export const RESISTANCE_MINIMUM = 0;
export const RESISTANCE_MAXIMUM = 0.9;

export function clamp(minimum: number, maximum: number, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot clamp a non-finite value: ${String(value)}.`);
  }
  if (minimum > maximum) {
    throw new RangeError(`Clamp bounds are inverted: [${String(minimum)}, ${String(maximum)}].`);
  }
  if (value < minimum) {
    return minimum;
  }
  return value > maximum ? maximum : value;
}

export function clampFraction(value: number): number {
  return clamp(FRACTION_MINIMUM, FRACTION_MAXIMUM, value);
}

export function clampResistance(value: number): number {
  return clamp(RESISTANCE_MINIMUM, RESISTANCE_MAXIMUM, value);
}

/** Whole items and credits are produced by flooring at the final step. */
export function floorToInteger(value: number): number {
  return Math.floor(finite(value));
}

export function ceilToInteger(value: number): number {
  return Math.ceil(finite(value));
}

/**
 * Nearest whole number, resolving a tie away from zero. `Math.round` resolves
 * a tie towards positive infinity, which is not symmetric for negative values
 * and would make a rule behave differently on each side of zero.
 */
export function roundToInteger(value: number): number {
  const magnitude = Math.floor(Math.abs(finite(value)) + 0.5);
  return value < 0 ? -magnitude : magnitude;
}

function finite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Expected a finite number, received ${String(value)}.`);
  }
  return value;
}
