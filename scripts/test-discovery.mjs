#!/usr/bin/env node
/**
 * `npm run test:discover`
 *
 * Lists what each test entry point would run, without running it, and checks
 * the selections the test suite optimization relies on (Test Suite
 * Optimization Plan phases 0-1):
 *
 *   - for every npm script that is a `vitest run`, the files it selects, with
 *     their Vitest project - so a targeted script such as `balance` or
 *     `diagnose:content` is proven to resolve the files it is meant to;
 *   - the Playwright cases of the four required release projects, and of the
 *     branded Chrome and Edge projects under the release gate's spec filter,
 *     each with its file, line, title and tags;
 *   - that the fast and release-only integration selections are disjoint,
 *     that their union is every file under `tests/integration/`, and that the
 *     release-only selection is exactly the long simulations;
 *   - the Chromium feature smoke (phase 2): its cases are exactly the cases
 *     tagged `@feature`, each of them also runs exactly once in each release
 *     project of its level, and the release gate never runs the smoke project;
 *   - the required release witnesses (phase 5, `config/releaseWitnesses.mjs`):
 *     each is discovered exactly once in every required project of its level;
 *   - the branded offline selection (phase 9): the whole offline sortie runs
 *     in Chromium and Firefox and not in Chrome or Edge, and the short
 *     branded flow runs in Chrome and Edge and in no required project.
 *
 * Writes `reports/test-discovery.json` (or `--out=<file>`) and prints a
 * summary. Exits 1 when a check fails. Listing starts no browser and no
 * server, and runs no test.
 *
 *   npm run test:discover
 *   npm run test:discover -- --out=docs/some/baseline.json
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';
import {
  BRANDED_ONLY_SPECS,
  BRANDED_PLAYWRIGHT_PROJECTS,
  BRANDED_SMOKE_SPECS,
  FEATURE_SMOKE_PROJECT,
  FEATURE_TAG,
  FEATURE_VITEST_GROUPS,
  FEATURE_VITEST_PROJECTS,
  FULL_OFFLINE_SPEC,
  INTEGRATION_FAST_PROJECT,
  INTEGRATION_RELEASE_PROJECT,
  isIntegrationReleaseFile,
  REQUIRED_PLAYWRIGHT_PROJECTS,
} from '../config/testSelections.mjs';
import { RELEASE_WITNESSES, stableTitle, WITNESS_LEVEL_PROJECTS } from '../config/releaseWitnesses.mjs';
import { readPlaywrightCases } from './lib/release.mjs';

const VITEST = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const PLAYWRIGHT = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

const outOption = process.argv.slice(2).find((arg) => arg.startsWith('--out='))?.slice('--out='.length);
const out = path.resolve(REPO_ROOT, outOption ?? path.join('reports', 'test-discovery.json'));

const relative = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

/* -------------------------------------------------------------------------- */
/* Vitest                                                                      */
/* -------------------------------------------------------------------------- */

/** The arguments of a `vitest run ...` script, or null for any other script. */
function vitestArguments(command) {
  const first = command.split('&&')[0]?.trim() ?? '';
  const words = first.split(/\s+/);
  if (words[0] !== 'vitest' || words[1] !== 'run') return null;
  return words.slice(2);
}

function listVitest(argv) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-list-')), 'list.json');
  const result = spawnSync(process.execPath, [VITEST, 'list', '--filesOnly', `--json=${file}`, ...argv], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (!fs.existsSync(file)) {
    throw new Error(`vitest list ${argv.join(' ')} wrote nothing:\n${result.stdout}\n${result.stderr}`);
  }
  const listed = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  return listed
    .map((entry) => ({ file: relative(entry.file), project: entry.projectName ?? '' }))
    .sort((left, right) => left.project.localeCompare(right.project) || left.file.localeCompare(right.file));
}

const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
/** @type {Record<string, { command: string, files: { file: string, project: string }[] }>} */
const scripts = {};
for (const [name, command] of Object.entries(packageJson.scripts)) {
  const argv = vitestArguments(command);
  if (argv === null) continue;
  scripts[name] = { command, files: listVitest(argv) };
}

/** Every file Vitest discovers, by project: the listing of `vitest run` with no filter. */
const all = listVitest([]);
const projects = {};
for (const entry of all) (projects[entry.project] ??= []).push(entry.file);

/* -------------------------------------------------------------------------- */
/* Playwright                                                                  */
/* -------------------------------------------------------------------------- */

function listPlaywright(projectNames, specs = []) {
  const result = spawnSync(
    process.execPath,
    [PLAYWRIGHT, 'test', '--list', '--reporter=json', ...projectNames.map((name) => `--project=${name}`), ...specs],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const start = result.stdout.indexOf('{');
  if (result.status !== 0 || start < 0) {
    throw new Error(`playwright --list failed:\n${result.stdout}\n${result.stderr}`);
  }
  const report = JSON.parse(result.stdout.slice(start));
  for (const error of report.errors ?? []) throw new Error(`playwright --list: ${error.message ?? JSON.stringify(error)}`);
  // The release gate reads its results with the same reader, so a case has
  // one identity in discovery and in the gate.
  return readPlaywrightCases(report, REPO_ROOT)
    .map(({ project, file, line, title, tags }) => ({ project, file, line, title, tags }));
}

const playwright = {
  required: listPlaywright(REQUIRED_PLAYWRIGHT_PROJECTS),
  branded: listPlaywright(BRANDED_PLAYWRIGHT_PROJECTS, BRANDED_SMOKE_SPECS),
  feature: listPlaywright([FEATURE_SMOKE_PROJECT]),
};
/** The files `verify:feature` runs across its Vitest invocations. */
/** The files `verify:feature` runs in its one Vitest invocation. */
const featureVitest = FEATURE_VITEST_GROUPS.flatMap((group) => listVitest(group.flatMap((project) => ['--project', project])));

/* -------------------------------------------------------------------------- */
/* Checks                                                                      */
/* -------------------------------------------------------------------------- */

/** Every `*.test.ts` under a directory, found on disk rather than through Vitest. */
function filesUnder(directory) {
  const found = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.name.endsWith('.test.ts')) found.push(child);
    }
  };
  visit(directory);
  return found.sort();
}

/** The plan's release-only files, stated independently of the Vitest globs. */
function releaseOnly(file) {
  return file.startsWith('tests/integration/balance/') || [
    'tests/integration/progression.test.ts',
    'tests/integration/progressionMastery.test.ts',
    'tests/integration/siteLadder.test.ts',
  ].includes(file);
}

/** @type {{ name: string, ok: boolean, detail: string }[]} */
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
const difference = (left, right) => left.filter((entry) => !right.includes(entry));

const onDisk = filesUnder('tests/integration');
const fast = projects[INTEGRATION_FAST_PROJECT] ?? [];
const release = projects[INTEGRATION_RELEASE_PROJECT] ?? [];
const legacy = projects['integration'];

if (legacy !== undefined) {
  // Before the split: one project holds the whole suite.
  check('the integration project holds every integration file', difference(onDisk, legacy).length === 0 && difference(legacy, onDisk).length === 0,
    `missing: ${difference(onDisk, legacy).join(', ') || 'none'}; extra: ${difference(legacy, onDisk).join(', ') || 'none'}`);
} else {
  const both = fast.filter((file) => release.includes(file));
  check('the fast and release-only integration selections are disjoint', both.length === 0, both.join(', '));
  const union = [...fast, ...release].sort();
  check('their union is every integration file', difference(onDisk, union).length === 0 && difference(union, onDisk).length === 0,
    `missing: ${difference(onDisk, union).join(', ') || 'none'}; extra: ${difference(union, onDisk).join(', ') || 'none'}`);
  const expected = onDisk.filter(releaseOnly);
  check('the release-only selection is the balance, progression and site-ladder files', difference(expected, release).length === 0 && difference(release, expected).length === 0,
    `expected ${String(expected.length)}, found ${String(release.length)}`);
  const misplaced = [...fast.filter(isIntegrationReleaseFile), ...release.filter((file) => !isIntegrationReleaseFile(file))];
  check('the release-file predicate the gate counts with agrees with the Vitest projects', misplaced.length === 0, misplaced.join(', '));
  const integrationScript = scripts['test:integration']?.files.map((entry) => entry.file).sort() ?? [];
  check('test:integration runs the whole union', JSON.stringify(integrationScript) === JSON.stringify(union),
    `${String(integrationScript.length)} of ${String(union.length)} files`);
  const fastScript = scripts['test:integration:fast']?.files ?? [];
  check('test:integration:fast runs only the fast selection', fastScript.length === fast.length && fastScript.every((entry) => entry.project === INTEGRATION_FAST_PROJECT));
  const testScript = scripts['test']?.files ?? [];
  check('npm test runs every discovered file once', testScript.length === all.length && new Set(testScript.map((entry) => `${entry.project}:${entry.file}`)).size === all.length);
}

const diagnostics = scripts['diagnose:content']?.files.map((entry) => entry.file) ?? [];
check('diagnose:content resolves the content diagnostics file alone',
  diagnostics.length === 1 && diagnostics[0] === 'tests/integration/contentDiagnostics.test.ts', diagnostics.join(', '));
for (const name of ['balance', 'balance:record']) {
  const files = scripts[name]?.files.map((entry) => entry.file).sort() ?? [];
  const expected = onDisk.filter((file) => file.startsWith('tests/integration/balance/') || /^tests\/integration\/progression[^/]*\.test\.ts$/.test(file));
  check(`${name} resolves the progression and balance simulations`, JSON.stringify(files) === JSON.stringify(expected),
    `${String(files.length)} files, expected ${String(expected.length)}`);
}

const keys = new Set();
const duplicates = [];
for (const entry of [...playwright.required, ...playwright.branded, ...playwright.feature]) {
  const key = `${entry.project}|${entry.file}|${entry.title}`;
  if (keys.has(key)) duplicates.push(key);
  keys.add(key);
}
check('no Playwright case runs twice in a project', duplicates.length === 0, duplicates.join('; '));

// Feature verification (phase 2).
{
  const identity = (entry) => `${entry.file}|${entry.title}`;
  const feature = playwright.feature;
  // The JSON listing names a tag without its leading @.
  const hasTag = (entry) => entry.tags.some((tag) => `@${tag.replace(/^@/, '')}` === FEATURE_TAG);
  const tagged = playwright.required.filter(hasTag);
  const untagged = feature.filter((entry) => !hasTag(entry));
  check('the feature smoke selects only cases tagged ' + FEATURE_TAG, feature.length > 0 && untagged.length === 0,
    `${String(feature.length)} cases; untagged: ${untagged.map(identity).join(', ') || 'none'}`);
  const taggedIds = [...new Set(tagged.map(identity))].sort();
  const featureIds = feature.map(identity).sort();
  check('every tagged case is in the feature smoke, once', JSON.stringify(taggedIds) === JSON.stringify(featureIds),
    `tagged ${String(taggedIds.length)}, smoke ${String(featureIds.length)}`);
  // Each smoke case runs exactly once in each release project of its level,
  // Chromium and Firefox alike, and the smoke itself is never release evidence.
  const enginesOf = (file) => file.startsWith('tests/accessibility/')
    ? ['accessibility', 'accessibility-firefox']
    : ['browser', 'browser-firefox'];
  const wrong = [];
  for (const entry of feature) {
    for (const project of enginesOf(entry.file)) {
      const runs = playwright.required.filter((other) => other.project === project && identity(other) === identity(entry)).length;
      if (runs !== 1) wrong.push(`${project}: ${identity(entry)} runs ${String(runs)} times`);
    }
  }
  check('every feature case runs exactly once in each applicable release engine', wrong.length === 0, wrong.join('; '));
  check('the feature smoke is not a required or branded project',
    !REQUIRED_PLAYWRIGHT_PROJECTS.includes(FEATURE_SMOKE_PROJECT) && !BRANDED_PLAYWRIGHT_PROJECTS.includes(FEATURE_SMOKE_PROJECT));
  // The gate names the projects it runs; read them from its source.
  const gate = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'release-gate.mjs'), 'utf8');
  const gateProjects = [...gate.matchAll(/playwright\('([^']+)'/g)].map((match) => match[1]).sort();
  const expectedGate = [...REQUIRED_PLAYWRIGHT_PROJECTS, ...BRANDED_PLAYWRIGHT_PROJECTS].sort();
  check('the release gate runs only the required and branded Playwright projects',
    JSON.stringify(gateProjects) === JSON.stringify(expectedGate), gateProjects.join(', '));
  const featureFiles = featureVitest.map((entry) => `${entry.project}:${entry.file}`).sort();
  const expectedFiles = all.filter((entry) => FEATURE_VITEST_PROJECTS.includes(entry.project))
    .map((entry) => `${entry.project}:${entry.file}`).sort();
  check('verify:feature runs the unit, fast integration and component files, each once',
    JSON.stringify(featureFiles) === JSON.stringify(expectedFiles) && !featureVitest.some((entry) => entry.project === INTEGRATION_RELEASE_PROJECT),
    `${String(featureFiles.length)} files, expected ${String(expectedFiles.length)}`);
}

// Required release witnesses (phase 5): each is discovered exactly once in
// every required project of its level, and no two witnesses name one case.
{
  const wrong = [];
  for (const witness of RELEASE_WITNESSES) {
    for (const project of WITNESS_LEVEL_PROJECTS[witness.level]) {
      const found = playwright.required.filter((entry) =>
        entry.project === project && entry.file === witness.file && stableTitle(entry.title) === witness.title).length;
      if (found !== 1) wrong.push(`${project}: ${witness.id} found ${String(found)} times`);
    }
  }
  check('every required release witness is discovered once in each of its projects', wrong.length === 0, wrong.join('; '));
  const keys = RELEASE_WITNESSES.map((witness) => `${witness.file} > ${witness.title}`);
  const ids = RELEASE_WITNESSES.map((witness) => witness.id);
  check('release witnesses have distinct ids and cases',
    new Set(keys).size === keys.length && new Set(ids).size === ids.length);
}

// Branded offline selection (phase 9).
{
  const inFile = (list, project, file) => list.filter((entry) => entry.project === project && entry.file === file).length;
  const wrong = [];
  for (const project of ['browser', 'browser-firefox']) {
    if (inFile(playwright.required, project, FULL_OFFLINE_SPEC) === 0) wrong.push(`${project} lacks ${FULL_OFFLINE_SPEC}`);
    for (const file of BRANDED_ONLY_SPECS) {
      if (inFile(playwright.required, project, file) !== 0) wrong.push(`${project} runs ${file}`);
    }
  }
  for (const project of BRANDED_PLAYWRIGHT_PROJECTS) {
    if (inFile(playwright.branded, project, FULL_OFFLINE_SPEC) !== 0) wrong.push(`${project} runs ${FULL_OFFLINE_SPEC}`);
    for (const file of BRANDED_ONLY_SPECS) {
      if (inFile(playwright.branded, project, file) === 0) wrong.push(`${project} lacks ${file}`);
    }
  }
  check('the full offline sortie runs in Chromium and Firefox, the short offline flow in Chrome and Edge only',
    wrong.length === 0, wrong.join('; '));
}

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

const count = (list, project) => list.filter((entry) => entry.project === project).length;
const summary = {
  vitestFilesByProject: Object.fromEntries(Object.entries(projects).map(([name, files]) => [name, files.length])),
  vitestFilesByScript: Object.fromEntries(Object.entries(scripts).map(([name, entry]) => [name, entry.files.length])),
  playwrightCasesByProject: Object.fromEntries(
    [...REQUIRED_PLAYWRIGHT_PROJECTS.map((name) => [name, count(playwright.required, name)]),
      ...BRANDED_PLAYWRIGHT_PROJECTS.map((name) => [name, count(playwright.branded, name)]),
      [FEATURE_SMOKE_PROJECT, playwright.feature.length]],
  ),
};
const discovery = {
  generatedFor: 'Galactic Soup',
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  summary,
  checks,
  vitest: { projects, scripts, featureVerification: featureVitest },
  playwright,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(discovery, null, 2)}\n`, 'utf8');

process.stdout.write(`Test discovery written to ${relative(out)}.\n`);
process.stdout.write(`Vitest files by project: ${JSON.stringify(summary.vitestFilesByProject)}\n`);
process.stdout.write(`Vitest files by script: ${JSON.stringify(summary.vitestFilesByScript)}\n`);
process.stdout.write(`Playwright cases by project: ${JSON.stringify(summary.playwrightCasesByProject)}\n`);
for (const entry of checks) {
  process.stdout.write(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}${entry.ok || entry.detail === '' ? '' : `: ${entry.detail}`}\n`);
}
process.exit(checks.every((entry) => entry.ok) ? 0 : 1);
