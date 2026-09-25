import { describe, expect, it } from 'vitest';

import {
  campaignStateHash,
  activeModuleState,
  COMBAT_REFUSALS,
  LOCK_COMPLETE_KIND,
  MODULE_CYCLE_KIND,
  readCampaignState,
  RELOAD_COMPLETE_KIND,
  shipCombat,
  validateCampaign,
  WEAPON_CYCLE_KIND,
  weaponState,
  type CampaignState,
  type CampaignDraft,
  type SlotRef,
} from '@engine/domain';
import {
  activateModule,
  activateWeapon,
  beginLock,
  releaseLock,
  LOCK_COMPLETE_BOUNDARY,
  MODULE_CYCLE_BOUNDARY,
  RELOAD_COMPLETE_BOUNDARY,
  requestReload,
  WEAPON_CYCLE_BOUNDARY,
} from '@engine/simulation';
import { RULE_VIOLATION_REASONS } from '@protocol';

import { testSimulation } from '../../support/campaign.ts';
import {
  advance,
  combatFixture,
  FIRST_WEAPON,
  FUSION,
  type CombatFixture,
} from '../../support/combat.ts';

/**
 * Combat runtime as saved state (Technical Specification 11.2, 11.4, 15.3).
 *
 * A lock, a running cycle and a reload are all scheduled work, so a campaign
 * saved in the middle of a fight has to come back with the same boundaries
 * and resolve them at the same instants.
 */

const WEAPON: SlotRef = { kind: 'weapon', index: 0 };
const BOOSTER: SlotRef = { kind: 'system', index: 0 };

function fighting(): CampaignState {
  const fixture = combatFixture({
    targetPositionKm: { x: 2, y: 0 },
    playerCargoRounds: [{ ammunitionId: FUSION, rounds: 20 }],
  });
  beginLock(fixture.context, fixture.playerId, fixture.targetId);
  advance(fixture, 3000);
  activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
  return fixture.draft as CampaignState;
}

describe('combat runtime in a snapshot', () => {
  it('satisfies the campaign invariants while a fight is under way [TECH-15.3]', () => {
    const state = fighting();

    expect(validateCampaign(state)).toEqual([]);
  });

  it('survives a canonical round trip unchanged [TECH-11.4, TECH-9.5]', () => {
    const state = fighting();
    const restored = readCampaignState(JSON.parse(JSON.stringify(state)) as unknown);

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(campaignStateHash(restored.state)).toBe(campaignStateHash(state));

    const combat = shipCombat(restored.state, restored.state.assets.activeShipId!);
    expect(combat.locks[0]?.status).toBe('locked');
    expect(weaponState(combat, FIRST_WEAPON).cycle?.reservedRounds).toBe(1);
  });

  it('keeps the invariants satisfied through a whole scripted fight [TECH-15.3]', () => {
    const fixture = combatFixture({
      targetPositionKm: { x: 2, y: 0 },
      playerCargoRounds: [{ ammunitionId: FUSION, rounds: 20 }],
    });
    const site = fixture.draft.navigation.currentSite;
    if (site === null) throw new Error('The fixture has no site.');
    const second = 'c000000000000000000000000-e200';
    site.objects[second] = {
      ...site.objects[fixture.targetId]!,
      id: second,
      position: { x: 2, y: 2 },
    };
    const clean = () => {
      expect(validateCampaign(fixture.draft as CampaignState, fixture.content)).toEqual([]);
    };

    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    clean();
    beginLock(fixture.context, fixture.playerId, second);
    advance(fixture, 3000);
    clean();

    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    clean();
    advance(fixture, 2500);
    clean();

    activateWeapon(fixture.context, fixture.playerId, WEAPON, second);
    clean();
    releaseLock(fixture.context, fixture.playerId, fixture.targetId);
    clean();

    requestReload(fixture.context, fixture.playerId, WEAPON, FUSION, false);
    clean();
    advance(fixture, 8000);
    clean();
  });

  it('refuses a lock whose completion boundary is missing [TECH-15.3, FUNC-22.5]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    fixture.draft.scheduler.entries.length = 0;

    const issues = validateCampaign(fixture.draft as CampaignState);

    expect(issues.some((issue) => issue.rule === 'combatConsistency')).toBe(true);
  });

  it('refuses combat runtime for a ship that is not in the site [TECH-15.3]', () => {
    const fixture = combatFixture({ targetPositionKm: { x: 2, y: 0 } });
    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    fixture.draft.navigation.currentSite = null;
    fixture.draft.assets.location = {
      kind: 'station',
      stationId: fixture.content.rules.economy.startingStationId,
      systemId: 'system.borrell',
    } as CampaignState['assets']['location'];

    const issues = validateCampaign(fixture.draft as CampaignState);

    expect(issues.some((issue) => issue.rule === 'combatConsistency')).toBe(true);
  });

  it('records the ammunition a pending reload depends on [TECH-11.4]', () => {
    const fixture = combatFixture({
      targetPositionKm: { x: 2, y: 0 },
      playerCargoRounds: [{ ammunitionId: FUSION, rounds: 20 }],
    });
    beginLock(fixture.context, fixture.playerId, fixture.targetId);
    advance(fixture, 3000);
    activateWeapon(fixture.context, fixture.playerId, WEAPON, fixture.targetId);
    advance(fixture, 2500);
    requestReload(fixture.context, fixture.playerId, WEAPON, FUSION, false);
    advance(fixture, 2500);

    const restored = readCampaignState(
      JSON.parse(JSON.stringify(fixture.draft)) as unknown,
    );

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const combat = shipCombat(restored.state, restored.state.assets.activeShipId!);
    expect(weaponState(combat, FIRST_WEAPON).reload?.ammunitionId).toBe(FUSION);
  });

  it('round-trips a paid active-module cycle and its regeneration trend [TECH-11.4, FUNC-9.8]', () => {
    const fixture = combatFixture({ armTarget: false });
    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    ship.condition.damage.shield = 80;
    activateModule(fixture.context, fixture.playerId, BOOSTER);
    advance(fixture, 1_000);

    const before = activeModuleState(shipCombat(fixture.draft, fixture.playerId), 'system:0');
    const restored = readCampaignState(JSON.parse(JSON.stringify(fixture.draft)) as unknown);

    expect(before.cycle).not.toBeNull();
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const combat = shipCombat(restored.state, restored.state.assets.activeShipId!);
    expect(activeModuleState(combat, 'system:0')).toEqual(before);
    expect(combat.capacitorTrend).not.toBeNull();
    expect(validateCampaign(restored.state, fixture.content)).toEqual([]);

    const restoredDraft = restored.state as CampaignDraft;
    const resumed: CombatFixture = {
      ...fixture,
      draft: restoredDraft,
      context: testSimulation(restoredDraft, fixture.content),
    };
    advance(fixture, 3_000);
    advance(resumed, 3_000);
    expect(restoredDraft.assets.ships[fixture.playerId]?.condition)
      .toEqual(fixture.draft.assets.ships[fixture.playerId]?.condition);
    expect(activeModuleState(shipCombat(restoredDraft, fixture.playerId), 'system:0'))
      .toEqual(activeModuleState(shipCombat(fixture.draft, fixture.playerId), 'system:0'));
    expect(restoredDraft.combat.events).toEqual(fixture.draft.combat.events);
  });
});

describe('combat vocabularies', () => {
  it.each(COMBAT_REFUSALS)(
    'has a protocol rule-violation reason for %s [TECH-12.3, TECH-5.4]',
    (refusal) => {
      expect(RULE_VIOLATION_REASONS).toContain(refusal);
    },
  );

  it('names the same boundary kinds in the domain and the simulation [TECH-9.2, TECH-15.3]', () => {
    expect(LOCK_COMPLETE_KIND).toBe(LOCK_COMPLETE_BOUNDARY);
    expect(WEAPON_CYCLE_KIND).toBe(WEAPON_CYCLE_BOUNDARY);
    expect(RELOAD_COMPLETE_KIND).toBe(RELOAD_COMPLETE_BOUNDARY);
    expect(MODULE_CYCLE_KIND).toBe(MODULE_CYCLE_BOUNDARY);
  });
});
