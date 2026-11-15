import { describe, expect, it } from 'vitest';

import { guidedApplication, guidedFlightSeconds, guidedLimitingFactor } from '@engine/domain';

import { shippedContent } from '../../support/content.ts';

/**
 * The guided damage multiplier (Functional Specification 9.6), as exact
 * examples and boundaries:
 *
 *   signature factor = min(1, S / E)
 *   speed factor     = min(1, (V / max(Q, 0.1)) x sqrt(S / E))
 *   multiplier       = max(0.1, min(signature factor, speed factor))
 */

const rules = shippedContent().rules.combat;
const apply = (E: number, V: number, S: number, Q: number) => guidedApplication({
  explosionRadiusMetres: E,
  explosionVelocityKmPerSecond: V,
  targetSignatureMetres: S,
  targetSpeedKmPerSecond: Q,
}, rules);

describe('the guided application formula', () => {
  it('applies fully to a large, slow target [FUNC-9.6, V02-AC-06]', () => {
    const result = apply(40, 0.2, 120, 0.05);
    expect(result.signatureFactor).toBe(1);
    expect(result.speedFactor).toBe(1);
    expect(result.damageMultiplier).toBe(1);
    expect(result.limitingFactor).toBe('none');
  });

  it('is limited by signature against a small stationary target [FUNC-9.6, V02-AC-06]', () => {
    const result = apply(120, 0.12, 40, 0);
    expect(result.signatureFactor).toBeCloseTo(40 / 120, 12);
    // Speed is floored at 0.1 km/s: (0.12 / 0.1) x sqrt(1/3).
    expect(result.speedFactor).toBeCloseTo(Math.min(1, 1.2 * Math.sqrt(1 / 3)), 12);
    expect(result.damageMultiplier).toBeCloseTo(1 / 3, 12);
    expect(result.limitingFactor).toBe('signature');
  });

  it('is limited by speed against a fast target [FUNC-9.6, V02-AC-06]', () => {
    const result = apply(40, 0.2, 40, 0.5);
    expect(result.signatureFactor).toBe(1);
    expect(result.speedFactor).toBeCloseTo(0.4, 12);
    expect(result.damageMultiplier).toBeCloseTo(0.4, 12);
    expect(result.limitingFactor).toBe('speed');
  });

  it('never falls below the 10% floor [FUNC-9.6, V02-AC-06]', () => {
    const result = apply(400, 0.01, 10, 2);
    expect(result.damageMultiplier).toBe(0.1);
    expect(result.floored).toBe(true);
  });

  it('divides by at least 0.1 km/s, so a stopped target is no easier than a crawling one [FUNC-9.6]', () => {
    expect(apply(40, 0.05, 40, 0).speedFactor).toBeCloseTo(apply(40, 0.05, 40, 0.1).speedFactor, 12);
    expect(apply(40, 0.05, 40, 0).speedFactor).toBeCloseTo(0.5, 12);
  });

  it('treats a degenerate explosion radius as a full application rather than a division by zero [FUNC-9.6]', () => {
    const result = apply(0, 0.2, 40, 0.3);
    expect(result.damageMultiplier).toBe(1);
    expect(Number.isFinite(result.trace.unroundedResult)).toBe(true);
  });

  it('names signature on a tie and carries every operand in its trace [FUNC-9.6, FUNC-19.6]', () => {
    expect(guidedLimitingFactor(0.5, 0.5)).toBe('signature');
    const trace = apply(40, 0.2, 38, 0.3).trace;
    expect(trace.formulaKey).toBe('combat.formula.guidedApplication');
    expect(trace.operands.map((operand) => operand.key)).toEqual([
      'targetSignatureMetres', 'explosionRadiusMetres', 'targetSpeedKmPerSecond',
      'explosionVelocityKmPerSecond', 'signatureFactor', 'speedFactor', 'minimumMultiplier',
    ]);
  });

  it('estimates flight against a stationary target, including zero distance [FUNC-9.6]', () => {
    expect(guidedFlightSeconds(5, 2.5)).toBe(2);
    expect(guidedFlightSeconds(0, 2.5)).toBe(0);
    expect(guidedFlightSeconds(5, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});
