import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../config/aliases.mjs';

import { shippedContent } from '../support/content.ts';
import { expectScenarioRun, type ScenarioSummary } from '../support/progression/expectations.ts';
import { LADDER, ladderFit } from '../support/progression/ladder.ts';

/**
 * Every site of the twelve-site ladder completes with a fit made for it
 * (v0.2 Implementation Plan phase 5 exit gate; FeatureSpec02 8.1-8.2).
 *
 * Each scenario in `tests/fixtures/scenarios/ladder.json` buys its fit on its
 * hull at the starting station, saves and resumes the campaign, and flies two
 * consecutive sorties per seed through the protocol alone: choose the site,
 * undock, warp in, fight with the ordinary controls, loot, return, dock,
 * repair and resupply. Every sortie must complete with the full bounty from a
 * fresh instance, so every site is enterable, completable and repeatable.
 *
 * These are completion proofs, not the balance matrix: phase 6 measures the
 * same sites against every reference fit and tunes the content.
 */

const content = shippedContent();

/** What each site's made-for-it fit measured, for the weak-fit comparisons below. */
const madeFor = new Map<string, ScenarioSummary>();

/** A weak fit is materially worse when it fails, or clears the site at least this many times more slowly. */
const MATERIALLY_SLOWER = 3;

const weakRuns = new Map<string, ScenarioSummary>();

/**
 * What each scenario measured, for the phase records and the phase 6 matrix.
 * It is evidence, not the balance report: `npm run balance` does not read it.
 */
afterAll(() => {
  const row = (summary: ScenarioSummary) => ({
    scenarioId: summary.scenarioId,
    fitId: summary.fitId,
    completed: `${String(summary.completed)}/${String(summary.planned)}`,
    medianFightSeconds: summary.medianFightSeconds,
    hitPointsLost: Math.round(summary.hitPointsLost * 1000) / 1000,
  });
  const directory = path.join(REPO_ROOT, 'reports');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'ladder.json'), `${JSON.stringify({
    contentVersion: content.contentVersion,
    madeFor: [...madeFor.values()].map(row),
    weakFits: [...weakRuns.values()].map(row),
  }, null, 2)}
`, 'utf8');
});

describe('the twelve-site ladder', () => {
  it('sets every site, each band of four, against a fit made for it [V02-AC-09]', () => {
    const covered = LADDER.scenarios.map((scenario) => scenario.encounterId).sort();
    expect(covered).toEqual(content.encounters().map((encounter) => encounter.id).sort());
    for (const tier of [1, 2, 3]) {
      expect(content.encounters().filter((encounter) => encounter.tier === tier)).toHaveLength(4);
    }
  });

  it.each(LADDER.scenarios.map((scenario) => [scenario.id, scenario] as const))(
    'completes %s repeatedly with the full bounty [V02-AC-09, V02-AC-10, V02-AC-01, FUNC-9.11, FUNC-18]',
    async (_id, scenario) => {
      madeFor.set(scenario.encounterId, await expectScenarioRun(scenario, content, ladderFit(scenario.fitId, content)));
    },
    600_000,
  );
});

describe('fit-sensitive sites', () => {
  it('sets every fit-sensitive site against the fit its briefing warns about [V02-AC-09]', () => {
    const sensitive = content.encounters().filter((encounter) => encounter.fitSensitive).map((encounter) => encounter.id).sort();
    expect(sensitive.length).toBeGreaterThanOrEqual(3);
    expect(sensitive).toEqual(expect.arrayContaining(['encounter.borrell.range-check', 'encounter.borrell.screened-battery']));
    expect(LADDER.weakFits.map((scenario) => scenario.encounterId).sort()).toEqual(sensitive);
  });

  it.each(LADDER.weakFits.map((scenario) => [scenario.id, scenario] as const))(
    'punishes %s: it fails, or clears the site at least three times more slowly than a fit made for it [V02-AC-09, V02-AC-04]',
    async (_id, scenario) => {
      const weak = await expectScenarioRun(scenario, content, ladderFit(scenario.fitId, content));
      weakRuns.set(scenario.encounterId, weak);
      const good = madeFor.get(scenario.encounterId) ?? await expectScenarioRun(
        LADDER.scenarios.find((entry) => entry.encounterId === scenario.encounterId)!,
        content,
        ladderFit(LADDER.scenarios.find((entry) => entry.encounterId === scenario.encounterId)!.fitId, content),
      );
      expect(good.completedShare).toBe(1);
      if (weak.completedShare < 1) return;
      const slower = (weak.medianFightSeconds ?? Infinity) / (good.medianFightSeconds ?? 1);
      expect(slower, `${scenario.id} cleared the site only ${slower.toFixed(1)} times more slowly than the fit made for it`)
        .toBeGreaterThanOrEqual(MATERIALLY_SLOWER);
    },
    600_000,
  );
});
