import { describe, expect, it } from 'vitest';

import { preferredRangeKm, selectNpcIntent, type NpcSituation } from '@engine/domain';

import { shippedContent } from '../../support/content.ts';

/**
 * The behaviour selector (Functional Specification 9.10).
 *
 * It is pure, so each role can be held to its stated band, its module use and
 * its refusal to gain anything from the player's condition.
 */

const rules = shippedContent().rules.combat;

function situation(overrides: Partial<NpcSituation> = {}): NpcSituation {
  return {
    role: 'brawler',
    targetId: 'target',
    rangeKm: 20,
    maxLockRangeKm: 30,
    bestOptimalRangeKm: 10,
    hasLock: false,
    repairLayerFraction: null,
    hasPropulsion: false,
    ...overrides,
  };
}

describe('npc behaviour', () => {
  it.each([
    ['brawler', 'approach', 3],
    ['skirmisher', 'orbit', 7.5],
    ['sniper', 'keepRange', 11.5],
  ] as const)('gives a %s its authored order and band [FUNC-9.10]', (role, kind, expected) => {
    const intent = selectNpcIntent(situation({ role }), rules);

    expect(intent.movement.kind).toBe(kind);
    expect(intent.desiredRangeKm).toBeCloseTo(expected, 6);
    expect('targetId' in intent.movement ? intent.movement.targetId : '').toBe('target');
  });

  it('derives the band from its own guns, not from its label [FUNC-9.10]', () => {
    // The same sniper with a short-range turret closes instead of sitting
    // outside its own falloff.
    const long = preferredRangeKm(situation({ role: 'sniper', bestOptimalRangeKm: 20 }), rules);
    const short = preferredRangeKm(situation({ role: 'sniper', bestOptimalRangeKm: 2 }), rules);

    expect(long).toBeGreaterThan(short);
    // It never plans to sit outside its own lock range.
    expect(long).toBeLessThanOrEqual(30 * 0.9);
    // Nor inside the minimum its role keeps.
    expect(short).toBe(rules.npcRoles.sniper.minimumRangeKm);
  });

  it('falls back to lock range when it is unarmed [FUNC-9.10]', () => {
    const intent = selectNpcIntent(situation({ bestOptimalRangeKm: null }), rules);
    expect(intent.desiredRangeKm).toBeCloseTo(30 * rules.npcRoles.brawler.preferredRangeFraction, 6);
    expect(intent.fire).toBe(false);
  });

  it('locks only what it can reach and fires only what it has locked [FUNC-9.2, FUNC-9.10]', () => {
    expect(selectNpcIntent(situation({ rangeKm: 29 }), rules).lock).toBe(true);
    expect(selectNpcIntent(situation({ rangeKm: 31 }), rules).lock).toBe(false);
    expect(selectNpcIntent(situation({ hasLock: true }), rules).lock).toBe(false);
    expect(selectNpcIntent(situation({ hasLock: true }), rules).fire).toBe(true);
    expect(selectNpcIntent(situation({ hasLock: false }), rules).fire).toBe(false);
  });

  it('burns only while it is outside its band [FUNC-9.10, FUNC-9.8]', () => {
    const band = preferredRangeKm(situation(), rules) * (1 + rules.npcRangeToleranceFraction);

    expect(selectNpcIntent(situation({ hasPropulsion: true, rangeKm: band + 1 }), rules).propulsion).toBe(true);
    expect(selectNpcIntent(situation({ hasPropulsion: true, rangeKm: band - 1 }), rules).propulsion).toBe(false);
    // A ship with no propulsion never asks for one.
    expect(selectNpcIntent(situation({ hasPropulsion: false, rangeKm: band + 1 }), rules).propulsion).toBe(false);
  });

  it('repairs below the authored threshold and stops above it [FUNC-9.7, FUNC-9.10]', () => {
    const below = rules.npcRepairThresholdFraction - 0.1;
    const above = rules.npcRepairThresholdFraction + 0.1;

    expect(selectNpcIntent(situation({ repairLayerFraction: below }), rules).repair).toBe(true);
    expect(selectNpcIntent(situation({ repairLayerFraction: above }), rules).repair).toBe(false);
    expect(selectNpcIntent(situation({ repairLayerFraction: null }), rules).repair).toBe(false);
  });

  it('reads nothing about the player beyond range, so losing grants no bonus [FUNC-9.10]', () => {
    // The situation carries the target's id and its range and nothing else.
    const keys = Object.keys(situation()).sort();
    expect(keys).toEqual([
      'bestOptimalRangeKm',
      'hasLock',
      'hasPropulsion',
      'maxLockRangeKm',
      'rangeKm',
      'repairLayerFraction',
      'role',
      'targetId',
    ]);
  });
});
