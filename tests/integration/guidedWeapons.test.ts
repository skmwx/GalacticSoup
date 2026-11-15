import { describe, expect, it } from 'vitest';

import {
  attributeValue,
  campaignStateHash,
  combatantOf,
  compatibleCargoAmmunition,
  guidedApplication,
  readCampaignState,
  shipCombat,
  shipFit,
  stacksIn,
  validateCampaign,
  weaponContext,
  type CampaignDraft,
  type CampaignState,
  type SlotRef,
} from '@engine/domain';
import {
  activateWeapon,
  beginLock,
  PROJECTILE_IMPACT_BOUNDARY,
  releaseLock,
  scheduleBoundary,
} from '@engine/simulation';
import type { AmmunitionId, ModuleId, SiteId } from '@shared';

import { testSimulation } from '../support/campaign.ts';
import { advance, combatFixture, FUSION, type CombatFixture } from '../support/combat.ts';
import { advanceDraft, inSite, newCampaign } from '../support/loss.ts';

/**
 * Guided weapons from launch to impact, through the shipped rules and content
 * (Functional Specification 9.4, 9.6; Technical Specification 9.2, 10.3;
 * FeatureSpec02 6.2).
 *
 * A launcher's cycle ends in a launch: the round is consumed then and a
 * projectile record carries the launch parameters to the target. Damage
 * lands only on contact, using the guided formula and the target's signature
 * and speed at that instant. Each scenario below is one lifecycle boundary
 * the feature specification names.
 */

const LAUNCHER = 'module.launcher.guided.small' as ModuleId;
const KINETIC = 'ammo.guided.small.kinetic' as AmmunitionId;
const THERMAL = 'ammo.guided.small.thermal' as AmmunitionId;
const WEAPON: SlotRef = { kind: 'weapon', index: 0 };
const LOCK_MS = 3000;
const CYCLE_MS = 6000;

function guidedFixture(targetKm = 5, rounds = 8): CombatFixture {
  return combatFixture({
    targetPositionKm: { x: targetKm, y: 0 },
    playerTurret: { moduleId: LAUNCHER, ammunitionId: KINETIC, rounds },
    playerCargoRounds: [
      { ammunitionId: KINETIC, rounds: 16 },
      { ammunitionId: FUSION, rounds: 20 },
    ],
  });
}

function lockAndFire(fixture: CombatFixture): void {
  beginLock(fixture.context, fixture.playerId, fixture.targetId);
  advance(fixture, LOCK_MS);
  expect(activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId)).toBe(true);
}

function loaded(fixture: CombatFixture, shipId: string = fixture.playerId): number {
  const ship = fixture.draft.assets.ships[shipId];
  if (ship === undefined) return 0;
  return stacksIn(fixture.draft.assets, ship.fittingInventoryId)
    .filter((stack) => stack.state.kind === 'charge')
    .reduce((total, stack) => total + stack.quantity, 0);
}

function events(fixture: CombatFixture, kind: string) {
  return fixture.context.events.filter((event) => event.kind === kind);
}

function damageOf(fixture: CombatFixture, shipId: string): number {
  const damage = fixture.draft.assets.ships[shipId]?.condition.damage;
  return damage === undefined ? 0 : damage.shield + damage.armor + damage.hull;
}

function stopWeapon(fixture: CombatFixture): void {
  // Deactivating lets the running cycle finish but starts no new one, so a
  // scenario follows exactly one projectile.
  const combat = fixture.draft.combat.ships[fixture.playerId] as { weapons: Record<string, { repeating: boolean }> };
  const runtime = combat.weapons['weapon:0'];
  if (runtime !== undefined) runtime.repeating = false;
}

describe('guided launch and impact', () => {
  it('launches at cycle end and applies damage only on contact [FUNC-9.4, FUNC-9.6, TECH-10.3, V02-AC-06]', () => {
    const fixture = guidedFixture(5);
    lockAndFire(fixture);
    stopWeapon(fixture);
    expect(loaded(fixture)).toBe(8);

    advance(fixture, CYCLE_MS);
    // The round is consumed at launch and the projectile is in flight; the
    // target has not yet been touched.
    expect(fixture.draft.combat.projectiles).toHaveLength(1);
    expect(loaded(fixture)).toBe(7);
    expect(events(fixture, 'combat.projectileLaunched')).toHaveLength(1);
    expect(damageOf(fixture, fixture.targetId)).toBe(0);
    expect(events(fixture, 'combat.shotResolved')).toHaveLength(0);

    // 5 km at 2.5 km/s is two seconds of flight.
    advance(fixture, 2500);
    expect(fixture.draft.combat.projectiles).toHaveLength(0);
    const impact = events(fixture, 'combat.projectileImpact')[0];
    expect(impact).toBeDefined();

    // The application is the functional formula on the target at impact: a
    // 38 m stationary starter hull against a 40 m explosion.
    const rules = fixture.content.rules.combat;
    const expected = guidedApplication({
      explosionRadiusMetres: 40,
      explosionVelocityKmPerSecond: 0.2,
      targetSignatureMetres: 38,
      targetSpeedKmPerSecond: 0,
    }, rules);
    expect(expected.signatureFactor).toBeCloseTo(0.95, 12);
    expect(expected.speedFactor).toBe(1);
    expect(impact?.params?.['damageMultiplier']).toBeCloseTo(expected.damageMultiplier, 12);
    expect(impact?.params?.['totalDamage']).toBeCloseTo(30 * 0.95, 9);
    expect(damageOf(fixture, fixture.targetId)).toBeGreaterThan(0);
    expect(validateCampaign(fixture.draft as CampaignState, fixture.content)).toEqual([]);
  });

  it('misses when flight time runs out before contact [FUNC-9.6, V02-AC-06]', () => {
    // Six seconds at 2.5 km/s reaches 15 km; the target is further away.
    const fixture = guidedFixture(20);
    lockAndFire(fixture);
    stopWeapon(fixture);
    advance(fixture, CYCLE_MS);
    expect(fixture.draft.combat.projectiles).toHaveLength(1);

    advance(fixture, 7000);
    expect(fixture.draft.combat.projectiles).toHaveLength(0);
    expect(events(fixture, 'combat.projectileImpact')).toHaveLength(0);
    expect(events(fixture, 'combat.projectileRemoved').map((event) => event.params?.['reason'])).toEqual(['expired']);
    expect(damageOf(fixture, fixture.targetId)).toBe(0);
    // The round was spent at launch and is not refunded.
    expect(loaded(fixture)).toBe(7);
    expect(fixture.draft.scheduler.entries.some((entry) => entry.kind.startsWith('combat.projectile'))).toBe(false);
  });

  it('resolves contact first when contact and expiry fall at the same instant [FUNC-4.2, FUNC-9.6, TECH-9.2, V02-AC-06]', () => {
    const fixture = guidedFixture(14);
    lockAndFire(fixture);
    stopWeapon(fixture);
    advance(fixture, CYCLE_MS);
    const projectile = fixture.draft.combat.projectiles[0];
    if (projectile === undefined) throw new Error('No projectile was launched.');

    // Pin contact to the expiry instant: both boundaries are now due together.
    const impact = scheduleBoundary(fixture.draft, {
      kind: PROJECTILE_IMPACT_BOUNDARY,
      dueAtMs: projectile.expiresAtMs,
      priority: 45,
      ownerId: projectile.id,
    });
    (fixture.draft.combat.projectiles as { impactBoundaryEntryId: string | null }[])[0]!.impactBoundaryEntryId =
      impact.entryId;

    advance(fixture, 6100);
    expect(events(fixture, 'combat.projectileImpact')).toHaveLength(1);
    expect(events(fixture, 'combat.projectileRemoved')).toHaveLength(0);
    expect(fixture.draft.scheduler.entries.some((entry) => entry.ownerId === projectile.id)).toBe(false);
  });
});

describe('guided lifecycle edges', () => {
  it('launches nothing and keeps the round loaded when the lock breaks before the cycle ends [FUNC-9.4, V02-AC-06]', () => {
    const fixture = guidedFixture(5);
    lockAndFire(fixture);
    releaseLock(fixture.context, fixture.playerId, fixture.targetId);
    advance(fixture, CYCLE_MS + 1000);

    expect(fixture.draft.combat.projectiles).toHaveLength(0);
    expect(events(fixture, 'combat.projectileLaunched')).toHaveLength(0);
    expect(loaded(fixture)).toBe(8);
  });

  it('needs no lock once launched: releasing the lock does not stop the projectile [FUNC-9.6, V02-AC-06]', () => {
    const fixture = guidedFixture(5);
    lockAndFire(fixture);
    stopWeapon(fixture);
    advance(fixture, CYCLE_MS);
    releaseLock(fixture.context, fixture.playerId, fixture.targetId);
    advance(fixture, 2500);

    expect(events(fixture, 'combat.projectileImpact')).toHaveLength(1);
  });

  it('removes a projectile without damage or refund when its target is destroyed in flight [FUNC-9.6, TECH-10.1, V02-AC-06]', () => {
    const fixture = guidedFixture(10);
    lockAndFire(fixture);
    stopWeapon(fixture);
    advance(fixture, CYCLE_MS);
    expect(fixture.draft.combat.projectiles).toHaveLength(1);

    // Destroy the target by other means while the round is in flight.
    const target = combatantOf(fixture.draft, fixture.content, fixture.targetId);
    const ship = fixture.draft.assets.ships[fixture.targetId]!;
    ship.condition.damage.hull = attributeValue(target!.derived, 'hullHitPoints');
    advance(fixture, 100);

    expect(shipCombat(fixture.draft, fixture.targetId).destroyedAtMs).not.toBeNull();
    expect(fixture.draft.combat.projectiles).toHaveLength(0);
    expect(events(fixture, 'combat.projectileRemoved').map((event) => event.params?.['reason'])).toEqual(['targetMissing']);
    advance(fixture, 5000);
    expect(events(fixture, 'combat.projectileImpact')).toHaveLength(0);
    expect(loaded(fixture)).toBe(7);
  });

  it('still hits, attributed to its source, after the source is destroyed [FUNC-9.6, TECH-8.2, V02-AC-06]', () => {
    const fixture = guidedFixture(5);
    lockAndFire(fixture);
    stopWeapon(fixture);
    advance(fixture, CYCLE_MS);
    expect(fixture.draft.combat.projectiles).toHaveLength(1);

    const source = combatantOf(fixture.draft, fixture.content, fixture.playerId);
    fixture.draft.assets.ships[fixture.playerId]!.condition.damage.hull =
      attributeValue(source!.derived, 'hullHitPoints');
    advance(fixture, 2500);

    expect(shipCombat(fixture.draft, fixture.playerId).destroyedAtMs).not.toBeNull();
    const impact = events(fixture, 'combat.projectileImpact')[0];
    expect(impact?.params?.['attackerId']).toBe(fixture.playerId);
    const recorded = fixture.draft.combat.events.find(
      (event) => event.kind === 'damage' && event.targetId === fixture.targetId,
    );
    expect(recorded?.kind === 'damage' && recorded.sourceId).toBe(fixture.playerId);
  });

  it('keeps launcher and turret charges apart: a launcher reloads only guided rounds [FUNC-9.4, TECH-8.3, V02-AC-06]', () => {
    const fixture = guidedFixture(5);
    const combatant = combatantOf(fixture.draft, fixture.content, fixture.playerId)!;
    const weapon = weaponContext({ state: fixture.draft, content: fixture.content }, combatant, WEAPON)!;
    // The hold carries fusion turret rounds and kinetic guided rounds.
    expect(compatibleCargoAmmunition({ state: fixture.draft, content: fixture.content }, combatant, weapon))
      .toEqual([KINETIC]);
  });
});

describe('opponents and resume', () => {
  it('lets an opponent launch at the player through the same commands [FUNC-9.6, FUNC-9.10, TECH-10.3, V02-AC-06]', () => {
    const fixture = combatFixture({
      targetPositionKm: { x: 6, y: 0 },
      targetWeapon: { moduleId: LAUNCHER, ammunitionId: THERMAL, rounds: 8 },
    });
    beginLock(fixture.context, fixture.targetId, fixture.playerId);
    advance(fixture, LOCK_MS);
    expect(activateWeapon(fixture.context, fixture.targetId, WEAPON, fixture.playerId)).toBe(true);
    advance(fixture, CYCLE_MS + 3000);

    const impacts = events(fixture, 'combat.projectileImpact');
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts[0]?.params?.['targetId']).toBe(fixture.playerId);
    expect(damageOf(fixture, fixture.playerId)).toBeGreaterThan(0);
    expect(loaded(fixture, fixture.targetId)).toBeLessThan(8);
  });

  it('sends the Missile Picket\'s lancer to keep its flight range and launch at the player [FUNC-9.10, TECH-10.3, V02-AC-06]', () => {
    const fixture = inSite(newCampaign(), { siteId: 'site.borrell.signal-spire' as SiteId });
    const npc = fixture.draft.encounter.active?.npcs[0];
    expect(npc?.profileId).toBe('npc.pirate.lancer');
    const lancerId = npc!.shipId;
    // Each launcher carries its own guided charge from the per-weapon loadout.
    const lancerFit = shipFit(fixture.draft.assets, lancerId);
    expect(lancerFit.filter((slot) => slot.charge?.ammunitionId === 'ammo.guided.small.kinetic')).toHaveLength(2);

    advanceDraft(fixture.draft, fixture.context, 40_000, fixture.content);

    const launched = fixture.context.events.filter((event) =>
      event.kind === 'combat.projectileLaunched' && event.params?.['sourceId'] === lancerId);
    expect(launched.length).toBeGreaterThan(0);
    expect(fixture.context.events.some((event) =>
      event.kind === 'combat.projectileImpact' && event.params?.['targetId'] === fixture.playerId)).toBe(true);
    // It holds back near its guided reach instead of closing to turret range.
    const site = fixture.draft.navigation.currentSite!;
    const range = Math.hypot(
      site.objects[lancerId]!.position.x - site.objects[fixture.playerId]!.position.x,
      site.objects[lancerId]!.position.y - site.objects[fixture.playerId]!.position.y,
    );
    expect(range).toBeGreaterThan(6);
    expect(validateCampaign(fixture.draft as CampaignState, fixture.content)).toEqual([]);
  });

  it('reopens mid-flight and reaches the same state as uninterrupted play [FUNC-9.6, TECH-9.5, TECH-11.4, V02-AC-06, V02-AC-13]', () => {
    const fixture = guidedFixture(9);
    lockAndFire(fixture);
    advance(fixture, CYCLE_MS + 800);
    expect(fixture.draft.combat.projectiles.length).toBeGreaterThan(0);

    const restored = readCampaignState(JSON.parse(JSON.stringify(fixture.draft)) as unknown);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(campaignStateHash(restored.state)).toBe(campaignStateHash(fixture.draft as CampaignState));
    expect(validateCampaign(restored.state, fixture.content)).toEqual([]);

    const resumedDraft = restored.state as unknown as CampaignDraft;
    const resumed: CombatFixture = { ...fixture, draft: resumedDraft, context: testSimulation(resumedDraft, fixture.content) };
    advance(fixture, 9000);
    advance(resumed, 9000);

    expect(campaignStateHash(resumed.draft as CampaignState)).toBe(campaignStateHash(fixture.draft as CampaignState));
    expect(damageOf(resumed, resumed.targetId)).toBe(damageOf(fixture, fixture.targetId));
    expect(loaded(resumed)).toBe(loaded(fixture));
  });
});
