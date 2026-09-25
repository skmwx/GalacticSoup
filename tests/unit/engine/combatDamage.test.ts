import { describe, expect, it } from 'vitest';

import {
  applyLayeredDamage,
  applyRepair,
  allocateEntityId,
  COMBAT_EVENT_LIMIT,
  payCapacitor,
  recordDamageEvent,
  recordDestructionEvent,
  regeneratePool,
  totalProfile,
} from '@engine/domain';
import { DAMAGE_TYPES, type DamageProfile } from '@engine/ports';

import { testDraft } from '../../support/campaign.ts';

const ZERO_RESISTANCE = {
  electromagnetic: 0,
  thermal: 0,
  kinetic: 0,
  explosive: 0,
} as const;

describe('layered damage', () => {
  it('spills the same proportion of every raw component across a depleted layer [FUNC-9.7, TECH-10.3, MVP-AC-04]', () => {
    const raw: DamageProfile = {
      electromagnetic: 20,
      thermal: 20,
      kinetic: 0,
      explosive: 0,
    };
    const result = applyLayeredDamage(raw, [
      {
        layer: 'shield',
        maximumHitPoints: 20,
        currentHitPoints: 10,
        resistances: { ...ZERO_RESISTANCE, electromagnetic: 0.5 },
      },
      {
        layer: 'armor',
        maximumHitPoints: 100,
        currentHitPoints: 100,
        resistances: ZERO_RESISTANCE,
      },
      {
        layer: 'hull',
        maximumHitPoints: 100,
        currentHitPoints: 100,
        resistances: ZERO_RESISTANCE,
      },
    ]);

    const shield = result.layers[0]!;
    // 20 EM applies as 10 and 20 thermal as 20, so one third of both raw
    // components is consumed to remove the shield's ten remaining points.
    expect(shield.rawConsumed.electromagnetic).toBeCloseTo(20 / 3, 8);
    expect(shield.rawConsumed.thermal).toBeCloseTo(20 / 3, 8);
    expect(shield.afterHitPoints).toBe(0);
    expect(result.layers[1]?.afterHitPoints).toBeCloseTo(100 - 80 / 3, 8);
    expect(result.destroyed).toBe(false);
  });

  it('conserves every raw component across layer consumption and spillover [FUNC-9.7, TECH-15.1]', () => {
    for (let sample = 1; sample <= 100; sample += 1) {
      const raw = Object.fromEntries(
        DAMAGE_TYPES.map((type, index) => [type, ((sample * (index + 3)) % 41) + 0.25]),
      ) as unknown as DamageProfile;
      const result = applyLayeredDamage(raw, [
        {
          layer: 'shield',
          maximumHitPoints: 30,
          currentHitPoints: sample % 31,
          resistances: {
            electromagnetic: 0.1,
            thermal: 0.2,
            kinetic: 0.3,
            explosive: 0.4,
          },
        },
        {
          layer: 'armor',
          maximumHitPoints: 45,
          currentHitPoints: (sample * 2) % 46,
          resistances: ZERO_RESISTANCE,
        },
        {
          layer: 'hull',
          maximumHitPoints: 20,
          currentHitPoints: (sample * 3) % 21,
          resistances: ZERO_RESISTANCE,
        },
      ]);

      for (const type of DAMAGE_TYPES) {
        const consumed = result.layers.reduce(
          (total, layer) => total + layer.rawConsumed[type],
          0,
        );
        expect(consumed + result.remainingRawDamage[type]).toBeCloseTo(raw[type], 7);
      }
      expect(result.appliedTotal).toBeCloseTo(totalProfile(result.appliedDamage), 8);
    }
  });

  it('clamps repairs, regeneration and capacitor payment at their bounds [FUNC-4.2, FUNC-9.7, FUNC-9.8]', () => {
    expect(applyRepair(12, 40)).toEqual({
      beforeDamage: 12,
      afterDamage: 0,
      repairedHitPoints: 12,
    });
    expect(regeneratePool(98, 100, 50, 5_000)).toEqual({
      before: 98,
      after: 100,
      regenerated: 2,
      ratePerSecond: 2,
    });
    expect(payCapacitor(9, 10)).toEqual({
      paid: false,
      before: 9,
      after: 9,
      committed: 0,
    });
    expect(payCapacitor(10, 10)).toEqual({
      paid: true,
      before: 10,
      after: 0,
      committed: 10,
    });
  });
});

describe('significant combat event recorder', () => {
  it('aggregates repeated damage in its time window and remains bounded [TECH-10.3]', () => {
    const draft = testDraft();
    const sourceId = draft.assets.activeShipId!;
    const targetId = allocateEntityId(draft);
    const profile: DamageProfile = {
      electromagnetic: 2,
      thermal: 3,
      kinetic: 5,
      explosive: 7,
    };
    const damage = () => recordDamageEvent(draft, {
      sourceId,
      targetId,
      slotKey: 'weapon:0',
      rawDamage: profile,
      appliedDamage: profile,
      layerDamage: { shield: 17, armor: 0, hull: 0 },
    });

    damage();
    draft.time.simulationTimeMs = 4_000;
    damage();
    expect(draft.combat.events).toHaveLength(1);
    expect(draft.combat.events[0]).toMatchObject({
      kind: 'damage',
      firstAtMs: 0,
      lastAtMs: 4_000,
      count: 2,
      rawDamage: { electromagnetic: 4, thermal: 6, kinetic: 10, explosive: 14 },
    });

    draft.time.simulationTimeMs = 10_000;
    damage();
    expect(draft.combat.events).toHaveLength(2);

    for (let index = 0; index < COMBAT_EVENT_LIMIT; index += 1) {
      draft.time.simulationTimeMs += 1;
      recordDestructionEvent(draft, allocateEntityId(draft));
    }
    expect(draft.combat.events).toHaveLength(COMBAT_EVENT_LIMIT);
    expect(draft.combat.events[0]?.kind).toBe('destruction');
  });
});
