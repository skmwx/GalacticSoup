import type { ContentRepository } from '@engine';

import { assembleFit, type AssembledFit } from './assemble.ts';
import { fixtureFit, type FixtureFit, type FixtureScenario } from './fixtures.ts';
import { openSession } from './session.ts';
import { flySortie, refit, type RunOptions, type SortieRecord } from './sortie.ts';

export {
  describeSortie,
  FIGHT_BUDGET_SECONDS,
  flySortie,
  refit,
  restUntilCharged,
  type OpponentRecord,
  type RunOptions,
  type SortieRecord,
} from './sortie.ts';

/**
 * A progression scenario, run headlessly (MVP Implementation Plan phase 16;
 * Technical Specification 16).
 *
 * One scenario is a representative fit, an encounter, the tactics a competent
 * pilot would use and the seeds to try. Each seed is a campaign: the fit is
 * bought and assembled at the station, the campaign is saved and resumed, and
 * then the pilot flies the configured number of consecutive sorties - choose
 * the site, undock, warp in, fight, loot, return, dock, repair and resupply -
 * through the protocol alone.
 *
 * The record a sortie returns is the diagnosis a failure needs: which opponents
 * died when, how often each side hit, how much each opponent took off which
 * layer, what the repairers put back and what the ship ended with. A failed
 * progression claim therefore names the data that caused it instead of ending
 * in a timeout.
 */

export interface ScenarioRun {
  readonly scenario: FixtureScenario;
  readonly fit: FixtureFit;
  readonly costCredits: number;
  readonly sorties: readonly SortieRecord[];
}

/** Runs every seed of a scenario. */
export async function runScenario(
  scenario: FixtureScenario,
  content: ContentRepository,
  options: RunOptions = {},
): Promise<ScenarioRun> {
  const fit = options.fit ?? fixtureFit(scenario.fitId);
  const sorties: SortieRecord[] = [];
  let costCredits = 0;
  for (const seed of scenario.seeds) {
    const assembled = assembleFit(fit, seed, content);
    costCredits = assembled.costCredits;
    sorties.push(...(await runSeed(scenario, fit, assembled, seed, content, options)));
  }
  return { scenario, fit, costCredits, sorties };
}

async function runSeed(
  scenario: FixtureScenario,
  fit: FixtureFit,
  assembled: AssembledFit,
  seed: string,
  content: ContentRepository,
  options: RunOptions,
): Promise<SortieRecord[]> {
  const session = await openSession(assembled.state, content);
  const records: SortieRecord[] = [];
  for (let sortie = 1; sortie <= scenario.sorties; sortie += 1) {
    const record = await flySortie(session, scenario, content, seed, sortie, options);
    records.push(record);
    if (record.status === 'lost' || record.status === 'timedOut') break;
    await refit(session, fit, content);
  }
  return records;
}

