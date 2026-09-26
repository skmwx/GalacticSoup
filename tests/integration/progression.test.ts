import { afterAll, describe, expect, it } from 'vitest';

import { shippedContent } from '../support/content.ts';
import { writeBalanceSection } from '../support/balance/report.ts';
import { assembleFit } from '../support/progression/assemble.ts';
import { expectScenario, totalBounty, type ScenarioSummary } from '../support/progression/expectations.ts';
import { fixtureFit, fixtureScenario, PROGRESSION } from '../support/progression/fixtures.ts';

/**
 * The progression matrix, headless: the easiest and the multi-opponent sites,
 * and the fits that fall short of the mastery site
 * (MVP Implementation Plan phases 16-17; MVP Scope 4.1-4.3, 9.1; Technical
 * Specification 15.1, 16). `progressionMastery.test.ts` holds the fits meant
 * for the mastery site, so the long runs proceed side by side.
 *
 * Every scenario in `tests/fixtures/scenarios/progression.json` buys its
 * representative fit at the starting station, saves and resumes the campaign,
 * and flies consecutive sorties through the protocol alone: choose the site,
 * undock, warp in, fight with the ordinary commands, loot, return, dock,
 * repair and resupply. Each must measure inside its bands. Together they show
 * that every fit clears the easiest site, that the multi-opponent site needs
 * the second gun and the right target priority, and that neither the starter
 * nor the intermediate fit clears the mastery site - tier is guidance that
 * means something without being a gate.
 */

const content = shippedContent();
const measured: ScenarioSummary[] = [];

async function measure(id: string): Promise<ScenarioSummary> {
  const summary = await expectScenario(id, content);
  measured.push(summary);
  return summary;
}

afterAll(() => {
  const order = PROGRESSION.scenarios.map((scenario) => scenario.id);
  writeBalanceSection('scenarios-early', {
    kind: 'scenarios',
    title: 'Encounter outcomes: the easiest and multi-opponent sites, and the fits that fall short of the mastery site',
    scenarios: [...measured].sort((left, right) => order.indexOf(left.scenarioId) - order.indexOf(right.scenarioId)),
  });
});

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
    // One clear of the multi-opponent site does not pay for the mastery fit,
    // two do, before any loot is sold (MVP Scope 4.3: a decision within a small
    // number of encounters, not at once).
    const patrol = totalBounty('encounter.borrell.pirate-patrol', content);
    expect(cost('mastery')).toBeGreaterThan(starting + patrol);
    expect(cost('mastery')).toBeLessThanOrEqual(starting + 2 * patrol);
    // The long-range approach is a further investment, not a cheaper shortcut.
    expect(cost('lancer')).toBeGreaterThan(cost('mastery'));
  });

  it('clears the easiest site with every fit, the starter fit repeatedly and the poor purchase too [MVP-AC-05, MVP-AC-09, FUNC-9.10, FUNC-9.11, FUNC-18]', async () => {
    for (const id of ['scout.starter', 'scout.folly', 'scout.intermediate', 'scout.mastery', 'scout.lancer']) {
      await measure(id);
    }
  }, 300_000);

  it('clears the multi-opponent site with the intermediate fit and the right target priority, repeatedly [MVP-AC-05, MVP-AC-07, MVP-AC-09, FUNC-9.10, FUNC-9.11]', async () => {
    const summary = await measure('patrol.intermediate');
    // Target priority is part of the plan: the cutters die before the marksman.
    const scenario = fixtureScenario('patrol.intermediate');
    expect(summary.completed).toBe(scenario.seeds.length * scenario.sorties);
    await measure('patrol.mastery');
  }, 300_000);

  it('makes target priority and range decide the multi-opponent site: the wrong order and the railguns fall short [MVP-AC-04, MVP-AC-05, FUNC-9.5, FUNC-9.10]', async () => {
    const wrongOrder = await measure('patrol.intermediate-marksman-first');
    const rightOrder = measured.find((summary) => summary.scenarioId === 'patrol.intermediate');
    expect(wrongOrder.completedShare).toBeLessThan(rightOrder?.completedShare ?? 1);
    await measure('patrol.lancer');
  }, 300_000);

  it('does not clear the harder sites with the fits below them: tier is guidance with meaning [MVP-AC-07, MVP-AC-08, FUNC-18]', async () => {
    const patrol = await measure('patrol.starter');
    const base = await measure('base.starter');
    await measure('base.intermediate');
    await measure('base.intermediate-brawl');
    // Losing is recoverable: each loss ends at the station with a loss report.
    expect(patrol.lost + base.lost).toBeGreaterThan(0);
  }, 300_000);
});
