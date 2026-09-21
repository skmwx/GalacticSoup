import { describe, expect, it } from 'vitest';

import {
  activateRefusal,
  changeAmmunitionRefusal,
  combatantOf,
  lockRefusal,
  reloadRefusal,
  shipCombat,
  stacksIn,
  unlockRefusal,
  weaponState,
  type SlotRef,
} from '@engine/domain';
import {
  activateWeapon,
  beginLock,
  clearCombat,
  deactivateWeapon,
  releaseLock,
  requestReload,
} from '@engine/simulation';

import {
  advance,
  AUTOCANNON,
  combatFixture,
  eventKinds,
  FIRST_WEAPON,
  FUSION,
  IRON,
  PHASED,
  RAILGUN,
  STATION_SITE_ID,
  type CombatFixture,
} from '../../support/combat.ts';

/**
 * The lock, weapon-cycle and reload state machines
 * (Functional Specification 9.2, 9.4; Technical Specification 9.2, 10.3).
 */

const WEAPON: SlotRef = { kind: 'weapon', index: 0 };
const rulesOf = (fixture: CombatFixture) => ({ state: fixture.draft, content: fixture.content });
const player = (fixture: CombatFixture) => shipCombat(fixture.draft, fixture.playerId);
const weapon = (fixture: CombatFixture) => weaponState(player(fixture), FIRST_WEAPON);
const capacitorOf = (fixture: CombatFixture) =>
  fixture.draft.assets.ships[fixture.playerId]?.condition.capacitorCharge ?? 0;
const loadedRounds = (fixture: CombatFixture, shipId: string): number => {
  const ship = fixture.draft.assets.ships[shipId];
  if (ship === undefined) return 0;
  return stacksIn(fixture.draft.assets, ship.fittingInventoryId)
    .filter((stack) => stack.state.kind === 'charge')
    .reduce((total, stack) => total + stack.quantity, 0);
};

/** The player flying the longer-ranged turret, which costs capacitor to fire. */
function railgunFixture(): CombatFixture {
  return combatFixture({
    targetPositionKm: { x: 2, y: 0 },
    playerTurret: { moduleId: RAILGUN, ammunitionId: IRON },
  });
}

function lockTarget(fixture: CombatFixture): void {
  beginLock(fixture.context, fixture.playerId, fixture.targetId);
  advance(fixture, 3000);
}

describe('locking', () => {
  it('completes a lock attempt after its computed lock time [FUNC-9.2, MVP-AC-03]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });

    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    expect(player(fixture).locks[0]?.status).toBe('locking');
    expect(player(fixture).locks[0]?.boundaryEntryId).not.toBeNull();

    advance(fixture, 3000);

    const lock = player(fixture).locks[0];
    expect(lock?.status).toBe('locked');
    expect(lock?.completesAtMs).toBeNull();
    expect(lock?.boundaryEntryId).toBeNull();
    expect(eventKinds(fixture)).toContain('combat.lockCompleted');
  });

  it('refuses a second lock on the same target and a lock on itself [FUNC-9.2, FUNC-22.10]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    lockTarget(fixture);

    expect(lockRefusal(rulesOf(fixture), fixture.targetId)).toBe('lockAlreadyHeld');
    expect(lockRefusal(rulesOf(fixture), fixture.playerId)).toBe('lockTargetUnavailable');
    expect(lockRefusal(rulesOf(fixture), 'c000000000000000000000000-e9')).toBe('lockTargetUnavailable');
  });

  it('refuses a target beyond maximum lock range [FUNC-9.2]', () => {
    const far = combatFixture({ targetPositionKm: { x: 500, y: 0 } });

    expect(lockRefusal(rulesOf(far), far.targetId)).toBe('lockOutOfRange');
  });

  it('drops a lock after two consecutive seconds out of range [FUNC-9.2]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    lockTarget(fixture);

    const target = fixture.draft.navigation.currentSite?.objects[fixture.targetId];
    if (target === undefined) throw new Error('The fixture has no target.');
    fixture.draft.navigation.currentSite!.objects[fixture.targetId] = {
      ...target,
      position: { x: 400, y: 0 },
    };

    advance(fixture, 1000);
    expect(player(fixture).locks[0]?.outOfRangeSinceMs).not.toBeNull();
    expect(player(fixture).locks).toHaveLength(1);

    advance(fixture, 1500);
    expect(player(fixture).locks).toHaveLength(0);
    expect(eventKinds(fixture)).toContain('combat.lockLost');
  });

  it('keeps a lock that returns to range before the grace period expires [FUNC-9.2]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    lockTarget(fixture);
    const site = fixture.draft.navigation.currentSite;
    if (site === null) throw new Error('The fixture has no site.');
    const target = site.objects[fixture.targetId]!;

    site.objects[fixture.targetId] = { ...target, position: { x: 400, y: 0 } };
    advance(fixture, 1000);
    site.objects[fixture.targetId] = { ...target, position: { x: 3, y: 0 } };
    advance(fixture, 1000);

    expect(player(fixture).locks).toHaveLength(1);
    expect(player(fixture).locks[0]?.outOfRangeSinceMs).toBeNull();
  });

  it('identifies a target that disappears and stops what depended on it [FUNC-22.5]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    delete fixture.draft.navigation.currentSite!.objects[fixture.targetId];
    advance(fixture, 100);

    expect(player(fixture).locks).toHaveLength(0);
    expect(weapon(fixture).repeating).toBe(false);
    expect(weapon(fixture).stopReason).toBe('targetMissing');
  });

  it('releases a lock on request and stops the weapons that used it [FUNC-9.2, FUNC-9.4]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    expect(unlockRefusal(rulesOf(fixture), fixture.targetId)).toBeNull();
    releaseLock(fixture.context, fixture.playerId, fixture.targetId);

    expect(player(fixture).locks).toHaveLength(0);
    expect(weapon(fixture).repeating).toBe(false);
    expect(weapon(fixture).stopReason).toBe('lockLost');
    expect(unlockRefusal(rulesOf(fixture), fixture.targetId)).toBe('lockNotHeld');
  });

  it('refuses more locks than the hull allows [FUNC-9.2]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 3, y: 0 } });
    const site = fixture.draft.navigation.currentSite;
    if (site === null) throw new Error('The fixture has no site.');
    const combatant = combatantOf(fixture.draft, fixture.content, fixture.playerId);
    const maximum = combatant?.hull.targeting.maxLockedTargets ?? 0;
    const target = site.objects[fixture.targetId]!;

    for (let index = 0; index < maximum; index += 1) {
      const id = `c000000000000000000000000-e${String(index + 100)}`;
      site.objects[id] = { ...target, id, position: { x: 3 + index, y: 1 } };
      beginLock(fixture.context, fixture.playerId, id);
    }

    expect(player(fixture).locks).toHaveLength(maximum);
    expect(lockRefusal(rulesOf(fixture), fixture.targetId)).toBe('lockLimitReached');
  });
});

describe('weapon cycles', () => {
  it('commits capacitor and reserves a round when a cycle starts [FUNC-9.4, FUNC-22.11]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(fixture);
    const before = capacitorOf(fixture);
    const rounds = loadedRounds(fixture, fixture.playerId);

    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    const cycle = weapon(fixture).cycle;
    expect(cycle?.reservedRounds).toBe(1);
    expect(cycle?.targetId).toBe(fixture.targetId);
    expect(cycle?.ammunitionId).toBe(FUSION);
    // The autocannon costs no capacitor, so the commitment is recorded as zero
    // rather than omitted, and the magazine is untouched until the shot lands.
    expect(cycle?.committedCapacitor).toBe(0);
    expect(capacitorOf(fixture)).toBe(before - (cycle?.committedCapacitor ?? 0));
    expect(loadedRounds(fixture, fixture.playerId)).toBe(rounds);
  });

  it('applies the shot at the end of the cycle and consumes the round [FUNC-9.4, FUNC-9.5]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(fixture);
    const rounds = loadedRounds(fixture, fixture.playerId);

    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    advance(fixture, 2500);

    const shots = fixture.context.events.filter((event) => event.kind === 'combat.shotResolved');
    expect(shots).toHaveLength(1);
    expect(shots[0]?.params?.['targetId']).toBe(fixture.targetId);
    expect(shots[0]?.params?.['moduleId']).toBe(AUTOCANNON);
    expect(loadedRounds(fixture, fixture.playerId)).toBe(rounds - 1);
    // The weapon is still repeating, so the next cycle has already started.
    expect(weapon(fixture).cycle).not.toBeNull();
  });

  it('lets the running cycle finish after deactivation but starts no other [FUNC-9.4]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    deactivateWeapon(fixture.context, fixture.playerId, WEAPON);
    expect(weapon(fixture).repeating).toBe(false);
    expect(weapon(fixture).cycle).not.toBeNull();

    advance(fixture, 2500);

    expect(fixture.context.events.filter((event) => event.kind === 'combat.shotResolved'))
      .toHaveLength(1);
    expect(weapon(fixture).cycle).toBeNull();

    advance(fixture, 5000);
    expect(fixture.context.events.filter((event) => event.kind === 'combat.shotResolved'))
      .toHaveLength(1);
  });

  it('fires no shot and keeps the round when the lock breaks mid-cycle [FUNC-9.4, FUNC-22.11]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(fixture);
    const rounds = loadedRounds(fixture, fixture.playerId);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    const committed = weapon(fixture).cycle?.committedCapacitor ?? 0;
    const capacitor = capacitorOf(fixture);

    releaseLock(fixture.context, fixture.playerId, fixture.targetId);
    advance(fixture, 3000);

    expect(fixture.context.events.filter((event) => event.kind === 'combat.shotResolved'))
      .toHaveLength(0);
    expect(loadedRounds(fixture, fixture.playerId)).toBe(rounds);
    expect(capacitorOf(fixture)).toBe(capacitor);
    expect(committed).toBe(0);
  });

  it('spends the capacitor a cycle costs when the cycle starts [FUNC-9.4]', () => {
    const fixture = railgunFixture();
    lockTarget(fixture);
    const cost = fixture.content.module(RAILGUN)?.activation?.capacitorPerCycle ?? 0;
    const before = capacitorOf(fixture);

    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    expect(cost).toBeGreaterThan(0);
    expect(weapon(fixture).cycle?.committedCapacitor).toBe(cost);
    expect(capacitorOf(fixture)).toBe(before - cost);
  });

  it('uses continuous regeneration when the next weapon cycle starts [FUNC-9.4, FUNC-9.8]', () => {
    const fixture = railgunFixture();
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    ship.condition.capacitorCharge = 0;
    advance(fixture, 3200);

    expect(fixture.context.events.filter((event) => event.kind === 'combat.shotResolved'))
      .toHaveLength(1);
    expect(weapon(fixture).repeating).toBe(true);
    expect(weapon(fixture).cycle?.committedCapacitor).toBe(4);
    expect(weapon(fixture).stopReason).toBeNull();
  });

  it('refuses activation the capacitor could not pay for [FUNC-9.4, FUNC-22.10]', () => {
    const fixture = railgunFixture();
    lockTarget(fixture);
    fixture.draft.assets.ships[fixture.playerId]!.condition.capacitorCharge = 0;

    expect(activateRefusal(rulesOf(fixture), WEAPON, fixture.targetId))
      .toBe('weaponInsufficientCapacitor');
  });

  it('abandons the cycle in flight when the weapon is re-aimed [FUNC-9.4, FUNC-22.11]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    const site = fixture.draft.navigation.currentSite;
    if (site === null) throw new Error('The fixture has no site.');
    const second = 'c000000000000000000000000-e200';
    site.objects[second] = { ...site.objects[fixture.targetId]!, id: second, position: { x: 2, y: 2 } };

    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    beginLock(fixture.context, fixture.playerId, second);
    advance(fixture, 3000);

    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    const rounds = loadedRounds(fixture, fixture.playerId);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, second);

    expect(weapon(fixture).cycle?.targetId).toBe(second);
    expect(loadedRounds(fixture, fixture.playerId)).toBe(rounds);

    releaseLock(fixture.context, fixture.playerId, fixture.targetId);
    advance(fixture, 2500);

    const shots = fixture.context.events.filter((event) => event.kind === 'combat.shotResolved');
    expect(shots).toHaveLength(1);
    expect(shots[0]?.params?.['targetId']).toBe(second);
  });

  it('refuses activation without a completed lock [FUNC-9.4, FUNC-22.10]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });

    expect(activateRefusal(rulesOf(fixture), WEAPON, fixture.targetId)).toBe('lockNotHeld');
    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    expect(activateRefusal(rulesOf(fixture), WEAPON, fixture.targetId)).toBe('lockNotHeld');
    advance(fixture, 3000);
    expect(activateRefusal(rulesOf(fixture), WEAPON, fixture.targetId)).toBeNull();
  });

  it('refuses a slot that holds no online turret [FUNC-9.4]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(fixture);

    expect(activateRefusal(rulesOf(fixture), { kind: 'weapon', index: 1 }, fixture.targetId))
      .toBe('weaponSlotUnavailable');
  });

  it('resolves two cycles due at the same instant in scheduler order [TECH-9.2, TECH-9.5]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 }, armTarget: true });
    lockTarget(fixture);
    beginLock(fixture.context, fixture.targetId, fixture.playerId);
    advance(fixture, 3000);

    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    activateWeapon(fixture.context, fixture.targetId, WEAPON, fixture.playerId);
    advance(fixture, 2500);

    const shots = fixture.context.events.filter((event) => event.kind === 'combat.shotResolved');
    expect(shots).toHaveLength(2);
    expect(shots.map((shot) => shot.params?.['attackerId'])).toEqual([
      fixture.playerId,
      fixture.targetId,
    ]);
  });
});

describe('reloading', () => {
  it('tops the magazine up from cargo after the reload time [FUNC-9.4]', () => {
    const fixture = combatFixture({
      targetPositionKm: { x: 2, y: 0 },
      playerCargoRounds: [{ ammunitionId: FUSION, rounds: 40 }],
    });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    advance(fixture, 2500);
    expect(loadedRounds(fixture, fixture.playerId)).toBe(19);

    deactivateWeapon(fixture.context, fixture.playerId, WEAPON);
    advance(fixture, 2500);
    expect(reloadRefusal(rulesOf(fixture), WEAPON)).toBeNull();

    requestReload(fixture.context, fixture.playerId, WEAPON, FUSION, false);
    expect(weapon(fixture).reload).not.toBeNull();
    advance(fixture, 5000);

    expect(weapon(fixture).reload).toBeNull();
    expect(loadedRounds(fixture, fixture.playerId)).toBe(20);
    expect(eventKinds(fixture)).toContain('combat.reloadCompleted');
  });

  it('refuses a reload with a full magazine or with nothing to load [FUNC-9.4]', () => {
    const full = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    expect(reloadRefusal(rulesOf(full), WEAPON)).toBe('weaponMagazineFull');

    const empty = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(empty);
    activateWeapon(empty.context, empty.playerId, WEAPON, empty.targetId);
    advance(empty, 2500);
    expect(reloadRefusal(rulesOf(empty), WEAPON)).toBe('weaponNoAmmunition');
  });

  it('begins a reload only after the running cycle completes [FUNC-9.4]', () => {
    const fixture = combatFixture({
      targetPositionKm: { x: 2, y: 0 },
      playerCargoRounds: [{ ammunitionId: FUSION, rounds: 40 }],
    });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    requestReload(fixture.context, fixture.playerId, WEAPON, FUSION, false);
    expect(weapon(fixture).pendingReload).not.toBeNull();
    expect(weapon(fixture).reload).toBeNull();
    expect(weapon(fixture).cycle).not.toBeNull();

    advance(fixture, 2500);

    expect(weapon(fixture).pendingReload).toBeNull();
    expect(weapon(fixture).reload).not.toBeNull();
    expect(fixture.context.events.filter((event) => event.kind === 'combat.shotResolved'))
      .toHaveLength(1);
  });

  it('reloads automatically when the magazine empties and resumes firing [FUNC-9.4]', () => {
    const fixture = combatFixture({
      targetPositionKm: { x: 2, y: 0 },
      playerCargoRounds: [{ ammunitionId: FUSION, rounds: 40 }],
    });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    // Twenty cycles empty the magazine; the weapon then reloads itself.
    advance(fixture, 20 * 2500);

    expect(weapon(fixture).repeating).toBe(true);
    expect(eventKinds(fixture)).toContain('combat.reloadStarted');
    advance(fixture, 5000);
    expect(loadedRounds(fixture, fixture.playerId)).toBeGreaterThan(0);
  });

  it('stops with an exhausted magazine when no ammunition remains [FUNC-9.4]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    advance(fixture, 21 * 2500);

    expect(weapon(fixture).repeating).toBe(false);
    expect(weapon(fixture).stopReason).toBe('ammunitionExhausted');
  });

  it('unloads the magazine into cargo before changing ammunition [FUNC-9.4]', () => {
    const fixture = combatFixture({
      targetPositionKm: { x: 2, y: 0 },
      playerCargoRounds: [{ ammunitionId: PHASED, rounds: 20 }],
    });
    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    const cargoOf = (definitionId: string): number =>
      stacksIn(fixture.draft.assets, ship.cargoInventoryId)
        .filter((stack) => stack.definitionId === definitionId)
        .reduce((total, stack) => total + stack.quantity, 0);

    // The starting campaign grants phased rounds only through this fixture, so
    // the hangar has none and the change must draw on the hold.
    expect(changeAmmunitionRefusal(rulesOf(fixture), WEAPON, PHASED)).toBeNull();
    requestReload(fixture.context, fixture.playerId, WEAPON, PHASED, true);

    expect(cargoOf(FUSION)).toBe(20);
    advance(fixture, 5000);

    expect(loadedRounds(fixture, fixture.playerId)).toBe(20);
    expect(cargoOf(PHASED)).toBe(0);
    expect(weapon(fixture).lastAmmunitionId).toBe(PHASED);
    expect(eventKinds(fixture)).toContain('combat.ammunitionChanged');
  });

  it('refuses an incompatible charge and one the ship does not carry [FUNC-9.4]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });

    expect(changeAmmunitionRefusal(rulesOf(fixture), WEAPON, 'ammo.hybrid.small.iron' as typeof PHASED))
      .toBe('weaponAmmunitionIncompatible');
    expect(changeAmmunitionRefusal(rulesOf(fixture), WEAPON, PHASED)).toBe('weaponNoAmmunition');
  });
});

describe('leaving the site', () => {
  it('drops the locks and cycles a completed docking ends [FUNC-9.2, FUNC-7.4, TECH-10.1]', () => {
    const fixture = combatFixture({
      siteId: STATION_SITE_ID,
      playerPositionKm: { x: 0.5, y: 0 },
      targetPositionKm: { x: 3, y: 0 },
    });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);

    // The docking state machine is the shipped one: approaching, then the
    // scheduled completion that unloads the site.
    fixture.draft.navigation.movement = null;
    fixture.draft.navigation.travel = {
      kind: 'dock',
      phase: 'approaching',
      stationId: fixture.content.rules.economy.startingStationId as never,
      boundaryEntryId: null,
    };
    advance(fixture, 4000);

    expect(fixture.draft.assets.location.kind).toBe('station');
    expect(fixture.draft.combat.ships[fixture.playerId]).toBeUndefined();
    expect(
      fixture.draft.scheduler.entries.filter((entry) => entry.ownerId === fixture.playerId),
    ).toHaveLength(0);
  });

  it('drops every lock, cycle and boundary the ship held [FUNC-9.2, TECH-10.1]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(fixture);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    expect(fixture.draft.scheduler.entries.length).toBeGreaterThan(0);

    clearCombat(fixture.context, fixture.playerId);

    expect(fixture.draft.combat.ships[fixture.playerId]).toBeUndefined();
    expect(
      fixture.draft.scheduler.entries.filter((entry) => entry.ownerId === fixture.playerId),
    ).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('replays the same shots from the same seed and commands [TECH-9.5]', () => {
    const outcomes = (): readonly (string | number | boolean)[] => {
      const fixture = combatFixture({ targetPositionKm: { x: 4, y: 0 } });
      lockTarget(fixture);
      activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
      advance(fixture, 12_000);
      return fixture.context.events
        .filter((event) => event.kind === 'combat.shotResolved')
        .map((event) => `${String(event.params?.['hit'])}:${String(event.params?.['totalDamage'])}`);
    };

    const first = outcomes();
    expect(first.length).toBeGreaterThan(1);
    expect(outcomes()).toEqual(first);
  });

  it('takes no random draw and no round for a refused action [TECH-9.4]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    const drawIndex = fixture.draft.random.combat.drawIndex;
    const rounds = loadedRounds(fixture, fixture.playerId);

    // Activating without a lock is refused before anything is committed.
    expect(activateRefusal(rulesOf(fixture), WEAPON, fixture.targetId)).toBe('lockNotHeld');

    expect(fixture.draft.random.combat.drawIndex).toBe(drawIndex);
    expect(loadedRounds(fixture, fixture.playerId)).toBe(rounds);
  });

  it('draws once for a miss and three times at most for a hit [TECH-9.4, FUNC-9.5]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    lockTarget(fixture);
    const before = fixture.draft.random.combat.drawIndex;

    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    advance(fixture, 2500);

    const drawn = fixture.draft.random.combat.drawIndex - before;
    expect(drawn).toBeGreaterThanOrEqual(1);
    expect(drawn).toBeLessThanOrEqual(3);
  });
});
