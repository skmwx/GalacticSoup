import { expect } from 'vitest';

import type { ContentRepository } from '@engine';

import { describeDiagnosis, diagnoseEncounter } from './diagnostics.ts';
import { fixtureFit, fixtureScenario, type FixtureScenario } from './fixtures.ts';
import { describeSortie, runScenario, type ScenarioRun } from './scenario.ts';

/**
 * What a progression scenario must show (MVP Implementation Plan phase 16).
 *
 * A scenario expected to complete must complete its share of sorties - every
 * one unless it names a band - with the full bounty, every opponent destroyed,
 * a fresh instance each time and the station counting each completion. A
 * scenario expected to fail must complete none. A failure prints every
 * sortie's record and the content diagnosis for the same fit and encounter.
 */

export async function expectScenario(id: string, content: ContentRepository): Promise<ScenarioRun> {
  const scenario = fixtureScenario(id);
  const run = await runScenario(scenario, content, { loot: true });
  const context = explain(scenario, run, content);
  const planned = scenario.seeds.length * scenario.sorties;
  const completed = run.sorties.filter((sortie) => sortie.status === 'completed');

  if (scenario.expect === 'notCompleted') {
    expect(completed, context).toEqual([]);
    return run;
  }

  // A sortie that ends in a loss ends that seed's campaign run, so sorties
  // never flown count against the share.
  expect(completed.length / planned, context).toBeGreaterThanOrEqual(scenario.minimumCompletedShare ?? 1);
  expect(run.sorties.every((sortie) => sortie.status !== 'timedOut'), context).toBe(true);

  // Repeatable: every completion met a fresh instance, the station counted it,
  // and the site stayed open for the next sortie.
  for (const seed of scenario.seeds) {
    const flown = run.sorties.filter((sortie) => sortie.seed === seed);
    const instances = flown.map((sortie) => sortie.instanceId);
    expect(new Set(instances).size, context).toBe(instances.length);
    let completions = 0;
    for (const sortie of flown) {
      if (sortie.status === 'completed') completions += 1;
      if (sortie.status !== 'lost') expect(sortie.completionCount, context).toBe(completions);
    }
  }
  for (const sortie of completed) {
    expect(sortie.bountyCredits, context).toBe(totalBounty(scenario.encounterId, content));
    expect(sortie.opponents.every((opponent) => opponent.destroyedAtSeconds !== null), context).toBe(true);
  }
  return run;
}

export function totalBounty(encounterId: string, content: ContentRepository): number {
  return content.requireEncounter(encounterId as never).spawns.reduce((total, spawn) =>
    total + spawn.count * content.requireNpcProfile(spawn.npcProfileId).bountyCredits, 0);
}

function explain(scenario: FixtureScenario, run: ScenarioRun, content: ContentRepository): string {
  const diagnosis = diagnoseEncounter(content, scenario.encounterId, fixtureFit(scenario.fitId), scenario.tactics);
  return [
    `${scenario.id}: ${scenario.description}`,
    ...run.sorties.map((sortie) => `  ${describeSortie(sortie)}`),
    `  diagnosis: ${describeDiagnosis(diagnosis)}`,
  ].join('\n');
}
