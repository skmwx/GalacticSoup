import { describe, expect, it } from 'vitest';

import {
  activateModuleRefusal,
  attributeValue,
  campaignStateHash,
  combatantOf,
  readCampaignState,
  setMovementOrder,
  shipCombat,
  speedEffectsOn,
  validateCampaign,
  type CampaignDraft,
  type CampaignState,
  type SlotRef,
} from '@engine/domain';
import { combatProjection } from '@engine/projections';
import { INSTALLED_BOUNDARY_RESOLVERS, INSTALLED_CONTINUOUS_SYSTEMS } from '@engine/application';
import {
  activateModule,
  advanceTime,
  beginLock,
  deactivateModule,
  releaseLock,
} from '@engine/simulation';
import type { ModuleId } from '@shared';

import { testSimulation } from '../support/campaign.ts';
import { advance, combatFixture, type CombatFixture } from '../support/combat.ts';

/**
 * The web from cycle start to expiry, through the shipped rules and content
 * (Functional Specification 9.9; FeatureSpec02 6.3; Technical Specification
 * 9.2, 10.3).
 *
 * The small web costs 5 capacitor per 5 s cycle, reaches 10 km and removes
 * half of its target's maximum speed for one cycle after each completed
 * cycle. Every scenario drives it through the same operations the command
 * handler and the opponent adapter use, and the projection is read through
 * the same predicates the interface reads.
 */

const WEB = 'module.web.small' as ModuleId;
const SYSTEM_0: SlotRef = { kind: 'system', index: 0 };
const SYSTEM_1: SlotRef = { kind: 'system', index: 1 };
const LOCK_MS = 3000;
const CYCLE_MS = 5000;
/** The starter hull's unmodified maximum speed (content/catalog/hulls). */
const STARTER_SPEED = 0.32;

function webFixture(targetKm = 6, webs: readonly ModuleId[] = [WEB]): CombatFixture {
  return combatFixture({
    targetPositionKm: { x: targetKm, y: 0 },
    playerSystemModules: webs,
  });
}

function lock(fixture: CombatFixture, from = fixture.playerId, to = fixture.targetId): void {
  beginLock(fixture.context, from, to);
  advance(fixture, LOCK_MS);
}

function events(fixture: CombatFixture, kind: string) {
  return fixture.context.events.filter((event) => event.kind === kind);
}

function maxSpeed(fixture: CombatFixture, shipId: string): number {
  const combatant = combatantOf(fixture.draft, fixture.content, shipId);
  if (combatant === null) throw new Error(`No combatant ${shipId}.`);
  return attributeValue(combatant.derived, 'maxSpeedKmPerSecond');
}

function capacitor(fixture: CombatFixture, shipId = fixture.playerId): number {
  return fixture.draft.assets.ships[shipId]?.condition.capacitorCharge ?? 0;
}

function valid(fixture: CombatFixture): void {
  expect(validateCampaign(fixture.draft as CampaignState, fixture.content)).toEqual([]);
}

describe('web cycle, application and refusal', () => {
  it('pays at cycle start and applies half speed to the locked target at completion [FUNC-9.9, V02-AC-07]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    const before = capacitor(fixture);
    expect(activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId)).toBe(true);
    // Capacitor is committed when the cycle starts; nothing is applied yet.
    expect(capacitor(fixture)).toBeCloseTo(before - 5, 6);
    expect(speedEffectsOn(fixture.draft, fixture.targetId)).toHaveLength(0);

    advance(fixture, CYCLE_MS);
    const effects = speedEffectsOn(fixture.draft, fixture.targetId);
    expect(effects).toHaveLength(1);
    expect(effects[0]?.speedFactor).toBe(0.5);
    expect(effects[0]?.sourceShipId).toBe(fixture.playerId);
    expect(effects[0]?.sourceSlotKey).toBe('system:0');
    expect(maxSpeed(fixture, fixture.targetId)).toBeCloseTo(STARTER_SPEED * 0.5, 9);
    // The web lowers maximum speed only; the source is untouched.
    expect(maxSpeed(fixture, fixture.playerId)).toBeCloseTo(STARTER_SPEED, 9);
    valid(fixture);
  });

  it('refuses to start without a lock or out of range, and spends nothing [FUNC-9.9, TECH-12.3, V02-AC-07]', () => {
    const near = webFixture(6);
    const rules = { state: near.draft, content: near.content };
    // No lock is held yet: the command handler's predicate refuses.
    expect(activateModuleRefusal(rules, SYSTEM_0, near.targetId)).toBe('lockNotHeld');

    const far = webFixture(14);
    lock(far);
    const before = capacitor(far);
    expect(activateModuleRefusal({ state: far.draft, content: far.content }, SYSTEM_0, far.targetId))
      .toBe('moduleOutOfRange');
    // An opponent issuing the operation anyway is stopped at the cycle start,
    // which spends nothing (Functional Specification 9.9).
    activateModule(far.context, far.playerId, SYSTEM_0, far.targetId);
    expect(capacitor(far)).toBeCloseTo(before, 6);
    expect(shipCombat(far.draft, far.playerId).modules['system:0']?.stopReason).toBe('outOfRange');
    expect(far.draft.combat.speedEffects).toHaveLength(0);
    valid(far);
  });

  it('applies nothing and refunds nothing when range is lost before completion [FUNC-9.9, V02-AC-07]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    const paid = capacitor(fixture);
    // The target is moved beyond 10 km while the cycle runs.
    fixture.draft.navigation.currentSite!.objects[fixture.targetId] = {
      ...fixture.draft.navigation.currentSite!.objects[fixture.targetId]!,
      position: { x: 12, y: 0 },
    };
    advance(fixture, CYCLE_MS);

    expect(fixture.draft.combat.speedEffects).toHaveLength(0);
    const completed = events(fixture, 'combat.moduleCycleCompleted');
    expect(completed.at(-1)?.params?.['applied']).toBe(false);
    // The next cycle cannot start out of range, so the web stops and says why.
    expect(shipCombat(fixture.draft, fixture.playerId).modules['system:0']?.stopReason).toBe('outOfRange');
    expect(capacitor(fixture)).toBeGreaterThanOrEqual(paid - 1e-9);
    valid(fixture);
  });

  it('stops later applications when the lock is lost; an applied effect runs out its time [FUNC-9.9, V02-AC-07]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS);
    const applied = speedEffectsOn(fixture.draft, fixture.targetId)[0];
    expect(applied).toBeDefined();

    releaseLock(fixture.context, fixture.playerId, fixture.targetId);
    expect(shipCombat(fixture.draft, fixture.playerId).modules['system:0']?.repeating ?? false).toBe(false);
    // The running cycle completes without applying, and the earlier effect
    // lasts until its own expiry.
    advance(fixture, CYCLE_MS - 100);
    expect(speedEffectsOn(fixture.draft, fixture.targetId)).toHaveLength(1);
    expect(speedEffectsOn(fixture.draft, fixture.targetId)[0]?.expiresAtMs).toBe(applied!.expiresAtMs);
    advance(fixture, 200);
    expect(fixture.draft.combat.speedEffects).toHaveLength(0);
    expect(events(fixture, 'combat.speedEffectExpired').at(-1)?.params?.['reason']).toBe('expired');
    expect(maxSpeed(fixture, fixture.targetId)).toBeCloseTo(STARTER_SPEED, 9);
    valid(fixture);
  });
});

describe('refresh, multiple sources and the floor', () => {
  it('refreshes its own effect each cycle, winning the tie with expiry, and never stacks with itself [FUNC-4.2, FUNC-9.9, TECH-9.2, V02-AC-07]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS);
    const first = speedEffectsOn(fixture.draft, fixture.targetId)[0]!;

    // Each refresh is due exactly as the previous application expires.
    for (let cycle = 0; cycle < 4; cycle += 1) {
      advance(fixture, CYCLE_MS);
      const effects = speedEffectsOn(fixture.draft, fixture.targetId);
      expect(effects).toHaveLength(1);
      expect(effects[0]?.id).toBe(first.id);
      expect(effects[0]?.expiresAtMs).toBe(first.expiresAtMs + (cycle + 1) * CYCLE_MS);
      expect(maxSpeed(fixture, fixture.targetId)).toBeCloseTo(STARTER_SPEED * 0.5, 9);
    }
    expect(events(fixture, 'combat.speedEffectExpired')).toHaveLength(0);
    expect(events(fixture, 'combat.speedEffectApplied').filter((event) => event.params?.['refreshed'] === true))
      .toHaveLength(4);
    // The recorder keeps one aggregated entry, not one per cycle.
    expect(fixture.draft.combat.events.filter((event) => event.kind === 'control')).toHaveLength(1);
    valid(fixture);
  });

  it('multiplies the effects of different sources [FUNC-9.9, V02-AC-07]', () => {
    const fixture = webFixture(6, [WEB, WEB]);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    activateModule(fixture.context, fixture.playerId, SYSTEM_1, fixture.targetId);
    advance(fixture, CYCLE_MS);

    expect(speedEffectsOn(fixture.draft, fixture.targetId)).toHaveLength(2);
    expect(maxSpeed(fixture, fixture.targetId)).toBeCloseTo(STARTER_SPEED * 0.25, 9);
    // The trace names each effect as its own step.
    const combatant = combatantOf(fixture.draft, fixture.content, fixture.targetId)!;
    const steps = combatant.derived.attributes['maxSpeedKmPerSecond']?.steps ?? [];
    expect(steps.filter((step) => step.sourceId === WEB)).toHaveLength(2);
    valid(fixture);
  });

  it('never takes a ship below 10% of its hull speed [FUNC-9.9, V02-AC-07]', () => {
    const fixture = webFixture(6, [WEB, WEB]);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    activateModule(fixture.context, fixture.playerId, SYSTEM_1, fixture.targetId);
    advance(fixture, CYCLE_MS);
    // A third, stronger source pushes the product below the floor.
    const effects = fixture.draft.combat.speedEffects as { speedFactor: number }[];
    effects[0]!.speedFactor = 0.2;
    effects[1]!.speedFactor = 0.2;

    expect(maxSpeed(fixture, fixture.targetId)).toBeCloseTo(STARTER_SPEED * 0.1, 9);
    const projected = combatProjection(fixture.draft as CampaignState, fixture.content);
    const target = projected.targetDefenses.find((defense) => defense.shipId === fixture.targetId)!;
    expect(target.speed.atFloor).toBe(true);
    expect(target.speed.floorKmPerSecond).toBeCloseTo(STARTER_SPEED * 0.1, 9);
    expect(target.speed.unaffectedMaximumKmPerSecond).toBeCloseTo(STARTER_SPEED, 9);
  });
});

describe('movement and the end of an effect', () => {
  it('slows the target through its normal braking rather than instantly [FUNC-9.9, TECH-9.3, V02-AC-07]', () => {
    const fixture = webFixture(6);
    // The target flies away from the player at full speed.
    setMovementOrder(fixture.draft, fixture.targetId, { kind: 'moveToPoint', point: { x: 9.5, y: 40 } });
    advance(fixture, 6000);
    const speedOf = (): number => Math.hypot(
      fixture.draft.navigation.currentSite!.objects[fixture.targetId]!.velocity.x,
      fixture.draft.navigation.currentSite!.objects[fixture.targetId]!.velocity.y,
    );
    expect(speedOf()).toBeGreaterThan(STARTER_SPEED * 0.9);

    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS);
    expect(speedEffectsOn(fixture.draft, fixture.targetId)).toHaveLength(1);
    // Braking at 0.16 km/s2 takes about one second to shed 0.16 km/s.
    const justAfter = speedOf();
    expect(justAfter).toBeGreaterThan(STARTER_SPEED * 0.5 + 0.01);
    advance(fixture, 2000);
    expect(speedOf()).toBeLessThanOrEqual(STARTER_SPEED * 0.5 + 1e-6);
  });

  it('ends every effect on a ship that is destroyed [FUNC-9.9, TECH-10.1, V02-AC-07]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS);
    expect(fixture.draft.combat.speedEffects).toHaveLength(1);

    const target = combatantOf(fixture.draft, fixture.content, fixture.targetId)!;
    fixture.draft.assets.ships[fixture.targetId]!.condition.damage.hull =
      attributeValue(target.derived, 'hullHitPoints');
    advance(fixture, 100);
    expect(shipCombat(fixture.draft, fixture.targetId).destroyedAtMs).not.toBeNull();
    expect(fixture.draft.combat.speedEffects).toHaveLength(0);
    expect(fixture.draft.scheduler.entries.some((entry) => entry.kind === 'combat.speedEffectExpiry')).toBe(false);
    // The web stops for want of a target rather than retrying.
    expect(shipCombat(fixture.draft, fixture.playerId).modules['system:0']?.repeating ?? false).toBe(false);
  });

  it('keeps an effect, attributed to its source, after the source is destroyed [FUNC-9.9, TECH-8.2, V02-AC-07]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 6, y: 0 }, targetSystemModule: WEB });
    lock(fixture, fixture.targetId, fixture.playerId);
    expect(activateModule(fixture.context, fixture.targetId, SYSTEM_0, fixture.playerId)).toBe(true);
    advance(fixture, CYCLE_MS);
    const effect = speedEffectsOn(fixture.draft, fixture.playerId)[0];
    expect(effect?.sourceShipId).toBe(fixture.targetId);

    const source = combatantOf(fixture.draft, fixture.content, fixture.targetId)!;
    fixture.draft.assets.ships[fixture.targetId]!.condition.damage.hull =
      attributeValue(source.derived, 'hullHitPoints');
    advance(fixture, 100);
    expect(shipCombat(fixture.draft, fixture.targetId).destroyedAtMs).not.toBeNull();

    // The effect on the player runs out its time and keeps naming its source.
    const projected = combatProjection(fixture.draft as CampaignState, fixture.content);
    const own = projected.defenses!.speedEffects[0];
    expect(own?.sourceId).toBe(fixture.targetId);
    expect(own?.sourcePresent).toBe(false);
    expect(maxSpeed(fixture, fixture.playerId)).toBeCloseTo(STARTER_SPEED * 0.5, 9);
    advance(fixture, CYCLE_MS);
    expect(fixture.draft.combat.speedEffects).toHaveLength(0);
    expect(maxSpeed(fixture, fixture.playerId)).toBeCloseTo(STARTER_SPEED, 9);
  });

  it('waits for capacitor when starved and lets the effect lapse [FUNC-9.8, FUNC-9.9, V02-AC-07]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS - 100);
    // The capacitor is emptied before the next cycle would start.
    fixture.draft.assets.ships[fixture.playerId]!.condition.capacitorCharge = 0;
    advance(fixture, 200);

    const runtime = shipCombat(fixture.draft, fixture.playerId).modules['system:0'];
    expect(runtime?.waitingForCapacitor).toBe(true);
    expect(runtime?.repeating).toBe(true);
    expect(events(fixture, 'combat.moduleWaiting')).toHaveLength(1);
    // Five seconds of recharge is under one cycle's cost, so the effect lapses.
    advance(fixture, CYCLE_MS);
    expect(fixture.draft.combat.speedEffects).toHaveLength(0);
    valid(fixture);
  });

  it('stops cycling on command; an applied effect lasts until it expires [FUNC-9.9, V02-AC-07]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS);
    // The second cycle is already paid for, so it completes and refreshes
    // once more; nothing starts after it (Functional Specification 9.4, 9.9).
    deactivateModule(fixture.context, fixture.playerId, SYSTEM_0);
    advance(fixture, CYCLE_MS + 100);
    expect(fixture.draft.combat.speedEffects).toHaveLength(1);
    expect(shipCombat(fixture.draft, fixture.playerId).modules['system:0']?.cycle ?? null).toBeNull();
    advance(fixture, CYCLE_MS - 200);
    expect(fixture.draft.combat.speedEffects).toHaveLength(1);
    advance(fixture, 200);
    expect(fixture.draft.combat.speedEffects).toHaveLength(0);
    expect(shipCombat(fixture.draft, fixture.playerId).modules['system:0']).toMatchObject({
      repeating: false,
      cycle: null,
      stopReason: 'deactivated',
    });
  });
});

describe('projection and resume', () => {
  it('explains source, strength, remaining time and the resulting speed limit [FUNC-9.9, FUNC-19.6, V02-AC-07]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS + 1000);

    const projected = combatProjection(fixture.draft as CampaignState, fixture.content);
    const module = projected.modules.find((entry) => entry.moduleId === WEB)!;
    expect(module.targeted).toBe(true);
    expect(module.targetId).toBe(fixture.targetId);
    expect(module.effect.kind).toBe('web');
    expect(module.effect.values['speedReductionFraction']).toBe(0.5);
    expect(module.targets).toEqual([expect.objectContaining({ targetId: fixture.targetId, withinRange: true })]);
    expect(module.cycle?.targetId).toBe(fixture.targetId);

    const target = projected.targetDefenses.find((defense) => defense.shipId === fixture.targetId)!;
    expect(target.speedEffects).toHaveLength(1);
    expect(target.speedEffects[0]).toMatchObject({
      sourceId: fixture.playerId,
      fromPlayer: true,
      sourcePresent: true,
      speedFactor: 0.5,
      moduleId: WEB,
    });
    expect(target.speedEffects[0]?.remainingSeconds).toBeCloseTo(4, 6);
    expect(target.speed.maximumKmPerSecond).toBeCloseTo(STARTER_SPEED * 0.5, 9);
    expect(target.speed.unaffectedMaximumKmPerSecond).toBeCloseTo(STARTER_SPEED, 9);
    expect(target.speed.trace.formulaKey).toBe('combat.formula.speedLimit');
    expect(projected.events.some((event) => event.kind === 'control')).toBe(true);
  });

  it('reopens mid-effect and mid-cycle and reaches the same state as uninterrupted play [FUNC-9.9, TECH-9.5, TECH-11.4, V02-AC-07, V02-AC-13]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS + 2500);
    expect(fixture.draft.combat.speedEffects).toHaveLength(1);
    expect(shipCombat(fixture.draft, fixture.playerId).modules['system:0']?.cycle).not.toBeNull();

    const restored = readCampaignState(JSON.parse(JSON.stringify(fixture.draft)) as unknown);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(campaignStateHash(restored.state)).toBe(campaignStateHash(fixture.draft as CampaignState));
    expect(validateCampaign(restored.state, fixture.content)).toEqual([]);

    const resumedDraft = restored.state as unknown as CampaignDraft;
    const resumed: CombatFixture = { ...fixture, draft: resumedDraft, context: testSimulation(resumedDraft, fixture.content) };
    advance(fixture, 12_000);
    advance(resumed, 12_000);
    expect(campaignStateHash(resumed.draft as CampaignState)).toBe(campaignStateHash(fixture.draft as CampaignState));
    expect(resumed.draft.combat.speedEffects).toEqual(fixture.draft.combat.speedEffects);
  });

  it('changes nothing while paused [FUNC-3.3, FUNC-9.9, V02-AC-13]', () => {
    const fixture = webFixture(6);
    lock(fixture);
    activateModule(fixture.context, fixture.playerId, SYSTEM_0, fixture.targetId);
    advance(fixture, CYCLE_MS + 1000);
    fixture.draft.time.paused = true;
    const before = campaignStateHash(fixture.draft as CampaignState);
    const effect = fixture.draft.combat.speedEffects[0];
    // The fixture's own advance unpauses, so the paused clock is asked directly.
    for (let frame = 0; frame < 40; frame += 1) {
      advanceTime(fixture.context, 250, INSTALLED_BOUNDARY_RESOLVERS, INSTALLED_CONTINUOUS_SYSTEMS);
    }
    expect(campaignStateHash(fixture.draft as CampaignState)).toBe(before);
    expect(fixture.draft.combat.speedEffects[0]).toEqual(effect);
  });
});
