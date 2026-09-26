import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import type { ScenarioSummary } from '../progression/expectations.ts';

import type { CareerFixture, CareerSeedRun, SortieEntry } from './career.ts';

/**
 * The balance report's sections (MVP Implementation Plan phase 17; Technical
 * Specification 16).
 *
 * Each balance test file measures one part of the loop and writes what it
 * measured to `reports/balance/<section>.json` and `.md`. `npm run balance`
 * runs those files and `scripts/balance-report.mjs` joins the sections into
 * `reports/balance.md`; `npm run balance:record` also writes the candidate
 * record in `tests/fixtures/balance/candidate.json`. The figures are
 * deterministic, so two reports differ only where content or rules differ.
 */

export const BALANCE_SECTIONS_DIR = path.join(REPO_ROOT, 'reports', 'balance');

export interface ScenarioSection {
  readonly kind: 'scenarios';
  readonly title: string;
  readonly scenarios: readonly ScenarioSummary[];
}

export interface CareerSummary {
  readonly careerId: string;
  readonly description: string;
  readonly objectives: readonly string[];
  readonly runs: readonly CareerSeedRun[];
}

export interface CareerSection {
  readonly kind: 'careers';
  readonly title: string;
  readonly careers: readonly CareerSummary[];
}

export type BalanceSection = ScenarioSection | CareerSection;

export function writeBalanceSection(name: string, section: BalanceSection): void {
  fs.mkdirSync(BALANCE_SECTIONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BALANCE_SECTIONS_DIR, `${name}.json`), `${JSON.stringify(section, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(BALANCE_SECTIONS_DIR, `${name}.md`), renderSection(section), 'utf8');
}

export function careerSummary(career: CareerFixture, runs: readonly CareerSeedRun[]): CareerSummary {
  return { careerId: career.id, description: career.description, objectives: career.objectives, runs };
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                    */
/* -------------------------------------------------------------------------- */

export function renderSection(section: BalanceSection): string {
  return section.kind === 'scenarios' ? renderScenarios(section) : renderCareers(section);
}

function renderScenarios(section: ScenarioSection): string {
  const lines = [
    `## ${section.title}`,
    '',
    '| Scenario | Fit | Meant to | Cost | Completed | Median fight | Hit points lost | Damage taken | Rounds/sortie | Bands |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const scenario of section.scenarios) {
    const band = scenario.band;
    const bands = [
      `done ${range(band.completedShare, pct)}`,
      band.medianFightSeconds === undefined ? null : `fight ${range(band.medianFightSeconds, seconds)}`,
      band.hitPointsLost === undefined ? null : `lost ${range(band.hitPointsLost, pct)}`,
      band.damageTaken === undefined ? null : `taken ${range(band.damageTaken, whole)}`,
    ].filter((entry) => entry !== null).join(', ');
    lines.push(`| ${scenario.scenarioId} | ${scenario.fitId} | ${scenario.expect === 'completed' ? 'clear' : 'fall short'} | ` +
      `${credits(scenario.costCredits)} | ${String(scenario.completed)}/${String(scenario.planned)} | ` +
      `${scenario.medianFightSeconds === null ? '-' : seconds(scenario.medianFightSeconds)} | ${pct(scenario.hitPointsLost)} | ` +
      `${whole(scenario.damageTaken)} | ` +
      `${scenario.roundsPerSortie.toFixed(0)} | ${bands} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderCareers(section: CareerSection): string {
  const lines = [`## ${section.title}`, ''];
  for (const career of section.careers) {
    lines.push(`### ${career.careerId} (MVP Scope ${career.objectives.join(', ')})`, '', career.description, '');
    lines.push(
      '| Seed | Result | Sorties | Simulated time | Upgrades (after sorties) | Final credits | Income | Running costs |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const run of career.runs) {
      const sorties = run.entries.filter((entry): entry is SortieEntry => entry.kind === 'sortie');
      const upgrades = run.entries
        .filter((entry) => entry.kind === 'equip')
        .map((entry) => `${entry.fitId} (${String(entry.afterSorties)})`)
        .join(', ');
      const income = sorties.reduce((total, entry) =>
        total + entry.bountyCredits + entry.lootSaleCredits + entry.insuranceCredits, 0);
      const costs = sorties.reduce((total, entry) => total + entry.repairCredits + entry.resupplyCredits, 0);
      lines.push(`| ${run.seed.slice(0, 6)} | ${run.finished ? 'finished' : `stalled: ${run.stalled ?? ''}`} | ` +
        `${String(run.sorties)} | ${minutes(run.simulationSeconds)} | ${upgrades} | ${credits(run.finalCredits)} | ` +
        `${credits(income)} | ${credits(costs)} (${income > 0 ? pct(costs / income) : '-'}) |`);
    }
    lines.push('', '<details><summary>Sorties</summary>', '');
    lines.push(
      '| Seed | # | Scenario | Result | Fight | Sortie | Hit points left | Bounty | Loot sold | Insurance | Repair | Resupply | Credits after |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    );
    for (const run of career.runs) {
      for (const entry of run.entries) {
        if (entry.kind !== 'sortie') continue;
        lines.push(`| ${run.seed.slice(0, 6)} | ${String(entry.number)} | ${entry.scenarioId} | ${entry.status}${entry.recoveryGrant ? ' (grant)' : ''} | ` +
          `${seconds(entry.fightSeconds)} | ${seconds(entry.sortieSeconds)} | ${pct(entry.hitPointsShare)} | ` +
          `${credits(entry.bountyCredits)} | ${credits(entry.lootSaleCredits)} | ${credits(entry.insuranceCredits)} | ` +
          `${credits(entry.repairCredits)} | ${credits(entry.resupplyCredits)} | ${credits(entry.creditsAfter)} |`);
      }
    }
    lines.push('', '</details>', '');
  }
  return `${lines.join('\n')}\n`;
}

function range(band: readonly [number, number], format: (value: number) => string): string {
  return band[0] === band[1] ? format(band[0]) : `${format(band[0])}-${format(band[1])}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function seconds(value: number): string {
  return `${value.toFixed(0)} s`;
}

function minutes(value: number): string {
  return `${(value / 60).toFixed(1)} min`;
}

function whole(value: number): string {
  return value.toFixed(0);
}

function credits(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
