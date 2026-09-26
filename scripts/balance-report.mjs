#!/usr/bin/env node
/**
 * `npm run balance` and `npm run balance:record`
 *
 * Joins the sections the balance simulations wrote to `reports/balance/` into
 * one report, `reports/balance.md` (and `.json`), for the tuning pass of MVP
 * Implementation Plan phase 17 and the release-candidate comparison of phase
 * 21. The simulations run first, as ordinary integration tests:
 *
 *   - `tests/integration/progression*.test.ts` sets every representative fit
 *     against every encounter (scenario sections);
 *   - `tests/integration/balance/career*.test.ts` flies whole campaigns from
 *     their first day (career sections).
 *
 * With `--record`, the report's headline figures, the content identity, the
 * tuning digest and every seed used are written to
 * `tests/fixtures/balance/candidate.json`: the candidate tuning bundle. Without
 * it, the report compares itself with that record and lists what moved.
 *
 * Every figure is deterministic for a given content set and engine, so two
 * reports differ only where content or rules differ.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';
import { compileContent } from './lib/content/compile.mjs';
import { readContentFiles } from './lib/content/read.mjs';
import { tuningDigest } from './lib/content/tuning.mjs';

const SECTIONS_DIR = path.join(REPO_ROOT, 'reports', 'balance');
const CANDIDATE = path.join(REPO_ROOT, 'tests', 'fixtures', 'balance', 'candidate.json');
const PROGRESSION = path.join(REPO_ROOT, 'tests', 'fixtures', 'scenarios', 'progression.json');
const CAREERS = path.join(REPO_ROOT, 'tests', 'fixtures', 'balance', 'careers.json');
const record = process.argv.includes('--record');

const compiled = compileContent(readContentFiles(), { floor: true });
if (!compiled.ok || compiled.bundle === null) {
  process.stderr.write('Balance report: the content does not compile; run npm run validate:content.\n');
  process.exit(1);
}
const identity = {
  contentVersion: compiled.bundle.contentVersion,
  contentHash: compiled.bundle.contentHash,
  tuningDigest: tuningDigest(compiled.bundle),
};

const progression = readJson(PROGRESSION);
const careerFixtures = readJson(CAREERS);
const sections = fs.existsSync(SECTIONS_DIR)
  ? fs.readdirSync(SECTIONS_DIR).filter((file) => file.endsWith('.json')).sort()
  : [];
const scenarios = new Map();
const careers = new Map();
for (const file of sections) {
  const section = readJson(path.join(SECTIONS_DIR, file));
  if (section.kind === 'scenarios') {
    for (const scenario of section.scenarios) scenarios.set(scenario.scenarioId, scenario);
  } else if (section.kind === 'careers') {
    for (const career of section.careers) careers.set(career.careerId, career);
  }
}

const missing = [
  ...progression.scenarios.map((scenario) => scenario.id).filter((id) => !scenarios.has(id)),
  ...careerFixtures.careers.map((career) => career.id).filter((id) => !careers.has(id)),
];
if (missing.length > 0) {
  process.stderr.write(`Balance report: no measurement for ${missing.join(', ')}. Run the balance simulations first (npm run balance).\n`);
  process.exit(1);
}

const headline = headlineFigures();
const seeds = [...new Set([
  ...progression.scenarios.flatMap((scenario) => scenario.seeds),
  ...careerFixtures.careers.flatMap((career) => career.seeds),
])].sort();
const candidate = fs.existsSync(CANDIDATE) ? readJson(CANDIDATE) : null;
const differences = record || candidate === null ? [] : compare(candidate, identity, headline);

fs.writeFileSync(
  path.join(REPO_ROOT, 'reports', 'balance.json'),
  `${JSON.stringify({ generatedFor: 'Galactic Soup', ...identity, seeds, headline }, null, 2)}\n`,
  'utf8',
);
fs.writeFileSync(path.join(REPO_ROOT, 'reports', 'balance.md'), renderMarkdown(), 'utf8');

if (record) {
  fs.writeFileSync(CANDIDATE, `${JSON.stringify({
    $comment: 'The candidate tuning bundle for release-candidate comparison (MVP Implementation Plan phase 17). Written by npm run balance:record; do not edit by hand. tuningDigest covers rules, definitions and listings; a tuning change makes this record stale until it is recorded again.',
    ...identity,
    seeds,
    headline,
  }, null, 2)}\n`, 'utf8');
}

process.stdout.write(
  `Balance report: ${String(scenarios.size)} scenarios, ${String(careers.size)} careers, tuning ${identity.tuningDigest.slice(0, 12)}` +
    `${record ? ', candidate recorded' : candidate === null ? ', no candidate recorded yet' : `, ${String(differences.length)} differences from the candidate`}.\n`,
);

/* -------------------------------------------------------------------------- */

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The figures a later report is compared with: per scenario and per career seed. */
function headlineFigures() {
  const scenarioFigures = {};
  for (const fixture of progression.scenarios) {
    const measured = scenarios.get(fixture.id);
    scenarioFigures[fixture.id] = {
      completed: measured.completed,
      planned: measured.planned,
      medianFightSeconds: measured.medianFightSeconds === null ? null : round(measured.medianFightSeconds, 1),
      hitPointsLost: round(measured.hitPointsLost, 3),
      damageTaken: round(measured.damageTaken, 0),
      outcomes: measured.outcomes.map((outcome) =>
        `${outcome.seed.slice(0, 8)}#${String(outcome.sortie)} ${outcome.status} ${outcome.fightSeconds.toFixed(0)}s`),
    };
  }
  const careerFigures = {};
  for (const fixture of careerFixtures.careers) {
    careerFigures[fixture.id] = Object.fromEntries(careers.get(fixture.id).runs.map((run) => [run.seed, {
      finished: run.finished,
      sorties: run.sorties,
      simulationMinutes: round(run.simulationSeconds / 60, 1),
      finalCredits: run.finalCredits,
      upgrades: run.entries.filter((entry) => entry.kind === 'equip').map((entry) => `${entry.fitId}@${String(entry.afterSorties)}`),
    }]));
  }
  return { scenarios: scenarioFigures, careers: careerFigures };
}

function compare(previous, current, figures) {
  const found = [];
  if (previous.tuningDigest !== current.tuningDigest) {
    found.push(`tuning digest ${String(previous.tuningDigest).slice(0, 12)} -> ${current.tuningDigest.slice(0, 12)}`);
  }
  const walk = (before, after, at) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object' ||
        Array.isArray(before) || Array.isArray(after)) {
      found.push(`${at}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      return;
    }
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      walk(before[key], after[key], at === '' ? key : `${at}.${key}`);
    }
  };
  walk(previous.headline ?? {}, figures, '');
  return found;
}

function renderMarkdown() {
  const lines = [
    '# Balance report',
    '',
    'Generated by `npm run balance` from the balance simulations (MVP Implementation Plan phase 17). Do not edit by hand.',
    '',
    `Content ${identity.contentVersion}, tuning digest \`${identity.tuningDigest.slice(0, 16)}\`. ` +
      `${String(seeds.length)} fixture seeds. Every figure is deterministic for this content and engine.`,
    '',
    ...objectives(),
    ...dominance(),
  ];
  if (!record) {
    lines.push('## Compared with the recorded candidate', '');
    if (candidate === null) lines.push('No candidate has been recorded yet (`npm run balance:record`).', '');
    else if (differences.length === 0) lines.push(`Identical to the candidate recorded for tuning digest \`${String(candidate.tuningDigest).slice(0, 16)}\`.`, '');
    else lines.push(...differences.map((entry) => `- ${entry}`), '');
  }
  for (const name of ['scenarios-early', 'scenarios-mastery',
    ...careerFixtures.careers.map((career) => `career-${career.id}`)]) {
    const file = path.join(SECTIONS_DIR, `${name}.md`);
    if (fs.existsSync(file)) lines.push(fs.readFileSync(file, 'utf8').trimEnd(), '');
  }
  return `${lines.join('\n')}\n`;
}

/** MVP Scope 4.3, objective by objective, with the evidence that holds it. */
function objectives() {
  const scenario = (id) => scenarios.get(id);
  const share = (id) => `${String(scenario(id).completed)}/${String(scenario(id).planned)}`;
  const runs = (id) => careers.get(id).runs;
  const range = (values) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    return low === high ? String(low) : `${String(low)}-${String(high)}`;
  };
  const sortiesBefore = (id, fitId) => range(runs(id).map((run) =>
    run.entries.find((entry) => entry.kind === 'equip' && entry.fitId === fitId)?.afterSorties ?? NaN));
  const betweenUpgrades = (id, fromFit, toFit) => range(runs(id).map((run) => {
    const equips = run.entries.filter((entry) => entry.kind === 'equip');
    const from = equips.find((entry) => entry.fitId === fromFit)?.afterSorties ?? NaN;
    const to = equips.find((entry) => entry.fitId === toFit && entry.afterSorties >= from)?.afterSorties ?? NaN;
    return to - from;
  }));
  const minutes = (id) => range(runs(id).map((run) => Math.round(run.simulationSeconds / 60)));
  return [
    '## MVP Scope 4.3 objectives',
    '',
    '| Objective | Evidence |',
    '|---|---|',
    `| 1. Enter the easy site immediately | The starter fit clears the Pirate Scout ${share('scout.starter')}, with nothing bought. |`,
    `| 2. A meaningful choice, not every upgrade | The starting credits buy the intermediate fit or the poor purchase, not both, and neither the mastery nor the long-range fit (startingWallet test). |`,
    `| 3. A new decision within a few encounters | Multi-opponent clears between buying the intermediate and the mastery fit: ${betweenUpgrades('scout-first', 'intermediate', 'mastery')}. Mastery-site clears between the mastery and the long-range fit: ${betweenUpgrades('long-range', 'mastery', 'lancer')}. |`,
    `| 4. An upgrade materially improves the next tier | Pirate Patrol: starter ${share('patrol.starter')}, intermediate ${share('patrol.intermediate')}. Pirate Base: intermediate ${share('base.intermediate')} losing ${pct(scenario('base.intermediate').hitPointsLost)} of its hit points, mastery ${share('base.mastery')} losing ${pct(scenario('base.mastery').hitPointsLost)}. |`,
    `| 5. Replay recovers from poor purchases and losses | Easy-site sorties from the poor purchase back to the intermediate fit: ${sortiesBefore('poor-purchase', 'intermediate')}. From a lost ship back to the intermediate fit: ${range(runs('loss-recovery').map((run) => run.entries.filter((entry) => entry.kind === 'equip' && entry.fitId === 'intermediate')[1]?.afterSorties - 1))}. |`,
    `| 6. The hard site through the intended loop | From a new campaign to two Pirate Base clears in ${range(runs('scout-first').map((run) => run.sorties))} sorties and ${minutes('scout-first')} simulated minutes, every credit earned in play. |`,
    '',
  ];
}

/** Why no representative fit is the best choice everywhere. */
function dominance() {
  const lower = new Set(['medianFightSeconds', 'hitPointsLost', 'damageTaken']);
  const lines = [
    '## No universally dominant fit',
    '',
    '| Fit | Outperformed by | At | Measure | Its band | Their band | Why |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const witness of progression.dominance.witnesses) {
    const own = progression.scenarios.find((entry) => entry.fitId === witness.fitId && entry.encounterId === witness.encounterId);
    const other = progression.scenarios.find((entry) => entry.fitId === witness.outperformedBy && entry.encounterId === witness.encounterId);
    const band = (entry) => entry?.band?.[witness.measure]?.join('-') ?? '?';
    lines.push(`| ${witness.fitId} | ${witness.outperformedBy} | ${witness.encounterId.replace('encounter.borrell.', '')} | ` +
      `${witness.measure} (${lower.has(witness.measure) ? 'lower' : 'higher'} is better) | ${band(own)} | ${band(other)} | ${witness.reason} |`);
  }
  lines.push('');
  return lines;
}

function pct(value) {
  return `${(value * 100).toFixed(0)}%`;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
