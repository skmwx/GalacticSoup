import { expect } from 'vitest';

import type { ContentRepository } from '@engine';

import { careerFixture, runCareer, type CareerSeedRun, type SortieEntry } from './career.ts';
import { careerSummary, writeBalanceSection } from './report.ts';

/**
 * What every career must show (MVP Implementation Plan phase 17; MVP Scope 4.3).
 *
 * Every seed finishes its plan inside the sortie budgets - the bands - and
 * running the ship is a real cost without swallowing the reward: every cleared
 * site pays more than its repairs and resupply, and across the career they
 * take a noticeable but bounded share of what the sites paid. A failure prints
 * every sortie of every seed, so the stalled step can be read against its
 * numbers.
 */

/** Across a career, resupply and repair take at least this share of what cleared sites paid... */
export const MINIMUM_RUNNING_COST_SHARE = 0.03;
/** ...and never more than this (MVP Scope 4.3: resupply and repair are decisions, not a drain). */
export const MAXIMUM_RUNNING_COST_SHARE = 0.35;

export async function flyCareer(id: string, content: ContentRepository): Promise<CareerSeedRun[]> {
  const career = careerFixture(id);
  const runs = await runCareer(career, content);
  writeBalanceSection(`career-${career.id}`, {
    kind: 'careers',
    title: `Career: ${career.id}`,
    careers: [careerSummary(career, runs)],
  });

  const context = describeRuns(runs);
  for (const run of runs) {
    expect(run.stalled, `${run.seed}: ${context}`).toBeNull();
    let reward = 0;
    let running = 0;
    for (const sortie of completedSorties(run)) {
      const paid = sortie.bountyCredits + sortie.lootSaleCredits;
      const spent = sortie.repairCredits + sortie.resupplyCredits;
      expect(spent, `${run.seed} sortie ${String(sortie.number)} cost more than it paid: ${context}`).toBeLessThan(paid);
      reward += paid;
      running += spent;
    }
    expect(running / reward, `${run.seed} running-cost share: ${context}`).toBeGreaterThanOrEqual(MINIMUM_RUNNING_COST_SHARE);
    expect(running / reward, `${run.seed} running-cost share: ${context}`).toBeLessThanOrEqual(MAXIMUM_RUNNING_COST_SHARE);
  }
  return runs;
}

export function sortiesOf(run: CareerSeedRun): SortieEntry[] {
  return run.entries.filter((entry): entry is SortieEntry => entry.kind === 'sortie');
}

export function completedSorties(run: CareerSeedRun): SortieEntry[] {
  return sortiesOf(run).filter((entry) => entry.status === 'completed');
}

function describeRuns(runs: readonly CareerSeedRun[]): string {
  return runs.map((run) => [
    `\n${run.careerId} seed ${run.seed}: ${run.finished ? 'finished' : `stalled (${run.stalled ?? ''})`} ` +
      `after ${String(run.sorties)} sorties, ${String(run.finalCredits)} credits`,
    ...run.entries.map((entry) => entry.kind === 'equip'
      ? `  equip ${entry.fitId} after ${String(entry.afterSorties)} sorties for ${String(entry.costCredits)} -> ${String(entry.creditsAfter)}`
      : `  #${String(entry.number)} ${entry.scenarioId} ${entry.status} fight ${entry.fightSeconds.toFixed(0)} s, ` +
        `hp ${(entry.hitPointsShare * 100).toFixed(0)}%, bounty ${String(entry.bountyCredits)}, loot ${String(entry.lootSaleCredits)}, ` +
        `insurance ${String(entry.insuranceCredits)}, repair ${String(entry.repairCredits)}, resupply ${String(entry.resupplyCredits)} -> ${String(entry.creditsAfter)}`),
  ].join('\n')).join('\n');
}
