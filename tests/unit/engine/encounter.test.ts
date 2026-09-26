import { describe, expect, it } from 'vitest';

import {
  activeModuleState,
  attributeValue,
  bountyGrantId,
  campaignStateHash,
  combatantOf,
  completionCount,
  deriveShipAttributes,
  distance,
  isEncounterState,
  movementOrderOf,
  setDestroyedAt,
  shipFit,
  validateCampaign,
  weaponState,
  type CampaignDraft,
  type CampaignState,
} from '@engine/domain';
import {
  abandonEncounter,
  advanceEncounter,
  instantiateEncounter,
  planNpcFit,
} from '@engine/simulation';

import {
  advance,
  encounterFixture,
  eventKinds,
  opponentIds,
  PATROL_SITE_ID,
  SCOUT_ENCOUNTER_ID,
  SCOUT_SITE_ID,
} from '../../support/encounter.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * The encounter lifecycle and its opponents
 * (Functional Specification 9.10-9.11, 18; Technical Specification 10.3, 10.6).
 */

const content = shippedContent();

/** Destroys one opponent the way combat does: hull to zero, then the batch. */
function destroy(fixture: ReturnType<typeof encounterFixture>, shipId: string): void {
  const combatant = combatantOf(fixture.draft, fixture.content, shipId);
  if (combatant === null) throw new Error(`No combatant ${shipId}.`);
  const ship = fixture.draft.assets.ships[shipId];
  if (ship === undefined) throw new Error(`No ship ${shipId}.`);
  ship.condition.damage.hull = attributeValue(combatant.derived, 'hullHitPoints');
  setDestroyedAt(fixture.draft, shipId, fixture.draft.time.simulationTimeMs);
  advanceEncounter(fixture.context, fixture.draft.time.simulationTimeMs, fixture.draft.time.simulationTimeMs);
}

describe('encounter instantiation', () => {
  it('spawns exactly the authored opponents with their authored fits [FUNC-9.10, TECH-10.6, MVP-AC-05]', () => {
    const fixture = encounterFixture({ siteId: PATROL_SITE_ID });
    const instance = fixture.draft.encounter.active;

    expect(instance?.encounterId).toBe('encounter.borrell.pirate-patrol');
    expect(instance?.status).toBe('active');
    expect(instance?.objective).toEqual({ kind: 'destroyGroup', destroyed: 0, required: 3 });

    const profiles = instance?.npcs.map((npc) => npc.profileId);
    expect(profiles).toEqual(['npc.pirate.cutter', 'npc.pirate.cutter', 'npc.pirate.marksman']);

    for (const shipId of opponentIds(fixture)) {
      const ship = fixture.draft.assets.ships[shipId];
      expect(ship?.owner).toBe('npc');
      expect(fixture.draft.navigation.currentSite?.objects[shipId]?.kind).toBe('ship');
      const fit = shipFit(fixture.draft.assets, shipId);
      expect(fit.length).toBeGreaterThan(0);
      // Every turret leaves the yard loaded, exactly as a player's does.
      for (const fitted of fit) {
        if (content.module(fitted.moduleId)?.category === 'turret') {
          expect(fitted.charge?.quantity).toBeGreaterThan(0);
        }
      }
    }
    expect(validateCampaign(fixture.draft as CampaignState, content)).toEqual([]);
  });

  it('spawns at the authored distance and produces a fresh formation each time [FUNC-9.10]', () => {
    const first = encounterFixture();
    const second = encounterFixture();
    // The seeded campaigns are identical, so a second instance inside the same
    // campaign is what must differ, not two separate campaigns.
    abandonEncounter(second.context);
    instantiateEncounter(second.context, SCOUT_SITE_ID);

    const positionOf = (fixture: ReturnType<typeof encounterFixture>): { x: number; y: number } => {
      const shipId = opponentIds(fixture)[0] ?? '';
      const object = fixture.draft.navigation.currentSite?.objects[shipId];
      if (object === undefined) throw new Error('No opponent object.');
      return object.position;
    };

    expect(distance({ x: 0, y: 0 }, positionOf(first))).toBeCloseTo(12, 6);
    expect(distance({ x: 0, y: 0 }, positionOf(second))).toBeCloseTo(12, 6);
    expect(positionOf(first)).not.toEqual(positionOf(second));
  });

  it('assigns each authored module the next slot of its own kind [FUNC-8.3, FUNC-9.10]', () => {
    const hull = content.requireHull('hull.pirate.raider' as never);
    const profile = content.requireNpcProfile('npc.pirate.warden' as never);
    const planned = planNpcFit(content, hull, profile);

    expect(planned.map((entry) => `${entry.slot.kind}:${String(entry.slot.index)}`)).toEqual([
      'weapon:0',
      'weapon:1',
      'system:0',
      'engineering:0',
      'engineering:1',
    ]);
    // Only turrets receive the authored charge.
    expect(planned.filter((entry) => entry.ammunitionId !== null)).toHaveLength(2);
  });
});

describe('the opponent command adapter', () => {
  it('locks, fires and holds its role range using ordinary commands [FUNC-9.10, TECH-10.3, MVP-AC-05]', () => {
    const fixture = encounterFixture();
    const shipId = opponentIds(fixture)[0] ?? '';

    // A decision is scheduled immediately on arrival, so the first quantum
    // already produces an order rather than a silent drift.
    advance(fixture, 100);
    const order = movementOrderOf(fixture.draft, shipId);
    expect(order?.kind).toBe('orbit');
    expect(order !== null && 'distanceKm' in order ? order.distanceKm : 0).toBeCloseTo(3, 6);

    advance(fixture, 20_000);
    const combatant = combatantOf(fixture.draft, fixture.content, shipId);
    expect(combatant?.combat.locks.map((lock) => lock.targetId)).toEqual([fixture.playerId]);
    expect(weaponState(combatant!.combat, 'weapon:0').repeating).toBe(true);
    expect(eventKinds(fixture)).toContain('combat.weaponActivated');

    // The player takes damage from an opponent that only ever issued the
    // commands the player also has.
    const player = fixture.draft.assets.ships[fixture.playerId];
    expect((player?.condition.damage.shield ?? 0) + (player?.condition.damage.armor ?? 0)).toBeGreaterThan(0);
  });

  it('runs its propulsion only while it is outside its band [FUNC-9.10]', () => {
    const fixture = encounterFixture();
    const shipId = opponentIds(fixture)[0] ?? '';

    advance(fixture, 200);
    // It spawns 12 km out and wants 3 km, so it burns to close.
    expect(activeModuleState(fixture.draft.combat.ships[shipId]!, 'system:0').repeating).toBe(true);

    advance(fixture, 120_000);
    const object = fixture.draft.navigation.currentSite?.objects[shipId];
    const player = fixture.draft.navigation.currentSite?.objects[fixture.playerId];
    if (object === undefined || player === undefined) throw new Error('The site lost a ship.');
    expect(distance(object.position, player.position)).toBeLessThan(6);
    expect(activeModuleState(fixture.draft.combat.ships[shipId]!, 'system:0').repeating).toBe(false);
  });

  it('stops deciding once it is destroyed [FUNC-22.5]', () => {
    const fixture = encounterFixture();
    const shipId = opponentIds(fixture)[0] ?? '';
    advance(fixture, 2_000);

    destroy(fixture, shipId);

    expect(fixture.draft.scheduler.entries.some((entry) => entry.ownerId === shipId)).toBe(false);
    expect(fixture.draft.assets.ships[shipId]).toBeUndefined();
    expect(validateCampaign(fixture.draft as CampaignState, content)).toEqual([]);
  });
});

describe('encounter resolution', () => {
  it('pays each bounty once and completes when the group is gone [FUNC-9.11, TECH-10.6, MVP-AC-06]', () => {
    const fixture = encounterFixture();
    const before = fixture.draft.assets.credits;
    const shipId = opponentIds(fixture)[0] ?? '';

    destroy(fixture, shipId);

    expect(fixture.draft.assets.credits).toBe(before + 3000);
    expect(fixture.draft.encounter.active?.status).toBe('completed');
    expect(fixture.draft.encounter.active?.bountyCreditsPaid).toBe(3000);
    expect(completionCount(fixture.draft as CampaignState, SCOUT_ENCOUNTER_ID)).toBe(1);
    expect(eventKinds(fixture)).toContain('encounter.completed');

    // A replayed settlement at the same timestamp cannot pay twice.
    const grantId = bountyGrantId(shipId);
    expect(fixture.draft.encounter.active?.grantedRewardIds).toEqual([
      grantId,
      `completion.${fixture.draft.encounter.active?.instanceId ?? ''}`,
    ]);
    advanceEncounter(fixture.context, 0, 0);
    expect(fixture.draft.assets.credits).toBe(before + 3000);
    expect(completionCount(fixture.draft as CampaignState, SCOUT_ENCOUNTER_ID)).toBe(1);
  });

  it('needs every opponent before it completes [MVP-AC-05]', () => {
    const fixture = encounterFixture({ siteId: PATROL_SITE_ID });
    const [first, second] = opponentIds(fixture);

    destroy(fixture, first ?? '');
    expect(fixture.draft.encounter.active?.status).toBe('active');
    expect(fixture.draft.encounter.active?.objective.destroyed).toBe(1);

    destroy(fixture, second ?? '');
    expect(fixture.draft.encounter.active?.status).toBe('active');

    destroy(fixture, opponentIds(fixture)[2] ?? '');
    expect(fixture.draft.encounter.active?.status).toBe('completed');
  });

  it('abandons an unfinished instance and keeps the wrecks it left [FUNC-9.11, FUNC-5.4, MVP-AC-08]', () => {
    const fixture = encounterFixture({ siteId: PATROL_SITE_ID });
    const [first] = opponentIds(fixture);
    destroy(fixture, first ?? '');
    const wreckCount = Object.keys(fixture.draft.encounter.wrecks).length;

    abandonEncounter(fixture.context);

    expect(fixture.draft.encounter.active).toBeNull();
    expect(fixture.draft.encounter.lastOutcome).toEqual({
      encounterId: 'encounter.borrell.pirate-patrol',
      status: 'abandoned',
      resolvedAtMs: 0,
      bountyCreditsPaid: content.requireNpcProfile('npc.pirate.cutter' as never).bountyCredits,
      npcsDestroyed: 1,
      npcsTotal: 3,
    });
    expect(completionCount(fixture.draft as CampaignState, 'encounter.borrell.pirate-patrol')).toBe(0);
    // The site keeps the wreck; the opponents that survived leave with the
    // instance rather than following the player.
    expect(Object.keys(fixture.draft.encounter.wrecks)).toHaveLength(wreckCount);
    expect(Object.values(fixture.draft.assets.ships).every((ship) => ship.owner === 'player')).toBe(true);
    expect(validateCampaign(fixture.draft as CampaignState, content)).toEqual([]);
  });

  it('instantiates a fresh instance after a completion [MVP-AC-09, FUNC-18]', () => {
    const fixture = encounterFixture();
    destroy(fixture, opponentIds(fixture)[0] ?? '');
    const firstInstance = fixture.draft.encounter.active?.instanceId;

    abandonEncounter(fixture.context);
    instantiateEncounter(fixture.context, SCOUT_SITE_ID);

    expect(fixture.draft.encounter.lastOutcome?.status).toBe('completed');
    expect(fixture.draft.encounter.active?.instanceId).not.toBe(firstInstance);
    expect(fixture.draft.encounter.active?.status).toBe('active');
    expect(fixture.draft.encounter.active?.objective).toEqual({
      kind: 'destroyGroup',
      destroyed: 0,
      required: 1,
    });
    expect(completionCount(fixture.draft as CampaignState, SCOUT_ENCOUNTER_ID)).toBe(1);
  });
});

describe('encounter state', () => {
  it('rejects a malformed shape before any reference is read [TECH-15.3]', () => {
    const fixture = encounterFixture();
    expect(isEncounterState(fixture.draft.encounter)).toBe(true);
    expect(isEncounterState({ ...fixture.draft.encounter, unexpected: true })).toBe(false);
    expect(isEncounterState({ ...fixture.draft.encounter, version: 0 })).toBe(false);
    expect(isEncounterState({ ...fixture.draft.encounter, wrecks: [] })).toBe(false);
  });

  it.each([
    ['an opponent without a ship', (draft: CampaignDraft) => {
      const npc = draft.encounter.active?.npcs[0];
      if (npc !== undefined) delete (draft.assets.ships as Record<string, unknown>)[npc.shipId];
    }],
    ['an objective that does not count its opponents', (draft: CampaignDraft) => {
      if (draft.encounter.active !== null) draft.encounter.active.objective.required = 9;
    }],
    ['a reward granted twice', (draft: CampaignDraft) => {
      if (draft.encounter.active !== null) {
        draft.encounter.active.grantedRewardIds = ['bounty.x', 'bounty.x'];
      }
    }],
    ['an instance without its site', (draft: CampaignDraft) => {
      draft.navigation.currentSite = null;
      draft.assets.location = { kind: 'station', stationId: 'station.borrell.harbour' as never, systemId: 'system.borrell' as never };
    }],
  ])('refuses %s [TECH-15.3, FUNC-9.11]', (_name, mutate) => {
    const fixture = encounterFixture();
    mutate(fixture.draft);
    expect(validateCampaign(fixture.draft as CampaignState, content).length).toBeGreaterThan(0);
  });

  it('keeps the campaign hash stable across an identical replay [TECH-9.5]', () => {
    const first = encounterFixture();
    const second = encounterFixture();
    advance(first, 5_000);
    advance(second, 5_000);

    expect(campaignStateHash(first.draft as CampaignState)).toBe(
      campaignStateHash(second.draft as CampaignState),
    );
  });

  it("derives an opponent's attributes from the same pipeline the player uses [FUNC-8.2]", () => {
    const fixture = encounterFixture();
    const shipId = opponentIds(fixture)[0] ?? '';
    const ship = fixture.draft.assets.ships[shipId];
    if (ship === undefined) throw new Error('No opponent ship.');
    const derived = deriveShipAttributes({
      hull: content.requireHull(ship.hullId),
      fit: shipFit(fixture.draft.assets, shipId),
      content,
    });

    expect(ship.condition.capacitorCharge).toBe(attributeValue(derived, 'capacitorCapacity'));
    expect(ship.condition.damage).toEqual({ shield: 0, armor: 0, hull: 0 });
  });
});
