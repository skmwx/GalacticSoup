import { describe, expect, it } from 'vitest';

import { shippedContent } from '../support/content.ts';
import { assembleFit } from '../support/progression/assemble.ts';
import { expectScenario, totalBounty } from '../support/progression/expectations.ts';
import { fixtureFit, PROGRESSION } from '../support/progression/fixtures.ts';

/**
 * The phase 16 exit gate, headless: the first two steps and the tier gap
 * (MVP Implementation Plan phase 16; MVP Scope 4.1-4.3, 9.1; Technical
 * Specification 15.1, 16). `progressionMastery.test.ts` holds the mastery
 * site, so the two long runs proceed side by side.
 *
 * Every scenario in `tests/fixtures/scenarios/progression.json` buys its
 * representative fit at the starting station, saves and resumes the campaign,
 * and flies consecutive sorties through the protocol alone: choose the site,
 * undock, warp in, fight with the ordinary commands, loot, return, dock,
 * repair and resupply. Here the starter fit clears the easiest site and the
 * intermediate fit the multi-opponent site, each more than once, and the
 * starter fit clears neither harder site, so tier is guidance that means
 * something without being a gate.
 */

const content = shippedContent();

describe('progression through the three encounters', () => {
  it('buys every representative fit at the starting station, within reach of the loop [MVP-AC-02, MVP-AC-07, FUNC-8.4, FUNC-11.3, FUNC-18]', () => {
    const starting = content.rules.economy.startingCredits;
    const cost = (fitId: string): number =>
      assembleFit(fixtureFit(fitId), PROGRESSION.scenarios[0]?.seeds[0] ?? '', content).costCredits;

    // The starter fit is what a new campaign already owns.
    expect(cost('starter')).toBe(0);
    // The initial wallet buys the intermediate fit, but not the mastery one.
    expect(cost('intermediate')).toBeGreaterThan(0);
    expect(cost('intermediate')).toBeLessThanOrEqual(starting);
    expect(cost('mastery')).toBeGreaterThan(starting);
    // The starting wallet and one clear of the multi-opponent site's bounties
    // reach the mastery fit, before any loot is sold (MVP Scope 4.3).
    expect(cost('mastery')).toBeLessThanOrEqual(starting + totalBounty('encounter.borrell.pirate-patrol', content));
    // The long-range approach is a further investment, not a cheaper shortcut.
    expect(cost('lancer')).toBeGreaterThan(cost('mastery'));
  });

  it('clears the easiest site with the starter fit, repeatedly [MVP-AC-05, MVP-AC-09, FUNC-9.10, FUNC-9.11, FUNC-18]', async () => {
    await expectScenario('scout.starter', content);
  }, 300_000);

  it('clears the multi-opponent site with the intermediate fit and the right target priority, repeatedly [MVP-AC-05, MVP-AC-07, MVP-AC-09, FUNC-9.10, FUNC-9.11]', async () => {
    const run = await expectScenario('patrol.intermediate', content);
    // Target priority is part of the plan: the cutters die before the marksman.
    for (const sortie of run.sorties.filter((entry) => entry.status === 'completed')) {
      const death = (profileId: string): number[] => sortie.opponents
        .filter((opponent) => opponent.profileId === profileId)
        .map((opponent) => opponent.destroyedAtSeconds ?? Infinity);
      expect(Math.max(...death('npc.pirate.cutter'))).toBeLessThan(Math.min(...death('npc.pirate.marksman')));
    }
  }, 300_000);

  it('does not clear the harder sites with the starter fit: tier is guidance with meaning [MVP-AC-07, FUNC-18]', async () => {
    const patrol = await expectScenario('patrol.starter', content);
    const base = await expectScenario('base.starter', content);
    // Losing is recoverable: each loss ends at the station with a loss report.
    expect([...patrol.sorties, ...base.sorties].some((sortie) => sortie.status === 'lost')).toBe(true);
  }, 300_000);
});
