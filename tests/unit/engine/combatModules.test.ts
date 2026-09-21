import { describe, expect, it } from 'vitest';

import {
  activeModuleState,
  attributeValue,
  combatantOf,
  shipCombat,
  weaponState,
  type SlotRef,
} from '@engine/domain';
import {
  activateModule,
  activateWeapon,
  beginLock,
  deactivateModule,
} from '@engine/simulation';
import { combatProjection } from '@engine/projections';

import {
  advance,
  AFTERBURNER,
  ARMOR_PLATING,
  CAPACITOR_BATTERY,
  combatFixture,
  eventKinds,
  FIRST_WEAPON,
  type CombatFixture,
} from '../../support/combat.ts';

const BOOSTER: SlotRef = { kind: 'system', index: 0 };
const BOOSTER_KEY = 'system:0';
const WEAPON: SlotRef = { kind: 'weapon', index: 0 };

function booster(fixture: CombatFixture) {
  return activeModuleState(shipCombat(fixture.draft, fixture.playerId), BOOSTER_KEY);
}

describe('active module lifecycle', () => {
  it('pays at cycle start, repairs at completion and repeats [FUNC-9.7, FUNC-9.8, MVP-AC-04]', () => {
    const fixture = combatFixture({ armTarget: false });
    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    ship.condition.damage.shield = 100;
    const capacitor = ship.condition.capacitorCharge;

    expect(activateModule(fixture.context, fixture.playerId, BOOSTER)).toBe(true);
    expect(booster(fixture).cycle?.committedCapacitor).toBe(15);
    expect(ship.condition.capacitorCharge).toBe(capacitor - 15);

    advance(fixture, 4_000);

    // Continuous shield regeneration and the 40-point booster both apply.
    expect(ship.condition.damage.shield).toBeLessThan(60);
    expect(booster(fixture).repeating).toBe(true);
    expect(booster(fixture).cycle).not.toBeNull();
    expect(eventKinds(fixture)).toContain('combat.repairApplied');
    expect(fixture.draft.combat.events.some((event) => event.kind === 'repair')).toBe(true);
  });

  it('waits without paying and starts when regeneration reaches the full cost [FUNC-9.8]', () => {
    const fixture = combatFixture({ armTarget: false });
    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    ship.condition.capacitorCharge = 0;

    activateModule(fixture.context, fixture.playerId, BOOSTER);
    expect(booster(fixture).waitingForCapacitor).toBe(true);
    expect(booster(fixture).cycle).toBeNull();

    advance(fixture, 11_950);
    expect(booster(fixture).waitingForCapacitor).toBe(true);
    expect(booster(fixture).cycle).toBeNull();

    advance(fixture, 50);
    expect(booster(fixture).waitingForCapacitor).toBe(false);
    expect(booster(fixture).cycle?.committedCapacitor).toBe(15);
    expect(booster(fixture).cycle?.startedAtMs).toBe(12_000);
    expect(booster(fixture).cycle?.completesAtMs).toBe(16_000);
    expect(ship.condition.capacitorCharge).toBe(0);
  });

  it('lets a paid cycle finish after deactivation and starts no next cycle [FUNC-9.8, FUNC-22.11]', () => {
    const fixture = combatFixture({ armTarget: false });
    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    ship.condition.damage.shield = 100;

    activateModule(fixture.context, fixture.playerId, BOOSTER);
    deactivateModule(fixture.context, fixture.playerId, BOOSTER);
    expect(booster(fixture).repeating).toBe(false);
    expect(booster(fixture).cycle).not.toBeNull();

    advance(fixture, 4_000);
    expect(booster(fixture).cycle).toBeNull();
    expect(booster(fixture).stopReason).toBe('deactivated');
    expect(eventKinds(fixture).filter((kind) => kind === 'combat.repairApplied')).toHaveLength(1);
  });

  it('applies propulsion only while a paid cycle is active [FUNC-9.8, TECH-10.2]', () => {
    const fixture = combatFixture({
      armTarget: false,
      playerSystemModule: AFTERBURNER,
    });
    const before = combatantOf(fixture.draft, fixture.content, fixture.playerId)!;
    const baseSpeed = attributeValue(before.derived, 'maxSpeedKmPerSecond');

    activateModule(fixture.context, fixture.playerId, BOOSTER);
    const active = combatantOf(fixture.draft, fixture.content, fixture.playerId)!;
    expect(attributeValue(active.derived, 'maxSpeedKmPerSecond')).toBeCloseTo(baseSpeed * 1.75);

    deactivateModule(fixture.context, fixture.playerId, BOOSTER);
    advance(fixture, 10_000);
    const stopped = combatantOf(fixture.draft, fixture.content, fixture.playerId)!;
    expect(attributeValue(stopped.derived, 'maxSpeedKmPerSecond')).toBeCloseTo(baseSpeed);
  });
});

describe('combat module projections', () => {
  it('publishes passive resistance and capacitor-support tradeoffs [FUNC-8.5, FUNC-9.7, FUNC-9.8]', () => {
    const platingFixture = combatFixture({
      armTarget: false,
      playerEngineeringModule: ARMOR_PLATING,
    });
    const plating = combatProjection(platingFixture.draft, platingFixture.content);
    const projectedPlating = plating.modules.find((module) => module.moduleId === ARMOR_PLATING);
    const armor = plating.defenses?.layers.find((layer) => layer.layer === 'armor');

    expect(projectedPlating).toMatchObject({
      passive: true,
      status: 'passive',
      commands: [],
      effect: { kind: 'resistance', layer: 'armor' },
    });
    expect(armor?.resistances['explosive']).toBeCloseTo(0.19);
    expect(armor?.resistanceTraces['explosive']?.operands.length).toBeGreaterThan(1);

    const batteryFixture = combatFixture({
      armTarget: false,
      playerEngineeringModule: CAPACITOR_BATTERY,
    });
    const battery = combatProjection(batteryFixture.draft, batteryFixture.content);
    const projectedBattery = battery.modules.find((module) => module.moduleId === CAPACITOR_BATTERY);

    expect(projectedBattery).toMatchObject({
      passive: true,
      status: 'passive',
      effect: { kind: 'capacitorSupport', baseValue: 250, activeValue: 370 },
    });
    expect(battery.capacitor?.capacity).toBe(370);
    expect(battery.capacitor?.capacityTrace.operands.length).toBeGreaterThan(1);
  });
});

describe('damage and completion ordering', () => {
  it('resolves a committed repair before damage due at the same instant [TECH-9.2, FUNC-9.7]', () => {
    const fixture = combatFixture({
      playerPositionKm: { x: 0, y: 0 },
      targetPositionKm: { x: 0, y: 0 },
      armTarget: true,
    });
    beginLock(fixture.context, fixture.targetId, fixture.playerId);
    advance(fixture, 1_500);
    activateModule(fixture.context, fixture.playerId, BOOSTER);
    advance(fixture, 1_500);
    activateWeapon(fixture.context, fixture.targetId, WEAPON, fixture.playerId);
    fixture.draft.assets.ships[fixture.playerId]!.condition.damage.shield = 100;

    advance(fixture, 2_500);

    const completions = eventKinds(fixture).filter(
      (kind) => kind === 'combat.repairApplied' || kind === 'combat.damageApplied',
    );
    expect(completions).toEqual(['combat.repairApplied', 'combat.damageApplied']);
  });

  it('applies turret damage through defenses and records its significant aggregate [FUNC-9.7, TECH-10.3]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 1, y: 0 }, armTarget: false });
    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    advance(fixture, 3_000);
    const before = fixture.draft.assets.ships[fixture.targetId]!.condition.damage.shield;

    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    advance(fixture, 2_500);

    expect(fixture.draft.assets.ships[fixture.targetId]!.condition.damage.shield).toBeGreaterThan(before);
    const damage = fixture.draft.combat.events.find((event) => event.kind === 'damage');
    expect(damage?.kind).toBe('damage');
    if (damage?.kind === 'damage') {
      expect(damage.targetId).toBe(fixture.targetId);
      expect(damage.count).toBe(1);
    }
  });

  it('resolves simultaneous fire before destruction and starts no post-destruction cycle [TECH-9.2, FUNC-9.7]', () => {
    const fixture = combatFixture({
      playerPositionKm: { x: 0, y: 0 },
      targetPositionKm: { x: 0, y: 0 },
      armTarget: true,
    });
    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    beginLock(fixture.context, fixture.targetId, fixture.playerId);
    advance(fixture, 3_000);

    for (const shipId of [fixture.playerId, fixture.targetId]) {
      const ship = fixture.draft.assets.ships[shipId]!;
      ship.condition.damage = { shield: 350, armor: 300, hull: 249 };
    }
    expect(activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId)).toBe(true);
    expect(activateWeapon(fixture.context, fixture.targetId, WEAPON, fixture.playerId)).toBe(true);
    expect(weaponState(shipCombat(fixture.draft, fixture.playerId), FIRST_WEAPON).cycle?.completesAtMs)
      .toBe(5_500);
    expect(weaponState(shipCombat(fixture.draft, fixture.targetId), FIRST_WEAPON).cycle?.completesAtMs)
      .toBe(5_500);

    advance(fixture, 2_500);

    expect(eventKinds(fixture).filter((kind) => kind === 'combat.shotResolved')).toHaveLength(2);
    expect(eventKinds(fixture).filter((kind) => kind === 'combat.shipDestroyed')).toHaveLength(2);
    expect(shipCombat(fixture.draft, fixture.playerId).destroyedAtMs).toBe(5_500);
    expect(shipCombat(fixture.draft, fixture.targetId).destroyedAtMs).toBe(5_500);
    expect(weaponState(shipCombat(fixture.draft, fixture.playerId), FIRST_WEAPON).cycle).toBeNull();
    expect(weaponState(shipCombat(fixture.draft, fixture.targetId), FIRST_WEAPON).cycle).toBeNull();
  });
});
