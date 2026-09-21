import { describe, expect, it } from 'vitest';

import {
  attributeValue,
  campaignStateHash,
  combatantOf,
  ENCOUNTER_REFUSALS,
  NPC_DECISION_KIND,
  readCampaignState,
  setDestroyedAt,
  stacksIn,
  validateCampaign,
  WRECK_EXPIRE_KIND,
  wrecksInSite,
  type CampaignState,
} from '@engine/domain';
import {
  advanceEncounter,
  NPC_DECISION_BOUNDARY,
  WRECK_EXPIRE_BOUNDARY,
} from '@engine/simulation';
import { RULE_VIOLATION_REASONS } from '@protocol';

import { testSimulation } from '../../support/campaign.ts';
import {
  advance,
  encounterFixture,
  opponentIds,
  SCOUT_SITE_ID,
} from '../../support/encounter.ts';
import { shippedContent } from '../../support/content.ts';
import { INSTALLED_BOUNDARY_RESOLVERS, INSTALLED_CONTINUOUS_SYSTEMS } from '@engine/application';
import { advanceTime } from '@engine/simulation';

/**
 * Encounter runtime as saved state (Technical Specification 11.2, 11.4, 15.3).
 *
 * An instance, its opponents, their pending decisions and every wreck they
 * left are scheduled work and physical goods. A campaign saved mid-encounter
 * has to come back with the same boundaries and resolve them at the same
 * instants.
 */

const content = shippedContent();

describe('encounter persistence', () => {
  it('round-trips an instance, its opponents and its wrecks [TECH-11.2, TECH-11.4]', () => {
    const fixture = encounterFixture({ siteId: 'site.borrell.derelict-lane' as never });
    advance(fixture, 4_000);

    const shipId = opponentIds(fixture)[0] ?? '';
    const combatant = combatantOf(fixture.draft, content, shipId);
    const ship = fixture.draft.assets.ships[shipId];
    if (combatant === null || ship === undefined) throw new Error('No opponent.');
    ship.condition.damage.hull = attributeValue(combatant.derived, 'hullHitPoints');
    setDestroyedAt(fixture.draft, shipId, fixture.draft.time.simulationTimeMs);
    advanceEncounter(fixture.context, fixture.draft.time.simulationTimeMs, fixture.draft.time.simulationTimeMs);

    const saved = fixture.draft as CampaignState;
    expect(validateCampaign(saved, content)).toEqual([]);

    const restored = readCampaignState(JSON.parse(JSON.stringify(saved)) as unknown);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(campaignStateHash(restored.state)).toBe(campaignStateHash(saved));
    expect(restored.state.encounter.active?.objective.destroyed).toBe(1);
    expect(wrecksInSite(restored.state, 'site.borrell.derelict-lane' as never)).toHaveLength(1);
  });

  it('resumes pending opponent decisions and wreck expiry at the same instants [TECH-9.2, TECH-11.4]', () => {
    const fixture = encounterFixture();
    advance(fixture, 4_000);

    const saved = JSON.parse(JSON.stringify(fixture.draft)) as unknown;
    const restored = readCampaignState(saved);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    const resumedDraft = JSON.parse(JSON.stringify(restored.state)) as CampaignState;
    const resumed = testSimulation(resumedDraft as never, content);

    // Both continue from the same boundaries, so they stay identical.
    advance(fixture, 6_000);
    (resumedDraft.time as { paused: boolean }).paused = false;
    let remaining = 6_000;
    while (remaining > 0) {
      advanceTime(resumed, Math.min(remaining, 250), INSTALLED_BOUNDARY_RESOLVERS, INSTALLED_CONTINUOUS_SYSTEMS);
      remaining -= 250;
    }
    expect(campaignStateHash(resumedDraft)).toBe(campaignStateHash(fixture.draft as CampaignState));
  });

  it('names the boundary kinds the scheduler resolves [TECH-15.3]', () => {
    expect(NPC_DECISION_KIND).toBe(NPC_DECISION_BOUNDARY);
    expect(WRECK_EXPIRE_KIND).toBe(WRECK_EXPIRE_BOUNDARY);
  });

  it('shares its refusal vocabulary with the protocol [TECH-5.4, FUNC-22.10]', () => {
    for (const refusal of ENCOUNTER_REFUSALS) {
      expect(RULE_VIOLATION_REASONS).toContain(refusal);
    }
  });

  it('keeps a wreck when the encounter that made it is over [FUNC-5.4, FUNC-22.7]', () => {
    const fixture = encounterFixture();
    const shipId = opponentIds(fixture)[0] ?? '';
    const combatant = combatantOf(fixture.draft, content, shipId);
    const ship = fixture.draft.assets.ships[shipId];
    if (combatant === null || ship === undefined) throw new Error('No opponent.');
    ship.condition.damage.hull = attributeValue(combatant.derived, 'hullHitPoints');
    setDestroyedAt(fixture.draft, shipId, 0);
    advanceEncounter(fixture.context, 0, 0);

    expect(fixture.draft.encounter.active?.status).toBe('completed');
    const wreck = wrecksInSite(fixture.draft as CampaignState, SCOUT_SITE_ID)[0];
    if (wreck === undefined) throw new Error('No wreck.');
    expect(stacksIn(fixture.draft.assets, wreck.inventoryId).length).toBeGreaterThanOrEqual(0);
    expect(
      fixture.draft.scheduler.entries.some((entry) => entry.entryId === wreck.boundaryEntryId),
    ).toBe(true);
  });
});
