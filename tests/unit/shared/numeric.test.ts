import { describe, expect, it } from 'vitest';

import {
  ceilToInteger,
  clamp,
  clampFraction,
  clampResistance,
  credits,
  cubicMetresToCubicDecimetres,
  floorToInteger,
  isConvertibleVolume,
  isCount,
  isFiniteNumber,
  isInRange,
  isSafeInteger,
  quantity,
  RESISTANCE_MAXIMUM,
  roundToInteger,
  secondsToMilliseconds,
} from '@shared';

/**
 * The canonical representations of Technical Specification 5.2 and the shared
 * clamping and rounding rules of Functional Specification 4.1-4.2. Every
 * arithmetic input must be finite, and a value that cannot be expressed in its
 * canonical unit is rejected at the boundary rather than rounded silently.
 */
describe('numeric guards', () => {
  it.each([
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [Number.NEGATIVE_INFINITY, false],
    [0, true],
    [-1.5, true],
  ])('treats %s as finite: %s [TECH-5.2]', (value, expected) => {
    expect(isFiniteNumber(value)).toBe(expected);
  });

  it('accepts only whole, non-negative counts [TECH-5.2]', () => {
    expect(isCount(0)).toBe(true);
    expect(isCount(42)).toBe(true);
    expect(isCount(-1)).toBe(false);
    expect(isCount(1.5)).toBe(false);
    expect(isCount(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
  });

  it('rejects an unsafe integer [TECH-5.2]', () => {
    expect(isSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isSafeInteger(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
  });

  it('checks inclusive ranges [TECH-5.2]', () => {
    expect(isInRange(0.1, 0.1, 0.6)).toBe(true);
    expect(isInRange(0.6, 0.1, 0.6)).toBe(true);
    expect(isInRange(0.61, 0.1, 0.6)).toBe(false);
  });

  it('refuses to brand a fractional or negative credit amount [TECH-5.2]', () => {
    expect(credits(2500)).toBe(2500);
    expect(() => credits(-1)).toThrow(RangeError);
    expect(() => credits(0.5)).toThrow(RangeError);
    expect(() => quantity(Number.NaN)).toThrow(RangeError);
  });
});

describe('unit conversion', () => {
  it.each([
    [0, 0],
    [0.002, 2],
    [0.045, 45],
    [0.01, 10],
    [135, 135_000],
  ])('converts %s cubic metres to %s canonical units [TECH-5.2, FUNC-4.1]', (metres, expected) => {
    expect(cubicMetresToCubicDecimetres(metres)).toBe(expected);
  });

  it('rejects a volume that is not a whole canonical unit [TECH-5.2]', () => {
    expect(isConvertibleVolume(0.0025)).toBe(false);
    expect(() => cubicMetresToCubicDecimetres(0.0025)).toThrow(RangeError);
  });

  it('converts whole seconds to milliseconds and rejects the rest [TECH-5.2]', () => {
    expect(secondsToMilliseconds(2.5)).toBe(2500);
    expect(() => secondsToMilliseconds(0.00004)).toThrow(RangeError);
  });
});

describe('clamping', () => {
  it('clamps to the given bounds [FUNC-4.2]', () => {
    expect(clamp(0, 10, -1)).toBe(0);
    expect(clamp(0, 10, 11)).toBe(10);
    expect(clamp(0, 10, 4.5)).toBe(4.5);
  });

  it('refuses a non-finite value and inverted bounds [FUNC-4.2, TECH-5.2]', () => {
    expect(() => clamp(0, 1, Number.NaN)).toThrow(RangeError);
    expect(() => clamp(1, 0, 0.5)).toThrow(RangeError);
  });

  it('clamps probabilities from 0 through 1 [FUNC-4.2]', () => {
    expect(clampFraction(-0.2)).toBe(0);
    expect(clampFraction(1.4)).toBe(1);
    expect(clampFraction(0.37)).toBe(0.37);
  });

  it('clamps resistances from 0% through 90% [FUNC-4.2]', () => {
    expect(RESISTANCE_MAXIMUM).toBe(0.9);
    expect(clampResistance(0.95)).toBe(0.9);
    expect(clampResistance(-0.1)).toBe(0);
    expect(clampResistance(0.62)).toBe(0.62);
  });
});

describe('final-step rounding', () => {
  it('floors whole items and credits [FUNC-4.1]', () => {
    expect(floorToInteger(9.99)).toBe(9);
    expect(floorToInteger(-0.1)).toBe(-1);
  });

  it('ceils where a rule charges the next whole unit [FUNC-4.1]', () => {
    expect(ceilToInteger(9.01)).toBe(10);
    expect(ceilToInteger(10)).toBe(10);
  });

  it('rounds a tie away from zero so both signs behave alike [FUNC-4.1]', () => {
    expect(roundToInteger(2.5)).toBe(3);
    expect(roundToInteger(-2.5)).toBe(-3);
    expect(roundToInteger(2.4)).toBe(2);
    expect(roundToInteger(-2.4)).toBe(-2);
  });
});
