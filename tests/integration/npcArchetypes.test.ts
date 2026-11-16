import { describe, expect, it } from 'vitest';

import {
  activeModuleState,
  movementOrderOf,
  shipCombat,
  shipFit,
  speedEffectsOn,
  validateCampaign,
  type CampaignState,
} from '@engine/domain';
import { isWeaponModule, type ContentRepository } from '@engine/ports';

import { editDocument, fixtureRepository, shippedPack } from '../support/contentFixtures.ts';
import { advanceDraft, command, destroyPlayer, fixtureOf, inSite, newCampaign, stateOf, type LossFixture } from '../support/loss.ts';

/**
 * The five enemy archetypes in small encounters (FeatureSpec02 7.1; Functional
 * Specification 9.10; Technical Specification 10.3).
 *
 * Each scenario puts one shipped profile, alone, at the Scout's site and lets
 * the shipped opponent adapter fly it against a stationary starter ship. The
 * assertions are about behaviour a player can see - the order it flies, the
 * range it holds, the modules it runs - so two archetypes cannot pass by
 * differing only in name or hit points. Every opponent fits only legal,
 * authored equipment and pays for it from its own capacitor and hold.
 */

const SCOUT_ENCOUNTER = 'encounter.borrell.pirate-scout';

/** The shipped content with the Scout's site spawning one other profile. */
function contentWith(profileId: string, spawnDistanceKm = 14): ContentRepository {
  const files = editDocument(shippedPack(), 'encounters/templates/borrell.json', (document) => {
    const definitions = document['definitions'] as { id: string; spawns: unknown[] }[];
    const scout = definitions.find((definition) => definition.id === SCOUT_ENCOUNTER);
    if (scout === undefined) throw new Error('The shipped content has no Scout encounter.');
    scout.spawns = [{ npcProfileId: profileId, count: 1, spawnDistanceKm }];
  });
  return fixtureRepository(files);
}

interface Engagement {
  readonly fixture: LossFixture;
  readonly npcId: string;
}

function engage(profileId: string, seconds: number, spawnDistanceKm = 14): Engagement {
  const content = contentWith(profileId, spawnDistanceKm);
  const fixture = inSite(newCampaign(undefined, content), { content });
  const npc = fixture.draft.encounter.active?.npcs[0];
  if (npc === undefined || npc.profileId !== profileId) throw new Error(`${profileId} did not spawn.`);
  advanceDraft(fixture.draft, fixture.context, seconds * 1000, fixture.content);
  return { fixture, npcId: npc.shipId };
}

function rangeKm({ fixture, npcId }: Engagement): number {
  const objects = fixture.draft.navigation.currentSite!.objects;
  const a = objects[npcId]!.position;
  const b = objects[fixture.playerId]!.position;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eventsFrom({ fixture, npcId }: Engagement, kind: string, field = 'shipId') {
  return fixture.context.events.filter((event) => event.kind === kind && event.params?.[field] === npcId);
}

function categoriesRun(engagement: Engagement): ReadonlySet<string> {
  const { fixture } = engagement;
  return new Set(eventsFrom(engagement, 'combat.moduleCycleStarted')
    .map((event) => fixture.content.module(String(event.params?.['moduleId']))?.category ?? ''));
}

function legal(engagement: Engagement): void {
  expect(validateCampaign(engagement.fixture.draft as CampaignState, engagement.fixture.content)).toEqual([]);
}

describe('the five archetypes behave differently', () => {
  it('a fast close-range frigate burns in and orbits tight with small turrets [FUNC-9.10, V02-AC-08]', () => {
    const engagement = engage('npc.pirate.cutter', 30);
    const order = movementOrderOf(engagement.fixture.draft, engagement.npcId);
    expect(order?.kind).toBe('orbit');
    expect(order !== null && 'distanceKm' in order ? order.distanceKm : 99).toBeLessThan(5);
    expect(categoriesRun(engagement).has('propulsion')).toBe(true);
    expect(rangeKm(engagement)).toBeLessThan(8);
    expect(eventsFrom(engagement, 'combat.shotResolved', 'attackerId').length).toBeGreaterThan(0);
    legal(engagement);
  });

  it('a slow artillery ship keeps long range with low transverse motion [FUNC-9.10, V02-AC-08]', () => {
    const engagement = engage('npc.pirate.gunlayer', 30, 6);
    const order = movementOrderOf(engagement.fixture.draft, engagement.npcId);
    expect(order?.kind).toBe('keepRange');
    expect(order !== null && 'distanceKm' in order ? order.distanceKm : 0).toBeGreaterThan(8);
    // It opened the range from where it spawned instead of closing it.
    expect(rangeKm(engagement)).toBeGreaterThan(6);
    expect(eventsFrom(engagement, 'combat.shotResolved', 'attackerId').length).toBeGreaterThan(0);
    legal(engagement);
  });

  it('a tanky brawler closes and runs its repairer under fire [FUNC-9.10, V02-AC-08]', () => {
    const engagement = engage('npc.pirate.warden', 20);
    const { fixture, npcId } = engagement;
    expect(movementOrderOf(fixture.draft, npcId)?.kind).toBe('approach');
    // Damage its armour: the next decision runs the repairer it carries.
    fixture.draft.assets.ships[npcId]!.condition.damage.armor = 150;
    advanceDraft(fixture.draft, fixture.context, 8000, fixture.content);
    expect(categoriesRun(engagement).has('armorRepairer')).toBe(true);
    expect(fixture.context.events.some((event) =>
      event.kind === 'combat.repairApplied' && event.params?.['shipId'] === npcId)).toBe(true);
    legal(engagement);
  });

  it('a missile ship holds its flight range and launches guided volleys [FUNC-9.6, FUNC-9.10, V02-AC-08]', () => {
    for (const profileId of ['npc.pirate.lancer', 'npc.pirate.bombard']) {
      // 13 km: the Missile Picket already spawns a lancer at 14 km.
      const engagement = engage(profileId, 40, 13);
      expect(eventsFrom(engagement, 'combat.projectileLaunched', 'sourceId').length).toBeGreaterThan(0);
      expect(rangeKm(engagement)).toBeGreaterThan(5);
      legal(engagement);
    }
  });

  it('a web controller orbits inside its web range and slows the player [FUNC-9.9, FUNC-9.10, V02-AC-07, V02-AC-08]', () => {
    const engagement = engage('npc.pirate.binder', 30);
    const { fixture, npcId } = engagement;
    const order = movementOrderOf(fixture.draft, npcId);
    expect(order?.kind).toBe('orbit');
    expect(order !== null && 'distanceKm' in order ? order.distanceKm : 99).toBeLessThanOrEqual(10);
    expect(rangeKm(engagement)).toBeLessThan(10);
    const effects = speedEffectsOn(fixture.draft, fixture.playerId);
    expect(effects).toHaveLength(1);
    expect(effects[0]?.sourceShipId).toBe(npcId);
    expect(fixture.context.events.some((event) =>
      event.kind === 'combat.speedEffectApplied' && event.params?.['targetId'] === fixture.playerId &&
      event.params?.['refreshed'] === false)).toBe(true);
    legal(engagement);
  });

  it('pays for everything it runs from its own capacitor and hold [FUNC-9.10, TECH-10.3, V02-AC-08]', () => {
    const engagement = engage('npc.pirate.snare', 40);
    const { fixture, npcId } = engagement;
    const fit = shipFit(fixture.draft.assets, npcId);
    const combat = shipCombat(fixture.draft, npcId);
    const web = fit.find((slot) => fixture.content.module(slot.moduleId)?.category === 'web');
    expect(web).toBeDefined();
    // Its web runs through the ordinary module runtime, cycle by paid cycle.
    expect(eventsFrom(engagement, 'combat.moduleCycleStarted')
      .some((event) => event.params?.['moduleId'] === 'module.web.small')).toBe(true);
    expect(activeModuleState(combat, `${web!.slot.kind}:${String(web!.slot.index)}`).cycle?.committedCapacitor ?? 5)
      .toBeGreaterThan(0);
    // Its guns fire only what it carried: loaded rounds have gone down.
    const loaded = fit.filter((slot) => {
      const module = fixture.content.module(slot.moduleId);
      return module !== undefined && isWeaponModule(module);
    }).reduce((total, slot) => total + (slot.charge?.quantity ?? 0), 0);
    expect(loaded).toBeLessThan(2 * 140);
    legal(engagement);
  });
});

describe('a web in the loss report', () => {
  it('names the web that was holding the ship when it was destroyed [FUNC-9.9, FUNC-9.12, TECH-10.3, V02-AC-07]', () => {
    const engagement = engage('npc.pirate.binder', 30);
    const { fixture } = engagement;
    expect(speedEffectsOn(fixture.draft, fixture.playerId)).toHaveLength(1);

    destroyPlayer(fixture);
    const loss = fixture.draft.recovery.lastLoss;
    expect(loss?.disablingEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'speedReduced', moduleId: 'module.web.small' }),
    ]));
    // The site is gone, and with it every effect.
    expect(fixture.draft.combat.speedEffects).toHaveLength(0);
    expect(validateCampaign(fixture.draft as CampaignState, fixture.content)).toEqual([]);
  });
});

describe('a web never traps the player', () => {
  it('retreats by warp while webbed [FUNC-9.9, FUNC-9.11, V02-AC-07, V02-AC-12]', () => {
    const engagement = engage('npc.pirate.binder', 30);
    const { fixture } = engagement;
    expect(speedEffectsOn(fixture.draft, fixture.playerId)).toHaveLength(1);

    const retreating = command(stateOf(fixture), 'navigation.retreat', {}, fixture.content).state;
    const after = fixtureOf(retreating, fixture.content);
    advanceDraft(after.draft, after.context, 60_000, after.content);
    expect(after.draft.assets.location.kind === 'warp' || after.draft.navigation.currentSite?.siteId !== 'site.borrell.verge')
      .toBe(true);
    // Leaving the site ends every effect on the ship.
    expect(after.draft.combat.speedEffects).toHaveLength(0);
  });
});
