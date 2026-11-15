import { describe, expect, it } from 'vitest';

import {
  assessFit,
  attributeValue,
  deriveShipAttributes,
  OPERATOR_REGISTRY,
  weaponProfile,
  type FitDescription,
  type FittedSlotDescription,
} from '@engine/domain';
import { MODIFIER_OPERATORS } from '@engine';
import type { AmmunitionId, HullId, ModuleId } from '@shared';


import { OPERATOR_CATEGORIES } from '../../../scripts/lib/content/semantic.mjs';
import { shippedContent } from '../../support/content.ts';

/**
 * Passive modifier operators, weapon-scoped multipliers and module sizes
 * (Functional Specification 4.4, 8.4, 9.7; Technical Specification 10.2;
 * FeatureSpec02 5.1-5.2).
 */

const content = shippedContent();
const FRIGATE = content.requireHull('hull.independent.starter' as HullId);
const CRUISER = content.requireHull('hull.independent.cruiser' as HullId);

function slot(kind: 'weapon' | 'system' | 'engineering', index: number, moduleId: string, online = true, ammunitionId?: string): FittedSlotDescription {
  return {
    slot: { kind, index },
    moduleId: moduleId as ModuleId,
    online,
    stackId: null,
    charge: ammunitionId === undefined ? null : { ammunitionId: ammunitionId as AmmunitionId, quantity: 1, stackId: null },
  };
}

const derive = (fit: FitDescription, hull = FRIGATE) => deriveShipAttributes({ hull, fit, content });

describe('the operator registry', () => {
  it('matches the categories content validation allows, operator for operator [TECH-6.2, TECH-10.2, V02-AC-05]', () => {
    const engine = Object.fromEntries(MODIFIER_OPERATORS.map((operator) => [operator, [...OPERATOR_REGISTRY[operator].categories]]));
    expect(engine).toEqual(OPERATOR_CATEGORIES);
  });
});

describe('passive defence and capacitor operators', () => {
  it('adds shield hit points flat and enlarges the signature as a fitted penalty [FUNC-9.7, FUNC-4.4, V02-AC-05]', () => {
    const derived = derive([slot('engineering', 0, 'module.shield.extender')]);
    expect(attributeValue(derived, 'shieldHitPoints')).toBe(FRIGATE.defenses.shield.hitPoints + 150);
    expect(attributeValue(derived, 'signatureRadiusMetres')).toBeCloseTo(FRIGATE.signatureRadiusMetres * 1.08, 12);
    const steps = derived.attributes['shieldHitPoints']?.steps ?? [];
    expect(steps.map((step) => [step.sourceId, step.stage, step.operation])).toEqual([
      ['module.shield.extender', 'flat', 'add'],
    ]);
  });

  it('contributes nothing while offline [FUNC-8.4, FUNC-9.7, V02-AC-05]', () => {
    const derived = derive([slot('engineering', 0, 'module.shield.extender', false)]);
    expect(attributeValue(derived, 'shieldHitPoints')).toBe(FRIGATE.defenses.shield.hitPoints);
    expect(derived.modifiers).toEqual([]);
  });

  it('diminishes a second recharge module of the same direction [FUNC-4.4, FUNC-9.7, V02-AC-05]', () => {
    const derived = derive([
      slot('engineering', 0, 'module.shield.recharger'),
      slot('engineering', 1, 'module.shield.recharger'),
    ]);
    const expected = FRIGATE.shieldRechargeSeconds * (1 - 0.3) * (1 - 0.3 * 0.87);
    expect(attributeValue(derived, 'shieldRechargeSeconds')).toBeCloseTo(expected, 9);
    expect(derived.attributes['shieldRechargeSeconds']?.steps.map((step) => step.stackingMultiplier)).toEqual([1, 0.87]);
  });

  it('stacks a capacitor recharger with a battery recharge bonus by direction, not by group [FUNC-4.4, TECH-10.2, V02-AC-05]', () => {
    const derived = derive([
      slot('engineering', 0, 'module.capacitor.recharger'),
      slot('engineering', 1, 'module.capacitor.battery.small'),
    ]);
    expect(attributeValue(derived, 'capacitorRechargeSeconds')).toBeCloseTo(FRIGATE.capacitor.rechargeSeconds * 0.8, 9);
    expect(attributeValue(derived, 'capacitorCapacity')).toBe(FRIGATE.capacitor.capacity + 120);
  });
});

describe('weapon-scoped operators', () => {
  const rules = content.rules.combat;
  const autocannon = content.requireModule('module.turret.autocannon.small' as ModuleId);
  const railgun = content.requireModule('module.turret.railgun.small' as ModuleId);
  const launcher = content.requireModule('module.launcher.guided.small' as ModuleId);
  const fusion = content.requireAmmunition('ammo.projectile.small.fusion' as AmmunitionId);
  const iron = content.requireAmmunition('ammo.hybrid.small.iron' as AmmunitionId);
  const kinetic = content.requireAmmunition('ammo.guided.small.kinetic' as AmmunitionId);
  const total = (profile: { damagePerShot: Record<string, number> }) =>
    Object.values(profile.damagePerShot).reduce((sum, value) => sum + value, 0);
  if (autocannon.category !== 'turret' || railgun.category !== 'turret' || launcher.category !== 'launcher') {
    throw new Error('Unexpected catalog.');
  }

  it('raises only its own family\'s turret damage [FUNC-8.5, TECH-10.2, V02-AC-05]', () => {
    const plain = derive([]);
    const enhanced = derive([slot('engineering', 0, 'module.upgrade.damage.projectile')]);
    expect(total(weaponProfile(autocannon, fusion, enhanced, rules)))
      .toBeCloseTo(total(weaponProfile(autocannon, fusion, plain, rules)) * 1.1, 9);
    expect(total(weaponProfile(railgun, iron, enhanced, rules)))
      .toBeCloseTo(total(weaponProfile(railgun, iron, plain, rules)), 12);
    expect(total(weaponProfile(launcher, kinetic, enhanced, rules)))
      .toBeCloseTo(total(weaponProfile(launcher, kinetic, plain, rules)), 12);
  });

  it('improves turret tracking but not guided application, and guided application but not tracking [FUNC-9.5, FUNC-9.6, V02-AC-05]', () => {
    const tracking = derive([slot('engineering', 0, 'module.upgrade.tracking')]);
    const guided = derive([slot('engineering', 0, 'module.upgrade.guided')]);
    const plain = derive([]);
    const turretPlain = weaponProfile(autocannon, fusion, plain, rules);
    const turretTracked = weaponProfile(autocannon, fusion, tracking, rules);
    if (turretPlain.kind !== 'turret' || turretTracked.kind !== 'turret') throw new Error('Expected turrets.');
    expect(turretTracked.trackingRadiansPerSecond).toBeCloseTo(turretPlain.trackingRadiansPerSecond * 1.15, 12);
    expect(weaponProfile(autocannon, fusion, guided, rules)).toEqual(turretPlain);

    const launcherPlain = weaponProfile(launcher, kinetic, plain, rules);
    const launcherGuided = weaponProfile(launcher, kinetic, guided, rules);
    if (launcherPlain.kind !== 'guided' || launcherGuided.kind !== 'guided') throw new Error('Expected guided.');
    expect(launcherGuided.explosionRadiusMetres).toBeCloseTo(40 * 0.9, 12);
    expect(launcherGuided.explosionVelocityKmPerSecond).toBeCloseTo(0.2 * 1.1, 12);
    expect(weaponProfile(launcher, kinetic, tracking, rules)).toEqual(launcherPlain);
    // Situational application is not extra listed damage (FeatureSpec02 5.2).
    expect(total(launcherGuided)).toBeCloseTo(total(launcherPlain), 12);
  });

  it('reads a launcher\'s flight from its charge and treats an incompatible charge as none [FUNC-9.6, V02-AC-06]', () => {
    const profile = weaponProfile(launcher, kinetic, null, rules);
    expect(profile).toMatchObject({ kind: 'guided', flightSpeedKmPerSecond: 2.5, flightTimeSeconds: 6, maximumFlightDistanceKm: 15 });
    expect(total(weaponProfile(launcher, fusion, null, rules))).toBe(0);
    expect(total(weaponProfile(autocannon, kinetic, null, rules))).toBe(0);
  });
});

describe('module sizes', () => {
  const medium = slot('weapon', 0, 'module.turret.railgun.medium');

  it('refuses a medium module on a hull that accepts only small ones, whatever power remains [FUNC-8.4, V02-AC-05]', () => {
    const fit = [medium];
    const assessment = assessFit({ hull: FRIGATE, fit, content, derived: derive(fit) });
    expect(assessment.violations.map((violation) => violation.code)).toContain('sizeNotAccepted');
    expect(assessment.violations.find((violation) => violation.code === 'sizeNotAccepted')?.params)
      .toEqual({ moduleId: 'module.turret.railgun.medium', size: 'medium', accepted: 'small' });
  });

  it('lets the cruiser fit medium and small weapons alike, each performing as itself [FUNC-8.4, V02-AC-05]', () => {
    const fit = [medium, slot('weapon', 1, 'module.turret.autocannon.small', true, 'ammo.projectile.small.fusion')];
    const assessment = assessFit({ hull: CRUISER, fit, content, derived: derive(fit, CRUISER) });
    expect(assessment.violations.filter((violation) => violation.code === 'sizeNotAccepted')).toEqual([]);
    const autocannon = content.requireModule('module.turret.autocannon.small' as ModuleId);
    const fusion = content.requireAmmunition('ammo.projectile.small.fusion' as AmmunitionId);
    if (autocannon.category !== 'turret') throw new Error('Expected a turret.');
    expect(weaponProfile(autocannon, fusion, derive([], CRUISER), content.rules.combat))
      .toEqual(weaponProfile(autocannon, fusion, derive([], FRIGATE), content.rules.combat));
  });

  it('fits a non-sized support module on any hull whose sizes it suits [FUNC-8.4, V02-AC-05]', () => {
    for (const hull of [FRIGATE, CRUISER]) {
      const fit = [slot('engineering', 0, 'module.upgrade.tracking')];
      const assessment = assessFit({ hull, fit, content, derived: derive(fit, hull) });
      expect(assessment.violations).toEqual([]);
    }
  });
});
