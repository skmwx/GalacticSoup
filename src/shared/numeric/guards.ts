/**
 * Canonical numeric guards (Technical Specification 5.2).
 *
 * All arithmetic inputs must be finite. `NaN`, infinities, negative
 * quantities, unsafe integers and invalid vector components are rejected at
 * the content and save boundaries, which is where these predicates are used;
 * the engine may then assume its numbers are legal.
 *
 * @implements TECH-5.2
 */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

export function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** A whole number inside the exactly representable integer range. */
export function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Credits, item quantities and other counts: whole and never negative. */
export function isCount(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

export function isPositiveCount(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}

/** Within `[minimum, maximum]`, inclusive. */
export function isInRange(value: unknown, minimum: number, maximum: number): value is number {
  return isFiniteNumber(value) && value >= minimum && value <= maximum;
}

export function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return isSafeInteger(value) && value >= minimum && value <= maximum;
}
