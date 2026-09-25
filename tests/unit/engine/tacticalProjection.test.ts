import { describe, expect, it } from 'vitest';

import { runCommand } from '@engine/application';
import { objectAttitude, type CampaignState } from '@engine/domain';
import {
  combatProjection,
  destinationsProjection,
  siteProjection,
} from '@engine/projections';
import { activateModule, beginLock } from '@engine/simulation';

import { testCampaign } from '../../support/campaign.ts';
import { advance, combatFixture, FUSION, PHASED } from '../../support/combat.ts';
import { shippedContent } from '../../support/content.ts';
import {
  advance as advanceSite,
  encounterFixture,
  opponentIds,
} from '../../support/encounter.ts';

/**
 * The tactical contract the combat interface reads
 * (Functional Specification 9.1, 9.4, 19.1, 19.3; Technical Specification
 * 7.3, 12.3).
 *
 * The interface draws hostility, names who has locked the player, shows what a
 * ship is running and says what limits a shot. Each of those is decided here,
 * so the tests hold the projection to the rule rather than to the drawing.
 */

const content = shippedContent();
const BOOSTER = { kind: 'system', index: 0 } as const;

function undocked(): CampaignState {
  const result = runCommand({
    campaign: testCampaign(),
    content,
    type: 'ship.undock',
    payload: {},
  });
  if (result.kind !== 'committed' || result.campaign === null) {
    throw new Error('The test campaign could not undock.');
  }
  return result.campaign;
}

describe('attitude', () => {
  it('marks the player own, an encounter opponent hostile and the station neutral [FUNC-9.1, FUNC-19.3]', () => {
    const home = siteProjection(undocked(), content);
    const byKind = Object.fromEntries(
      (home.site?.objects ?? []).map((object) => [object.player ? 'player' : object.kind, object.attitude]),
    );
    expect(byKind).toEqual({ player: 'own', station: 'neutral' });

    const fixture = encounterFixture();
    const [opponent] = opponentIds(fixture);
    if (opponent === undefined) throw new Error('The scout site spawned no opponent.');
    const objects = siteProjection(fixture.draft, content).site?.objects ?? [];

    expect(objects.find((object) => object.id === opponent)?.attitude).toBe('hostile');
    expect(objects.find((object) => object.player)?.attitude).toBe('own');
  });

  it('names an opponent as the encounter does, not by its hull [FUNC-19.3, MVP-AC-05]', () => {
    const fixture = encounterFixture();
    const [opponent] = opponentIds(fixture);
    const object = siteProjection(fixture.draft, content).site?.objects.find((entry) => entry.id === opponent);

    expect(object?.nameKey).toBe('content.npc.pirate.scout.name');
    // The stored site object still records its hull; only the view names it.
    expect(fixture.draft.navigation.currentSite?.objects[opponent ?? '']?.nameKey).toBe(
      'content.hull.pirate.scout.name',
    );
  });

  it('does not call a ship hostile merely because it is not the player [FUNC-9.1]', () => {
    // The combat fixture's target is an ordinary ship outside any encounter.
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });

    expect(objectAttitude(fixture.draft, fixture.targetId)).toBe('neutral');
    expect(objectAttitude(fixture.draft, fixture.playerId)).toBe('own');
  });
});

describe('hostile locks', () => {
  it('names a ship that is locking and then has locked the player [FUNC-19.1, FUNC-19.7]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    expect(combatProjection(fixture.draft, content).hostileLocks).toEqual([]);

    expect(beginLock(fixture.context, fixture.targetId, fixture.playerId)).toBe(true);
    expect(combatProjection(fixture.draft, content).hostileLocks).toEqual([
      { shipId: fixture.targetId, status: 'locking' },
    ]);

    advance(fixture, 25_000);
    expect(combatProjection(fixture.draft, content).hostileLocks).toEqual([
      { shipId: fixture.targetId, status: 'locked' },
    ]);
  });

  it('ignores the player\'s own locks [FUNC-19.1]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    beginLock(fixture.context, fixture.playerId, fixture.targetId);

    const combat = combatProjection(fixture.draft, content);
    expect(combat.locks).toHaveLength(1);
    expect(combat.hostileLocks).toEqual([]);
  });
});

describe('active effects', () => {
  it('publishes a module only while it is in a paid cycle [FUNC-9.8, FUNC-19.3]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    expect(combatProjection(fixture.draft, content).defenses?.activeEffects).toEqual([]);

    expect(activateModule(fixture.context, fixture.playerId, BOOSTER)).toBe(true);
    const effects = combatProjection(fixture.draft, content).defenses?.activeEffects ?? [];

    expect(effects).toEqual([
      {
        slot: BOOSTER,
        moduleId: 'module.shield.booster.small',
        nameKey: 'content.module.shield.booster.small.name',
        category: 'shieldBooster',
      },
    ]);
  });

  it('shows what an opponent is running as well as what the player is [FUNC-19.3, MVP-AC-04]', () => {
    const fixture = encounterFixture();
    const [opponent] = opponentIds(fixture);
    if (opponent === undefined) throw new Error('The scout site spawned no opponent.');

    // The scout burns its afterburner while it is outside its band, which it
    // is on arrival; the decision is the ordinary module command.
    advanceSite(fixture, 5_000);
    const target = combatProjection(fixture.draft, content).targetDefenses.find(
      (entry) => entry.shipId === opponent,
    );
    expect(target?.activeEffects.map((effect) => effect.category)).toEqual(['propulsion']);
  });
});

describe('weapon effectiveness', () => {
  it('names the limiting half of the turret formula for each locked target [FUNC-9.5, FUNC-19.3]', () => {
    // Well beyond optimal and standing still: range, not tracking, limits it.
    const far = combatFixture({ targetPositionKm: { x: 9, y: 0 } });
    beginLock(far.context, far.playerId, far.targetId);
    advance(far, 5_000);
    expect(combatProjection(far.draft, content).weapons[0]?.effects[0]?.limitingFactor).toBe('range');

    // Close in and crossing fast: tracking limits it.
    const crossing = combatFixture({
      targetPositionKm: { x: 1, y: 0 },
      targetVelocityKmPerSecond: { x: 0, y: 0.4 },
    });
    beginLock(crossing.context, crossing.playerId, crossing.targetId);
    advance(crossing, 1_000);
    const effect = combatProjection(crossing.draft, content).weapons[0]?.effects[0];
    expect(effect?.limitingFactor).toBe('tracking');
    expect(effect?.trackingStrain).toBeGreaterThan(effect?.rangeStrain ?? 0);
  });

  it('offers every accepted charge with its availability and what it would do [FUNC-9.4, FUNC-19.6]', () => {
    const fixture = combatFixture({
      targetPositionKm: { x: 3, y: 0 },
      playerCargoRounds: [{ ammunitionId: PHASED, rounds: 40 }],
    });
    const weapon = combatProjection(fixture.draft, content).weapons[0];
    if (weapon === undefined) throw new Error('The starter fit has no weapon.');

    expect(weapon.ammunitionNameKey).toBe('content.ammo.projectile.small.fusion.name');
    expect(weapon.ammunitionOptions.map((option) => [option.ammunitionId, option.loaded, option.cargoRounds]))
      .toEqual([
        [FUSION, true, 0],
        [PHASED, false, 40],
      ]);

    const turret = content.module('module.turret.autocannon.small');
    const phasedCharge = content.ammunition(PHASED);
    if (turret?.category !== 'turret' || phasedCharge === undefined) {
      throw new Error('The shipped autocannon or phased charge is missing.');
    }
    const phased = weapon.ammunitionOptions[1];
    expect(phased?.optimalRangeKm).toBeCloseTo(
      turret.turret.optimalRangeKm * phasedCharge.optimalRangeMultiplier,
      12,
    );
    expect(phased?.listedDamage['thermal'])
      .toBeCloseTo(phasedCharge.damagePerShot.thermal * turret.turret.damageMultiplier, 12);
    expect(phased?.commands).toEqual([
      { command: 'weapon.changeAmmunition', available: true, unavailableReason: null },
    ]);
    // The loaded charge has none left in the hold to reload with.
    expect(weapon.ammunitionOptions[0]?.commands[0]?.unavailableReason).toBe(
      'error.ruleViolation.weaponNoAmmunition',
    );
  });
});

describe('destination disclosure', () => {
  it('names every item the loot summary discloses [MVP-AC-06, FUNC-18]', () => {
    const destinations = destinationsProjection(testCampaign(), content).destinations;
    const scout = destinations.find((entry) => entry.encounterId === 'encounter.borrell.pirate-scout');

    expect(scout?.possibleLoot).toEqual([
      { itemId: 'ammo.projectile.small.fusion', nameKey: 'content.ammo.projectile.small.fusion.name' },
      { itemId: 'item.salvage.alloy', nameKey: 'content.item.salvage.alloy.name' },
    ]);
    for (const entry of destinations) {
      expect(entry.possibleLoot.map((loot) => loot.itemId)).toEqual(entry.possibleLootItemIds);
    }
  });
});
