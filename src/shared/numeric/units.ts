/**
 * Canonical units (Technical Specification 5.2).
 *
 * The engine works in one representation per quantity. Authored content and
 * the interface may use a friendlier unit — the functional specification
 * measures cargo in cubic metres and durations in seconds — and it is
 * converted once, at the boundary, by the functions here.
 *
 * The brands are type-level only; at runtime every value is an ordinary
 * number.
 *
 * @implements TECH-5.2
 */
import { isCount, isFiniteNumber, isNonNegativeNumber } from './guards.ts';

declare const unitBrand: unique symbol;

type Unit<TUnit extends string> = number & { readonly [unitBrand]: TUnit };

/** Simulation time and duration: integer milliseconds. */
export type Milliseconds = Unit<'ms'>;
/** Distance: kilometres as a double. */
export type Kilometres = Unit<'km'>;
/** Velocity: kilometres per simulation second as a double. */
export type KilometresPerSecond = Unit<'km/s'>;
/** Angles: radians as a double. */
export type Radians = Unit<'rad'>;
/** Angular velocity: radians per simulation second as a double. */
export type RadiansPerSecond = Unit<'rad/s'>;
/** Cargo volume: integer cubic-decimetre units. */
export type CubicDecimetres = Unit<'dm3'>;
/** Currency: non-negative whole credits. */
export type Credits = Unit<'credits'>;
/** Item quantities: non-negative whole units. */
export type Quantity = Unit<'quantity'>;
/** Hit points and capacitor: finite non-negative doubles. */
export type HitPoints = Unit<'hp'>;

const MILLISECONDS_PER_SECOND = 1000;
const CUBIC_DECIMETRES_PER_CUBIC_METRE = 1000;

/**
 * Tolerance for authored-to-canonical conversions. A cubic-metre
 * literal such as `0.045` cannot be represented exactly in binary floating
 * point, so the product is accepted when it is this close to a whole
 * cubic-decimetre unit and rejected otherwise.
 */
const CONVERSION_TOLERANCE = 1e-6;

export function milliseconds(value: number): Milliseconds {
  return brandInteger(value, 'milliseconds') as Milliseconds;
}

export function kilometres(value: number): Kilometres {
  return brandFinite(value, 'kilometres') as Kilometres;
}

export function kilometresPerSecond(value: number): KilometresPerSecond {
  return brandFinite(value, 'kilometres per second') as KilometresPerSecond;
}

export function radians(value: number): Radians {
  return brandFinite(value, 'radians') as Radians;
}

export function radiansPerSecond(value: number): RadiansPerSecond {
  return brandFinite(value, 'radians per second') as RadiansPerSecond;
}

export function cubicDecimetres(value: number): CubicDecimetres {
  return brandInteger(value, 'cubic decimetres') as CubicDecimetres;
}

export function credits(value: number): Credits {
  return brandInteger(value, 'credits') as Credits;
}

export function quantity(value: number): Quantity {
  return brandInteger(value, 'quantity') as Quantity;
}

export function hitPoints(value: number): HitPoints {
  if (!isNonNegativeNumber(value)) {
    throw new RangeError(`Expected non-negative finite hit points, received ${String(value)}.`);
  }
  return value as HitPoints;
}

/** Authored seconds to canonical milliseconds. Fails on a fractional result. */
export function secondsToMilliseconds(seconds: number): Milliseconds {
  if (!isFiniteNumber(seconds)) {
    throw new RangeError(`Expected a finite number of seconds, received ${String(seconds)}.`);
  }
  const exact = seconds * MILLISECONDS_PER_SECOND;
  const whole = Math.round(exact);
  if (Math.abs(exact - whole) > CONVERSION_TOLERANCE) {
    throw new RangeError(`${String(seconds)} s is not a whole number of milliseconds.`);
  }
  return milliseconds(whole);
}

/**
 * Authored cubic metres to canonical cubic-decimetre units. Content that
 * cannot be expressed in whole units is rejected rather than silently
 * rounded, so two stacks of the same item always occupy the same volume.
 */
export function cubicMetresToCubicDecimetres(cubicMetres: number): CubicDecimetres {
  if (!isNonNegativeNumber(cubicMetres)) {
    throw new RangeError(
      `Expected a non-negative volume in cubic metres, received ${String(cubicMetres)}.`,
    );
  }
  const exact = cubicMetres * CUBIC_DECIMETRES_PER_CUBIC_METRE;
  const whole = Math.round(exact);
  if (Math.abs(exact - whole) > CONVERSION_TOLERANCE) {
    throw new RangeError(
      `${String(cubicMetres)} m³ is not a whole number of cubic-decimetre units.`,
    );
  }
  return cubicDecimetres(whole);
}

/** True when the volume converts to whole canonical units. */
export function isConvertibleVolume(cubicMetres: unknown): cubicMetres is number {
  if (!isNonNegativeNumber(cubicMetres)) {
    return false;
  }
  const exact = cubicMetres * CUBIC_DECIMETRES_PER_CUBIC_METRE;
  return Math.abs(exact - Math.round(exact)) <= CONVERSION_TOLERANCE;
}

function brandFinite(value: number, unit: string): number {
  if (!isFiniteNumber(value)) {
    throw new RangeError(`Expected a finite value in ${unit}, received ${String(value)}.`);
  }
  return value;
}

function brandInteger(value: number, unit: string): number {
  if (!isCount(value)) {
    throw new RangeError(
      `Expected a whole, non-negative value in ${unit}, received ${String(value)}.`,
    );
  }
  return value;
}
