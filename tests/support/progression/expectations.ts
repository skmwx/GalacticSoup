import { expect } from 'vitest';

import type { ContentRepository } from '@engine';

import { describeDiagnosis, diagnoseEncounter } from './diagnostics.ts';
import {
  fixtureFit,
  fixtureScenario,
  type Band,
  type FixtureScenario,
  type ScenarioBand,
  type ScenarioExpectation,
} from './fixtures.ts';
import { describeSortie, runScenario, type ScenarioRun, type SortieRecord } from './scenario.ts';

/**
 * What a progression scenario must show (MVP Implementation Plan phases 16-17).
 *
 * Every scenario must measure inside its bands: the share of sorties that
 * complete, the median length of a completed fight and the hit points the ship
 * comes home without. A scenario whose fit is meant for the site must, in
 * every sortie it completes, collect the full bounty from every opponent, meet
 * a fresh instance each time and see the station count each completion. A
 * failure prints every sortie's record and the content diagnosis for the same
 * fit and encounter.
 */

export interface SortieOutcome {
  readonly seed: string;
  readonly sortie: number;
  readonly status: string;
  readonly fightSeconds: number;
  readonly hitPointsShare: number;
  readonly lowestHitPointsShare: number;
  readonly damageTaken: number;
  readonly roundsFired: number;
}

/** A scenario's measured outcome: what the bands are held to and the balance report prints. */
export interface ScenarioSummary {
  readonly scenarioId: string;
  readonly fitId: string;
  readonly encounterId: string;
  readonly expect: ScenarioExpectation;
  readonly costCredits: number;
  readonly planned: number;
  readonly flown: number;
  readonly completed: number;
  readonly lost: number;
  readonly completedShare: number;
  readonly medianFightSeconds: number | null;
  readonly hitPointsLost: number;
  readonly damageTaken: number;
  readonly roundsPerSortie: number;
  readonly band: ScenarioBand;
  readonly outcomes: readonly SortieOutcome[];
}

export async function expectScenario(id: string, content: ContentRepository): Promise<ScenarioSummary> {
  const scenario = fixtureScenario(id);
  const run = await runScenario(scenario, content, { loot: true });
  const summary = summariseRun(run);
  const context = explain(scenario, run, summary, content);

  expectBand(summary.completedShare, scenario.band.completedShare, `${context}\ncompleted share`);
  if (scenario.band.medianFightSeconds !== undefined) {
    expect(summary.medianFightSeconds, `${context}\nno sortie completed to time`).not.toBeNull();
    expectBand(summary.medianFightSeconds ?? NaN, scenario.band.medianFightSeconds, `${context}\nmedian fight seconds`);
  }
  if (scenario.band.hitPointsLost !== undefined) {
    expectBand(summary.hitPointsLost, scenario.band.hitPointsLost, `${context}\nhit points lost`);
  }
  if (scenario.band.damageTaken !== undefined) {
    expectBand(summary.damageTaken, scenario.band.damageTaken, `${context}\ndamage taken`);
  }
  if (scenario.expect === 'notCompleted') return summary;

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
  for (const sortie of run.sorties.filter((entry) => entry.status === 'completed')) {
    expect(sortie.bountyCredits, context).toBe(totalBounty(scenario.encounterId, content));
    expect(sortie.opponents.every((opponent) => opponent.destroyedAtSeconds !== null), context).toBe(true);
  }
  return summary;
}

export function summariseRun(run: ScenarioRun): ScenarioSummary {
  const { scenario } = run;
  const planned = scenario.seeds.length * scenario.sorties;
  const completed = run.sorties.filter((sortie) => sortie.status === 'completed');
  const lost = run.sorties.filter((sortie) => sortie.status === 'lost').length;
  const flown = run.sorties.length;
  return {
    scenarioId: scenario.id,
    fitId: scenario.fitId,
    encounterId: scenario.encounterId,
    expect: scenario.expect,
    costCredits: run.costCredits,
    planned,
    flown,
    completed: completed.length,
    lost,
    completedShare: completed.length / planned,
    medianFightSeconds: median(completed.map((sortie) => sortie.fightSeconds)),
    hitPointsLost: flown === 0 ? 1 : run.sorties.reduce((total, sortie) => total + 1 - sortie.hitPointsShare, 0) / flown,
    damageTaken: flown === 0 ? 0 : run.sorties.reduce((total, sortie) => total + damageTakenIn(sortie), 0) / flown,
    roundsPerSortie: flown === 0 ? 0 : run.sorties.reduce((total, sortie) => total + sortie.roundsFired, 0) / flown,
    band: scenario.band,
    outcomes: run.sorties.map((sortie) => ({
      seed: sortie.seed,
      sortie: sortie.sortie,
      status: sortie.status,
      fightSeconds: round(sortie.fightSeconds, 1),
      hitPointsShare: round(sortie.hitPointsShare, 4),
      lowestHitPointsShare: round(sortie.lowestHitPointsShare, 4),
      damageTaken: round(damageTakenIn(sortie), 1),
      roundsFired: sortie.roundsFired,
    })),
  };
}

export function totalBounty(encounterId: string, content: ContentRepository): number {
  return content.requireEncounter(encounterId as never).spawns.reduce((total, spawn) =>
    total + spawn.count * content.requireNpcProfile(spawn.npcProfileId).bountyCredits, 0);
}

/** Damage every opponent applied to the ship in one sortie, after resistances. */
export function damageTakenIn(sortie: SortieRecord): number {
  return sortie.opponents.reduce((total, opponent) =>
    total + opponent.damageToPlayer.shield + opponent.damageToPlayer.armor + opponent.damageToPlayer.hull, 0);
}

/** The middle value, or the upper middle of an even count; `null` when there is none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function expectBand(value: number, band: Band, message: string): void {
  expect(value, `${message} ${String(value)} outside [${String(band[0])}, ${String(band[1])}]`).toBeGreaterThanOrEqual(band[0]);
  expect(value, `${message} ${String(value)} outside [${String(band[0])}, ${String(band[1])}]`).toBeLessThanOrEqual(band[1]);
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function explain(scenario: FixtureScenario, run: ScenarioRun, summary: ScenarioSummary, content: ContentRepository): string {
  const diagnosis = diagnoseEncounter(content, scenario.encounterId, fixtureFit(scenario.fitId), scenario.tactics);
  return [
    `${scenario.id}: ${scenario.description}`,
    `  measured: completed ${String(summary.completed)}/${String(summary.planned)}, median ${String(summary.medianFightSeconds)} s, ` +
      `hit points lost ${summary.hitPointsLost.toFixed(3)}, damage taken ${summary.damageTaken.toFixed(0)}`,
    ...run.sorties.map((sortie) => `  ${describeSortie(sortie)}`),
    `  diagnosis: ${describeDiagnosis(diagnosis)}`,
  ].join('\n');
}
