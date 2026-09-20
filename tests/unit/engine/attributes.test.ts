import { describe, expect, it } from 'vitest';

import {
  applyOperation,
  attributeValue,
  deriveShipAttributes,
  evaluateAttribute,
  PROPULSION_ACTIVE,
  resistanceAttribute,
  SHIP_ATTRIBUTES,
  STACKING_MULTIPLIERS,
  type AttributeModifier,
  type FitDescription,
} from '@engine/domain';
import type { ModuleId } from '@shared';

import { shippedContent } from '../../support/content';

/**
 * The derived-attribute pipeline (Functional Specification 4.4; Technical
 * Specification 10.2).
 */

const content = shippedContent();
const hull = content.requireHull('hull.independent.starter' as Parameters<typeof content.requireHull>[0]);

function modifier(overrides: Partial<AttributeModifier> & { readonly value: number }): AttributeModifier {
  return {
    attribute: 'maxSpeedKmPerSecond',
    operation: 'percent',
    stage: 'fitted',
    sourceId: `module.test.${String(Math.abs(overrides.value))}`,
    sourceKey: 'content.test.name',
    ...overrides,
  };
}

function fitted(moduleId: string, index: number, online = true): FitDescription[number] {
  const module = content.requireModule(moduleId as ModuleId);
  return {
    slot: { kind: module.slot, index },
    moduleId: module.id,
    online,
    charge: null,
    stackId: null,
  };
}

describe('attribute pipeline', () => {
  it('adds flat modifiers before percentages [FUNC-4.4, TECH-10.2]', () => {
    const derived = evaluateAttribute({
      attribute: 'capacitorCapacity',
      base: 100,
      modifiers: [
        modifier({ attribute: 'capacitorCapacity', operation: 'percent', value: 0.5, sourceId: 'b' }),
        modifier({ attribute: 'capacitorCapacity', operation: 'add', value: 100, stage: 'flat', sourceId: 'a' }),
      ],
    });

    // 100 + 100 = 200, then x1.5 = 300. The other order would give 250.
    expect(derived.value).toBe(300);
    expect(derived.steps.map((step) => step.operation)).toEqual(['add', 'percent']);
    expect(derived.steps.map((step) => step.result)).toEqual([200, 300]);
  });

  it('diminishes fitted percentages strongest first [FUNC-4.4]', () => {
    const derived = evaluateAttribute({
      attribute: 'maxSpeedKmPerSecond',
      base: 1,
      modifiers: [0.1, 0.5, 0.3, 0.2, 0.4, 0.05].map((value) => modifier({ value })),
    });

    expect(derived.steps.map((step) => step.value)).toEqual([0.5, 0.4, 0.3, 0.2, 0.1, 0.05]);
    expect(derived.steps.map((step) => step.stackingMultiplier)).toEqual([
      ...STACKING_MULTIPLIERS,
      0,
    ]);
    // A sixth modifier of the same direction has no effect at all.
    expect(derived.steps[5]?.result).toBe(derived.steps[4]?.result);
    const expected = [0.5, 0.4, 0.3, 0.2, 0.1].reduce(
      (value, magnitude, index) => value * (1 + magnitude * (STACKING_MULTIPLIERS[index] ?? 0)),
      1,
    );
    expect(derived.value).toBeCloseTo(expected, 12);
  });

  it('orders bonuses and penalties separately [FUNC-4.4]', () => {
    const derived = evaluateAttribute({
      attribute: 'maxSpeedKmPerSecond',
      base: 1,
      modifiers: [
        modifier({ value: 0.2, sourceId: 'bonus.small' }),
        modifier({ value: -0.5, sourceId: 'penalty.large' }),
        modifier({ value: 0.4, sourceId: 'bonus.large' }),
        modifier({ value: -0.1, sourceId: 'penalty.small' }),
      ],
    });

    expect(derived.steps.map((step) => step.value)).toEqual([0.4, 0.2, -0.5, -0.1]);
    // Each direction starts again at full effectiveness.
    expect(derived.steps.map((step) => step.stackingMultiplier)).toEqual([1, 0.87, 1, 0.87]);
  });

  it('leaves intrinsic modifiers undiminished and applies them last [FUNC-4.4]', () => {
    const derived = evaluateAttribute({
      attribute: 'maxSpeedKmPerSecond',
      base: 1,
      modifiers: [
        modifier({ value: 0.5, sourceId: 'fitted.a' }),
        modifier({ value: 0.5, sourceId: 'fitted.b' }),
        modifier({ value: 0.5, stage: 'intrinsic', sourceId: 'hull' }),
      ],
    });

    expect(derived.steps.map((step) => step.stackingMultiplier)).toEqual([1, 0.87, 1]);
    expect(derived.steps[2]?.stage).toBe('intrinsic');
  });

  it('orders equal magnitudes by source so a fit always derives the same number [TECH-9.5]', () => {
    const forwards = evaluateAttribute({
      attribute: 'maxSpeedKmPerSecond',
      base: 1,
      modifiers: [modifier({ value: 0.3, sourceId: 'b' }), modifier({ value: 0.3, sourceId: 'a' })],
    });
    const backwards = evaluateAttribute({
      attribute: 'maxSpeedKmPerSecond',
      base: 1,
      modifiers: [modifier({ value: 0.3, sourceId: 'a' }), modifier({ value: 0.3, sourceId: 'b' })],
    });

    expect(forwards.steps.map((step) => step.sourceId)).toEqual(['a', 'b']);
    expect(forwards).toEqual(backwards);
  });

  it('clamps a rule-bounded output and says that it did [FUNC-4.2]', () => {
    const derived = evaluateAttribute({
      attribute: resistanceAttribute('armor', 'thermal'),
      base: 0.85,
      modifiers: [modifier({ attribute: resistanceAttribute('armor', 'thermal'), operation: 'resistance', value: 0.5 })],
      minimum: 0,
      maximum: 0.9,
    });

    expect(derived.value).toBe(0.9);
    expect(derived.clamped).toBe(true);
  });

  it('floors a whole-unit attribute only at the final step [FUNC-4.1]', () => {
    const derived = evaluateAttribute({
      attribute: 'cargoCapacityCubicDecimetres',
      base: 100,
      modifiers: [modifier({ attribute: 'cargoCapacityCubicDecimetres', value: 0.155 })],
      minimum: 0,
      whole: true,
    });

    expect(derived.steps[0]?.result).toBeCloseTo(115.5, 10);
    expect(derived.value).toBe(115);
  });

  it('applies a conditional modifier only under its assumption [FUNC-8.5]', () => {
    const request = {
      attribute: 'maxSpeedKmPerSecond',
      base: 1,
      modifiers: [modifier({ value: 0.75, condition: PROPULSION_ACTIVE })],
    };

    expect(evaluateAttribute(request).value).toBe(1);
    expect(evaluateAttribute({ ...request, conditions: new Set([PROPULSION_ACTIVE]) }).value).toBe(1.75);
  });

  it('composes resistances so a bonus removes its share of what still gets through [FUNC-9.7]', () => {
    expect(applyOperation('resistance', 0.5, 0.2)).toBeCloseTo(0.6, 12);
    expect(applyOperation('resistance', 0.5, -0.2)).toBeCloseTo(0.4, 12);
    expect(applyOperation('percent', 200, -0.25)).toBe(150);
    expect(applyOperation('add', 200, 120)).toBe(320);
  });
});

describe('derived ship attributes', () => {
  it('derives every declared attribute from the hull alone [FUNC-8.2]', () => {
    const derived = deriveShipAttributes({ hull, fit: [], content });

    for (const attribute of SHIP_ATTRIBUTES) {
      expect(derived.attributes[attribute], attribute).toBeDefined();
    }
    expect(attributeValue(derived, 'shieldHitPoints')).toBe(hull.defenses.shield.hitPoints);
    expect(attributeValue(derived, 'capacitorCapacity')).toBe(hull.capacitor.capacity);
    expect(attributeValue(derived, resistanceAttribute('armor', 'kinetic'))).toBe(
      hull.defenses.armor.resistances.kinetic,
    );
  });

  it('takes nothing from an offline module [FUNC-8.4]', () => {
    const offline = deriveShipAttributes({
      hull,
      fit: [fitted('module.capacitor.battery.small', 0, false)],
      content,
    });
    const online = deriveShipAttributes({
      hull,
      fit: [fitted('module.capacitor.battery.small', 0, true)],
      content,
    });

    expect(attributeValue(offline, 'capacitorCapacity')).toBe(hull.capacitor.capacity);
    expect(attributeValue(online, 'capacitorCapacity')).toBe(hull.capacitor.capacity + 120);
  });

  it('diminishes two platings of the same layer together [FUNC-4.4, FUNC-8.2]', () => {
    const one = deriveShipAttributes({
      hull,
      fit: [fitted('module.plating.armor.small', 0)],
      content,
    });
    const two = deriveShipAttributes({
      hull,
      fit: [fitted('module.plating.armor.small', 0), fitted('module.plating.armor.small', 1)],
      content,
    });

    const attribute = resistanceAttribute('armor', 'explosive');
    const base = hull.defenses.armor.resistances.explosive;
    expect(attributeValue(one, attribute)).toBeCloseTo(1 - (1 - base) * 0.9, 12);
    expect(attributeValue(two, attribute)).toBeCloseTo(1 - (1 - base) * 0.9 * (1 - 0.1 * 0.87), 12);
    expect(two.attributes[attribute]?.steps.map((step) => step.stackingMultiplier)).toEqual([1, 0.87]);
  });

  it('explains a derived value by naming its base and every source [FUNC-4.4, FUNC-19.6]', () => {
    const derived = deriveShipAttributes({
      hull,
      fit: [fitted('module.propulsion.afterburner.small', 0)],
      content,
      conditions: new Set([PROPULSION_ACTIVE]),
    });
    const speed = derived.attributes['maxSpeedKmPerSecond'];

    expect(speed?.base).toBe(hull.movement.maxSpeedKmPerSecond);
    expect(speed?.steps).toHaveLength(1);
    expect(speed?.steps[0]?.sourceId).toBe('module.propulsion.afterburner.small');
    expect(speed?.steps[0]?.sourceKey).toBe(
      content.requireModule('module.propulsion.afterburner.small' as ModuleId).nameKey,
    );
    expect(speed?.steps[0]?.result).toBeCloseTo(hull.movement.maxSpeedKmPerSecond * 1.75, 12);
  });
});
