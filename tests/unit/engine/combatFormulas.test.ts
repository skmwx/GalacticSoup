import { describe, expect, it } from 'vitest';

import {
  listedDamage,
  lockTime,
  MINIMUM_HIT_CHANCE,
  relativeMotion,
  scaleDamage,
  shotDamageMultiplier,
  totalDamage,
  turretAccuracy,
  turretLimitingFactor,
} from '@engine/domain';

import { shippedContent } from '../../support/content.ts';

/**
 * The combat formulas of Functional Specification 9.2-9.5, held to the
 * authoritative expressions and to their boundaries. Every case is written
 * from the specification rather than from the implementation, so a formula
 * change has to be a deliberate one.
 */

const rules = shippedContent().rules.combat;

describe('lock time', () => {
  it('follows the authoritative expression [FUNC-9.2]', () => {
    // 4 x sqrt(100 / 400) x sqrt(40 / 40) = 2 seconds.
    expect(lockTime({ scanResolution: 400, targetSignatureMetres: 40 }, rules).seconds).toBeCloseTo(2, 12);
    // A larger signature locks faster; a coarser scanner locks slower.
    expect(lockTime({ scanResolution: 400, targetSignatureMetres: 160 }, rules).seconds).toBeCloseTo(1, 12);
    expect(lockTime({ scanResolution: 100, targetSignatureMetres: 40 }, rules).seconds).toBeCloseTo(4, 12);
  });

  it('clamps to the specified bounds at both ends [FUNC-9.2, FUNC-4.2]', () => {
    const fast = lockTime({ scanResolution: 100_000, targetSignatureMetres: 4000 }, rules);
    const slow = lockTime({ scanResolution: 1, targetSignatureMetres: 1 }, rules);

    expect(fast.seconds).toBe(rules.lockTimeMinimumSeconds);
    expect(fast.clamped).toBe(true);
    expect(slow.seconds).toBe(rules.lockTimeMaximumSeconds);
    expect(slow.clamped).toBe(true);
  });

  it('carries the operands that produced it [FUNC-4.4, FUNC-19.6]', () => {
    const trace = lockTime({ scanResolution: 400, targetSignatureMetres: 40 }, rules).trace;
    const operands = Object.fromEntries(trace.operands.map((operand) => [operand.key, operand.value]));

    expect(trace.formulaKey).toBe('combat.formula.lockTime');
    expect(operands['scanResolution']).toBe(400);
    expect(operands['signatureRadiusMetres']).toBe(40);
    expect(operands['unclampedSeconds']).toBeCloseTo(2, 12);
    expect(trace.unroundedResult).toBeCloseTo(2, 12);
  });

  it('produces the slowest permitted lock rather than a non-finite one [FUNC-9.2]', () => {
    expect(lockTime({ scanResolution: 0, targetSignatureMetres: 40 }, rules).seconds)
      .toBe(rules.lockTimeMaximumSeconds);
    expect(lockTime({ scanResolution: 400, targetSignatureMetres: 0 }, rules).seconds)
      .toBe(rules.lockTimeMaximumSeconds);
  });
});

describe('relative motion', () => {
  const attacker = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };

  it('separates closing speed from transverse velocity [FUNC-9.3]', () => {
    const closing = relativeMotion(attacker, {
      position: { x: 10, y: 0 },
      velocity: { x: -2, y: 0 },
    });

    expect(closing.rangeKm).toBe(10);
    expect(closing.closingSpeedKmPerSecond).toBeCloseTo(2, 12);
    expect(closing.transverseVelocityKmPerSecond).toBeCloseTo(0, 12);
    expect(closing.angularVelocityRadiansPerSecond).toBeCloseTo(0, 12);
  });

  it('reports an opening range as a negative closing speed [FUNC-9.3, FUNC-19.3]', () => {
    const opening = relativeMotion(attacker, {
      position: { x: 10, y: 0 },
      velocity: { x: 3, y: 0 },
    });

    expect(opening.closingSpeedKmPerSecond).toBeCloseTo(-3, 12);
  });

  it('derives angular velocity from the cross product over range squared [FUNC-9.3]', () => {
    const orbiting = relativeMotion(attacker, {
      position: { x: 10, y: 0 },
      velocity: { x: 0, y: 5 },
    });

    expect(orbiting.transverseVelocityKmPerSecond).toBeCloseTo(5, 12);
    // |10 x 5| / 10^2 = 0.5 rad/s.
    expect(orbiting.angularVelocityRadiansPerSecond).toBeCloseTo(0.5, 12);
  });

  it('measures the attacker own motion as part of the relationship [FUNC-9.3]', () => {
    const moving = relativeMotion(
      { position: { x: 0, y: 0 }, velocity: { x: 0, y: 5 } },
      { position: { x: 10, y: 0 }, velocity: { x: 0, y: 5 } },
    );

    expect(moving.angularVelocityRadiansPerSecond).toBeCloseTo(0, 12);
    expect(moving.transverseVelocityKmPerSecond).toBeCloseTo(0, 12);
  });

  it('never divides by zero at exactly zero range [FUNC-9.3, TECH-9.3]', () => {
    const overlapping = relativeMotion(attacker, {
      position: { x: 0, y: 0 },
      velocity: { x: 4, y: 4 },
    });

    expect(overlapping.rangeKm).toBe(0);
    expect(Number.isFinite(overlapping.angularVelocityRadiansPerSecond)).toBe(true);
    expect(overlapping.angularVelocityRadiansPerSecond).toBe(0);
  });
});

describe('turret accuracy', () => {
  const base = {
    optimalRangeKm: 10,
    falloffKm: 5,
    trackingRadiansPerSecond: 0.5,
    signatureResolutionMetres: 40,
    targetSignatureMetres: 40,
    rangeKm: 5,
    angularVelocityRadiansPerSecond: 0,
  };

  it('hits without strain inside optimal against a still target [FUNC-9.5]', () => {
    const accuracy = turretAccuracy(base, rules);

    expect(accuracy.trackingStrain).toBe(0);
    expect(accuracy.rangeStrain).toBe(0);
    expect(accuracy.hitChance).toBe(1);
  });

  it('applies 0.5 ^ (tracking^2 + range^2) [FUNC-9.5]', () => {
    // One falloff past optimal: range strain 1, so 0.5 ^ 1.
    expect(turretAccuracy({ ...base, rangeKm: 15 }, rules).hitChance).toBeCloseTo(0.5, 12);
    // Angular velocity 0.5 against tracking 0.5 and equal signatures: strain 1.
    expect(
      turretAccuracy({ ...base, angularVelocityRadiansPerSecond: 0.5 }, rules).hitChance,
    ).toBeCloseTo(0.5, 12);
    // Both at once: 0.5 ^ 2.
    expect(
      turretAccuracy(
        { ...base, rangeKm: 15, angularVelocityRadiansPerSecond: 0.5 },
        rules,
      ).hitChance,
    ).toBeCloseTo(0.25, 12);
  });

  it('scales tracking strain by signature resolution over target signature [FUNC-9.5]', () => {
    const large = turretAccuracy(
      { ...base, targetSignatureMetres: 80, angularVelocityRadiansPerSecond: 0.5 },
      rules,
    );
    const small = turretAccuracy(
      { ...base, targetSignatureMetres: 20, angularVelocityRadiansPerSecond: 0.5 },
      rules,
    );

    expect(large.trackingStrain).toBeCloseTo(0.5, 12);
    expect(small.trackingStrain).toBeCloseTo(2, 12);
    expect(large.hitChance).toBeGreaterThan(small.hitChance);
  });

  it('clamps a reachable shot to at least one percent [FUNC-9.5, FUNC-4.2]', () => {
    const grazing = turretAccuracy(
      { ...base, rangeKm: base.optimalRangeKm + 3 * base.falloffKm },
      rules,
    );

    expect(grazing.withinAbsoluteRange).toBe(true);
    expect(grazing.hitChance).toBe(MINIMUM_HIT_CHANCE);
  });

  it('cannot hit beyond optimal plus three falloffs [FUNC-9.5]', () => {
    const absolute = base.optimalRangeKm + rules.absoluteRangeFalloffMultiples * base.falloffKm;
    const beyond = turretAccuracy({ ...base, rangeKm: absolute + 0.001 }, rules);

    expect(beyond.absoluteRangeKm).toBe(absolute);
    expect(beyond.withinAbsoluteRange).toBe(false);
    expect(beyond.hitChance).toBe(0);
  });

  it('cannot reach past optimal at all without falloff [FUNC-9.5]', () => {
    expect(turretAccuracy({ ...base, falloffKm: 0, rangeKm: 10 }, rules).hitChance).toBe(1);
    expect(turretAccuracy({ ...base, falloffKm: 0, rangeKm: 10.001 }, rules).hitChance).toBe(0);
  });

  it('carries the contributions of range and tracking separately [FUNC-9.5, FUNC-19.3]', () => {
    const trace = turretAccuracy(
      { ...base, rangeKm: 15, angularVelocityRadiansPerSecond: 0.5 },
      rules,
    ).trace;
    const operands = Object.fromEntries(trace.operands.map((operand) => [operand.key, operand.value]));

    expect(trace.formulaKey).toBe('combat.formula.hitChance');
    expect(operands['rangeStrain']).toBeCloseTo(1, 12);
    expect(operands['trackingStrain']).toBeCloseTo(1, 12);
  });
  it('names the larger squared strain as the main limiting factor [FUNC-19.3]', () => {
    const limit = (input: Partial<typeof base>): string =>
      turretLimitingFactor(turretAccuracy({ ...base, ...input }, rules));

    expect(limit({})).toBe('none');
    expect(limit({ rangeKm: 12 })).toBe('range');
    expect(limit({ angularVelocityRadiansPerSecond: 0.2 })).toBe('tracking');
    // Both strains present: the larger one wins, even at a high hit chance.
    expect(limit({ rangeKm: 11, angularVelocityRadiansPerSecond: 0.05 })).toBe('range');
    expect(limit({ rangeKm: 10.5, angularVelocityRadiansPerSecond: 0.4 })).toBe('tracking');
    // Equal strains name range, the factor a movement order changes directly.
    expect(limit({ rangeKm: 15, angularVelocityRadiansPerSecond: 0.5 })).toBe('range');
  });

  it('blames range for a shot beyond absolute range whatever the motion [FUNC-9.5, FUNC-19.3]', () => {
    const beyond = turretAccuracy(
      { ...base, rangeKm: 40, angularVelocityRadiansPerSecond: 5 },
      rules,
    );
    expect(beyond.withinAbsoluteRange).toBe(false);
    expect(turretLimitingFactor(beyond)).toBe('range');
    expect(
      turretLimitingFactor(turretAccuracy({ ...base, falloffKm: 0, rangeKm: 10.5 }, rules)),
    ).toBe('range');
  });
});

describe('shot damage', () => {
  it('varies a hit between 75 and 125 percent of listed damage [FUNC-9.5]', () => {
    expect(shotDamageMultiplier(0, false, rules)).toBeCloseTo(rules.damageVariationMinimum, 12);
    expect(shotDamageMultiplier(1, false, rules)).toBeCloseTo(rules.damageVariationMaximum, 12);
    expect(shotDamageMultiplier(0.5, false, rules)).toBeCloseTo(1, 12);
  });

  it('replaces the variation on a critical hit rather than multiplying it [FUNC-9.5]', () => {
    expect(shotDamageMultiplier(0, true, rules)).toBe(rules.criticalHitMultiplier);
    expect(shotDamageMultiplier(1, true, rules)).toBe(rules.criticalHitMultiplier);
  });

  it('keeps the four damage components separate through the turret multiplier [FUNC-9.7]', () => {
    const profile = { electromagnetic: 0, thermal: 4, kinetic: 6, explosive: 0 };
    const listed = listedDamage(profile, 1.5);

    expect(listed).toEqual({ electromagnetic: 0, thermal: 6, kinetic: 9, explosive: 0 });
    expect(totalDamage(listed)).toBeCloseTo(15, 12);
    expect(scaleDamage(listed, 0)).toEqual({
      electromagnetic: 0,
      thermal: 0,
      kinetic: 0,
      explosive: 0,
    });
  });
});
