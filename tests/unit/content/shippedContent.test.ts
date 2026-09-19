import { describe, expect, it } from 'vitest';

import type { TurretModuleDefinition } from '@engine';

import { shippedContent } from '../../support/content.ts';

/**
 * The content the game ships against the MVP content floor
 * (MVP Scope 4.1-4.2).
 *
 * These are scope commitments, not balance: exact prices, statistics and drop
 * rates are tuning values that Phase 17 owns and may change freely. What may
 * not change is that the catalogue still offers more than one viable approach
 * and that the three authored sites still differ in the pressure they apply.
 */

const content = shippedContent();

function turrets(): TurretModuleDefinition[] {
  return content
    .modules()
    .filter((module): module is TurretModuleDefinition => module.category === 'turret');
}

describe('shipped content identity', () => {
  it('carries a version and digest the engine can record in a save [TECH-6.3]', () => {
    expect(content.contentVersion).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{12}$/);
    expect(content.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(content.locales).toContain(content.defaultLocale);
  });
});

describe('player content floor', () => {
  it('ships exactly one player-usable hull [MVP-AC-02]', () => {
    expect(content.hulls().filter((hull) => hull.playerUsable)).toHaveLength(1);
  });

  it('offers a short-range and a longer-range turret [MVP-AC-04]', () => {
    const ranges = turrets().map((module) => module.turret.optimalRangeKm);

    expect(turrets().length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...ranges)).toBeGreaterThan(Math.min(...ranges) * 2);
  });

  it('offers at least two meaningfully different damage profiles [MVP-AC-04]', () => {
    const profiles = new Set(
      content.ammunitions().map((charge) => {
        const total = Object.values(charge.damagePerShot).reduce((sum, value) => sum + value, 0);
        return Object.entries(charge.damagePerShot)
          .filter(([, value]) => value / total >= 0.25)
          .map(([type]) => type)
          .sort()
          .join('+');
      }),
    );

    expect(profiles.size).toBeGreaterThanOrEqual(2);
  });

  it('offers an active defence and a passive one [MVP-AC-04]', () => {
    const categories = new Set(content.modules().map((module) => module.category));

    expect(
      categories.has('shieldBooster') || categories.has('armorRepairer'),
      'an active defensive option',
    ).toBe(true);
    expect(categories.has('resistancePlating'), 'a passive defensive option').toBe(true);
  });

  it('offers propulsion and capacitor support [MVP-AC-04]', () => {
    const categories = new Set(content.modules().map((module) => module.category));

    expect(categories.has('propulsion')).toBe(true);
    expect(categories.has('capacitorBattery')).toBe(true);
  });

  it('supplies ammunition for every turret it ships [MVP-AC-02, FUNC-9.4]', () => {
    for (const turret of turrets()) {
      expect(
        content.ammunitionInGroup(turret.turret.ammunitionGroup).length,
        turret.id,
      ).toBeGreaterThan(0);
    }
  });
});

describe('encounter content floor', () => {
  it('ships one repeatable site per tier [MVP-AC-05, MVP-AC-07, MVP-AC-09]', () => {
    const tiers = content.encounters().map((encounter) => encounter.tier);

    expect([...tiers].sort()).toEqual([1, 2, 3]);
    expect(content.encounters().every((encounter) => encounter.repeatable)).toBe(true);
  });

  it('raises the number of opponents beyond the first tier [MVP-AC-05]', () => {
    const opponents = new Map(
      content
        .encounters()
        .map((encounter) => [
          encounter.tier,
          encounter.spawns.reduce((total, spawn) => total + spawn.count, 0),
        ]),
    );

    expect(opponents.get(1)).toBe(1);
    expect(opponents.get(2) ?? 0).toBeGreaterThan(1);
    expect(opponents.get(3) ?? 0).toBeGreaterThan(opponents.get(2) ?? 0);
  });

  it('exercises more than one NPC range behaviour [MVP-AC-05, FUNC-9.10]', () => {
    const roles = new Set(
      content.encounters().flatMap((encounter) =>
        encounter.spawns.map((spawn) => content.requireNpcProfile(spawn.npcProfileId).role),
      ),
    );

    expect(roles.size).toBeGreaterThanOrEqual(2);
  });

  it('does not make a harder site only a tougher version of an easier one [MVP-AC-05]', () => {
    const composition = content.encounters().map((encounter) =>
      encounter.spawns
        .map((spawn) => spawn.npcProfileId)
        .sort()
        .join(','),
    );

    expect(new Set(composition).size).toBe(composition.length);
  });

  it('puts every site in the one MVP system with a neutral station [MVP-AC-01, FUNC-5.1]', () => {
    const systems = content.systems();
    expect(systems).toHaveLength(1);

    const [system] = systems;
    expect(content.stations().filter((station) => station.neutralAccess)).toHaveLength(1);
    for (const encounter of content.encounters()) {
      expect(encounter.systemId).toBe(system?.id);
    }
  });

  it('pays a bounty and offers loot for every opponent [MVP-AC-06, FUNC-9.11]', () => {
    for (const profile of content.npcProfiles()) {
      expect(profile.bountyCredits, profile.id).toBeGreaterThan(0);
      expect(content.lootTable(profile.lootTableId), profile.id).toBeDefined();
    }
  });

  it('rewards more for a harder site [MVP-AC-07]', () => {
    const bounty = (tier: number): number => {
      const encounter = content.encounters().find((entry) => entry.tier === tier);
      return (encounter?.spawns ?? []).reduce(
        (total, spawn) => total + content.requireNpcProfile(spawn.npcProfileId).bountyCredits * spawn.count,
        0,
      );
    };

    expect(bounty(2)).toBeGreaterThan(bounty(1));
    expect(bounty(3)).toBeGreaterThan(bounty(2));
  });
});

describe('recovery guarantee', () => {
  it('keeps the starter hull and a working weapon at a fixed price [MVP-AC-08, FUNC-11.2]', () => {
    const station = content.stations().find((entry) => entry.neutralAccess);
    const fixed = content
      .listings(station?.id ?? '')
      .filter((listing) => listing.supply === 'fixed')
      .map((listing) => listing.itemId);

    const starter = content.hulls().find((hull) => hull.playerUsable);
    expect(fixed).toContain(starter?.id);

    const stockedTurret = turrets().find((module) => fixed.includes(module.id));
    expect(stockedTurret).toBeDefined();
    expect(
      content
        .ammunitionInGroup(stockedTurret?.turret.ammunitionGroup ?? '')
        .some((charge) => fixed.includes(charge.id)),
    ).toBe(true);
  });
});
