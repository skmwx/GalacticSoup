#!/usr/bin/env node
/**
 * `npm run release:gate`, `npm run release:report` and `npm run release:record`
 *
 * The release-candidate gate of MVP Implementation Plan phase 21. It runs
 * every automated check the candidate must pass, against one set of sources
 * and one built bundle, and writes what it found:
 *
 *   - the checks of `npm run verify`: types, architecture, content, the unit,
 *     integration, performance and component suites, traceability;
 *   - the balance report, compared with the recorded balance candidate;
 *   - the production build, built twice and compared, then audited: no script
 *     in it may be able to make a request;
 *   - the browser and accessibility suites, served exactly that bundle, in
 *     the Chromium and Firefox builds Playwright pins, and the start, save and
 *     offline flows in the Chrome and Edge installed on this machine.
 *
 * Each step leaves a record in `reports/release/steps/` that names the sources
 * and the bundle it ran against. `reports/release-gate.md` is the evidence
 * joined together, with a verdict that is green only when every required step
 * passed against what is there now.
 *
 *   npm run release:gate                      every step, then the report
 *   npm run release:gate -- --only=build,browser-firefox
 *   npm run release:gate -- --from=browser    that step and the ones after it
 *   npm run release:gate -- --pending         only steps without a current pass
 *   npm run release:report                    the report, from the records
 *   npm run release:record -- --label=rc.1    writes config/release-candidate.json
 *
 * Recording is refused unless the verdict is green. The record is what the
 * human playtest of MVP Scope 9.3 is run against.
 *
 * The browser suites play in real time and take most of an hour between them.
 * Run the gate on an otherwise idle machine: the performance step measures the
 * engine, and the fights are fought at 1x.
 *
 * @implements TECH-15.1
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';
import { ENGINE_VERSION } from '../src/engine/application/version.ts';
import { compileContent } from './lib/content/compile.mjs';
import { readContentFiles } from './lib/content/read.mjs';
import { tuningDigest } from './lib/content/tuning.mjs';
import {
  CANDIDATE_FILE,
  RELEASE_DIR,
  auditBuild,
  fingerprintBuild,
  judge,
  readPlaywrightResult,
  readVitestResult,
  renderGateReport,
  sourceDigest,
} from './lib/release.mjs';

const DIST = path.join(REPO_ROOT, 'dist');
const STEPS_DIR = path.join(REPO_ROOT, RELEASE_DIR, 'steps');
const RESULTS_DIR = path.join(REPO_ROOT, RELEASE_DIR, 'results');
const LOGS_DIR = path.join(REPO_ROOT, RELEASE_DIR, 'logs');
const VITEST = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const PLAYWRIGHT = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const VITE = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const TSC = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/** The flows short enough to repeat in each branded Chromium build. */
const SMOKE_SPECS = [
  'tests/browser/boot.spec.ts',
  'tests/browser/campaign.spec.ts',
  'tests/browser/persistence.spec.ts',
  'tests/browser/offline.spec.ts',
];

/**
 * @typedef {object} Step
 * @property {string} id
 * @property {string} title
 * @property {boolean} [optional]
 * @property {boolean} [served]
 * @property {() => object} run returns what the step found, without its bookkeeping
 */

/** @type {Step[]} */
const STEPS = [
  { id: 'typecheck', title: 'Type check', run: () => command([TSC, '--noEmit']) },
  { id: 'architecture', title: 'Architecture check', run: () => command(['scripts/check-architecture.mjs']) },
  { id: 'content', title: 'Content validation', run: () => command(['scripts/validate-content.mjs']) },
  { id: 'unit', title: 'Unit suite', run: () => vitest('unit') },
  { id: 'integration', title: 'Integration suite: loops, replay, properties, balance', run: () => vitest('integration') },
  { id: 'balance', title: 'Balance report against its candidate', run: balance },
  { id: 'performance', title: 'Performance suite', run: () => vitest('performance') },
  { id: 'component', title: 'Component suite', run: () => vitest('component') },
  { id: 'traceability', title: 'Traceability', run: () => command(['scripts/traceability.mjs']) },
  { id: 'build', title: 'Production build, twice, and its audit', run: build },
  { id: 'browser', title: 'Browser suite, Chromium', served: true, run: () => playwright('browser') },
  { id: 'accessibility', title: 'Accessibility suite, Chromium', served: true, run: () => playwright('accessibility') },
  { id: 'browser-firefox', title: 'Browser suite, Firefox', served: true, run: () => playwright('browser-firefox') },
  {
    id: 'accessibility-firefox',
    title: 'Accessibility suite, Firefox',
    served: true,
    run: () => playwright('accessibility-firefox'),
  },
  {
    id: 'browser-chrome',
    title: 'Start, save and offline flows, Chrome',
    served: true,
    optional: true,
    run: () => playwright('browser-chrome', SMOKE_SPECS, 'chrome'),
  },
  {
    id: 'browser-edge',
    title: 'Start, save and offline flows, Edge',
    served: true,
    optional: true,
    run: () => playwright('browser-edge', SMOKE_SPECS, 'msedge'),
  },
];

/* -------------------------------------------------------------------------- */
/* Arguments                                                                   */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const reportOnly = flag('report');
const record = flag('record');
const only = option('only')?.split(',').map((id) => id.trim()).filter(Boolean);
const from = option('from');
const known = new Set(STEPS.map((step) => step.id));
for (const id of [...(only ?? []), ...(from === undefined ? [] : [from])]) {
  if (!known.has(id)) {
    process.stderr.write(`Release gate: there is no step "${id}". Steps: ${[...known].join(', ')}.\n`);
    process.exit(2);
  }
}

for (const dir of [STEPS_DIR, RESULTS_DIR, LOGS_DIR]) fs.mkdirSync(dir, { recursive: true });

/** Whether every step this run was asked for ended well. */
let ranWell = true;
if (!reportOnly && !record) {
  let selected = STEPS;
  if (only !== undefined) selected = STEPS.filter((step) => only.includes(step.id));
  else if (from !== undefined) selected = STEPS.slice(STEPS.findIndex((step) => step.id === from));
  if (flag('pending')) {
    const standing = judge(STEPS, readResults(), currentState());
    const settled = new Set(
      standing.steps.filter((step) => step.state === 'passed' || step.state === 'skipped').map((step) => step.id),
    );
    selected = selected.filter((step) => !settled.has(step.id));
  }
  for (const step of selected) {
    const status = runStep(step);
    if (status === 'failed' || (status === 'skipped' && step.optional !== true)) ranWell = false;
  }
}

const evidence = gather();
fs.writeFileSync(path.join(REPO_ROOT, 'reports', 'release-gate.md'), renderGateReport(evidence), 'utf8');
fs.writeFileSync(
  path.join(REPO_ROOT, 'reports', 'release-gate.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
);
process.stdout.write(
  `Release gate: ${evidence.judgement.verdict.toUpperCase()}. Evidence written to reports/release-gate.md.\n`,
);
for (const problem of evidence.judgement.problems) process.stdout.write(`  ${problem}\n`);

if (record) {
  if (evidence.judgement.verdict !== 'green') {
    process.stderr.write('Release gate: a candidate is recorded only from a green gate.\n');
    process.exit(1);
  }
  const label = option('label') ?? 'rc.1';
  const { identity } = evidence;
  const candidate = {
    $comment:
      'The release candidate (MVP Implementation Plan phase 21). Written by npm run release:record from a green release gate; do not edit by hand. A change to the sources or the bundle makes it stale until the gate has passed again.',
    candidate: `${identity.applicationVersion}-${label}`,
    applicationVersion: identity.applicationVersion,
    engineVersion: identity.engineVersion,
    protocolVersion: identity.protocolVersion,
    saveFormatVersion: identity.saveFormatVersion,
    campaignStateVersion: identity.campaignStateVersion,
    replayLogVersion: identity.replayLogVersion,
    contentVersion: identity.contentVersion,
    contentHash: identity.contentHash,
    tuningDigest: identity.tuningDigest,
    contractLockDigest: identity.contractLockDigest,
    goldenCampaignDigest: identity.goldenCampaignDigest,
    sourceDigest: identity.sourceDigest,
    buildFingerprint: identity.buildFingerprint,
    browsers: Object.fromEntries(
      evidence.browsers.filter((browser) => browser.version !== null).map((browser) => [browser.name, browser.version]),
    ),
    gate: Object.fromEntries(
      evidence.judgement.steps.map((step) => {
        const result = evidence.results.find((entry) => entry.id === step.id);
        return [step.id, result?.tests === undefined ? step.state : `${step.state}: ${String(result.tests.passed)} tests`];
      }),
    ),
  };
  fs.writeFileSync(path.join(REPO_ROOT, CANDIDATE_FILE), `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  process.stdout.write(`Release gate: candidate ${candidate.candidate} recorded in ${CANDIDATE_FILE.split(path.sep).join('/')}.\n`);
  // The report says which candidate it describes, so write it again.
  fs.writeFileSync(path.join(REPO_ROOT, 'reports', 'release-gate.md'), renderGateReport(gather()), 'utf8');
}

// A partial run answers for the steps it ran; the verdict is in the report.
process.exit(ranWell ? 0 : 1);

/* -------------------------------------------------------------------------- */
/* Running a step                                                              */
/* -------------------------------------------------------------------------- */

function runStep(step) {
  process.stdout.write(`\n=== ${step.id}: ${step.title}\n`);
  const before = currentState();
  const started = Date.now();
  let found;
  try {
    found = step.run();
  } catch (error) {
    found = { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  const after = currentState();
  const result = {
    id: step.id,
    title: step.title,
    ...found,
    sourceDigest: before.sourceDigest,
    // A served suite counts only for the bundle that was there throughout.
    buildFingerprint: step.id === 'build' || before.buildFingerprint === after.buildFingerprint
      ? after.buildFingerprint
      : null,
    durationMs: Date.now() - started,
    finishedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  };
  if (after.sourceDigest !== before.sourceDigest) {
    result.status = 'failed';
    result.reason = 'the sources changed while the step ran';
  }
  fs.writeFileSync(path.join(STEPS_DIR, `${step.id}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`=== ${step.id}: ${result.status}${result.reason === undefined ? '' : ` (${result.reason})`}\n`);
  return result.status;
}

/** Runs one Node script with the gate's log beside it. */
function node(id, argv, env = {}) {
  const log = path.join(LOGS_DIR, `${id}.log`);
  const output = fs.openSync(log, 'w');
  const result = spawnSync(process.execPath, argv, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', output, output],
  });
  fs.closeSync(output);
  return { exitCode: result.status ?? 1, log: path.relative(REPO_ROOT, log).split(path.sep).join('/') };
}

function command(argv) {
  const id = path.basename(argv[0], path.extname(argv[0]));
  const { exitCode, log } = node(id, argv);
  return { status: exitCode === 0 ? 'passed' : 'failed', exitCode, log };
}

function vitest(project) {
  const file = path.join(RESULTS_DIR, `${project}.json`);
  fs.rmSync(file, { force: true });
  const { exitCode, log } = node(`vitest-${project}`, [
    VITEST, 'run', '--project', project, '--reporter=default', '--reporter=json', `--outputFile.json=${file}`,
  ]);
  if (!fs.existsSync(file)) return { status: 'failed', exitCode, log, reason: 'the suite wrote no result' };
  const tests = readVitestResult(JSON.parse(fs.readFileSync(file, 'utf8')));
  const passed = exitCode === 0 && tests.failed === 0 && tests.passed > 0;
  return { status: passed ? 'passed' : 'failed', exitCode, log, tests };
}

/** The balance report must find nothing moved since the balance candidate was recorded. */
function balance() {
  const { exitCode, log } = node('balance', ['scripts/balance-report.mjs']);
  if (exitCode !== 0) return { status: 'failed', exitCode, log };
  const report = readJson(path.join(REPO_ROOT, 'reports', 'balance.json'));
  const candidate = readJson(path.join(REPO_ROOT, 'tests', 'fixtures', 'balance', 'candidate.json'));
  const same = sameBalance(report, candidate);
  return {
    status: same ? 'passed' : 'failed',
    exitCode,
    log,
    ...(same ? {} : { reason: 'the figures differ from the recorded balance candidate; see reports/balance.md' }),
  };
}

function sameBalance(report, candidate) {
  return candidate !== null && report !== null &&
    report.tuningDigest === candidate.tuningDigest &&
    JSON.stringify(report.headline) === JSON.stringify(candidate.headline);
}

function build() {
  const once = () => {
    const typed = node('build', [TSC, '--noEmit']);
    if (typed.exitCode !== 0) return typed;
    return node('build', [VITE, 'build']);
  };
  const first = once();
  if (first.exitCode !== 0) return { status: 'failed', ...first };
  const firstPrint = fingerprintBuild(DIST);
  const second = once();
  if (second.exitCode !== 0) return { status: 'failed', ...second };
  const secondPrint = fingerprintBuild(DIST);

  const audit = auditBuild(DIST, { contentHash: contentIdentity().contentHash });
  const reproducible = firstPrint.fingerprint === secondPrint.fingerprint;
  /** @type {string[]} */
  const reasons = [];
  if (!reproducible) reasons.push('two builds of the same sources differ');
  if (!audit.ok) reasons.push(...audit.findings);
  return {
    status: reasons.length === 0 ? 'passed' : 'failed',
    exitCode: 0,
    log: second.log,
    ...(reasons.length === 0 ? {} : { reason: reasons.join('; ') }),
    build: { reproducible, audit, files: secondPrint.files },
  };
}

function playwright(project, specs = [], channel) {
  const version = browserVersion(project, channel);
  if (version === null) {
    return { status: 'skipped', reason: `${channel ?? project} is not installed on this machine`, browserVersion: null };
  }
  if (fingerprintBuild(DIST).fingerprint === null) {
    return { status: 'failed', reason: 'there is no build to serve; run the build step first', browserVersion: version };
  }
  const file = path.join(RESULTS_DIR, `${project}.json`);
  fs.rmSync(file, { force: true });
  const { exitCode, log } = node(
    `playwright-${project}`,
    // One retry: a browser now and then fails to close its own context after a
    // test has passed. A test that needed the retry is named in the evidence.
    [PLAYWRIGHT, 'test', `--project=${project}`, '--retries=1', ...specs],
    { RELEASE_GATE_RESULTS: file, RELEASE_GATE_SERVE_BUILT: '1' },
  );
  if (!fs.existsSync(file)) {
    return { status: 'failed', exitCode, log, reason: 'the suite wrote no result', browserVersion: version };
  }
  const tests = readPlaywrightResult(JSON.parse(fs.readFileSync(file, 'utf8')));
  const passed = exitCode === 0 && tests.failed === 0 && tests.passed + tests.flaky > 0;
  return {
    status: passed ? 'passed' : 'failed',
    exitCode,
    log,
    ...(passed && tests.flaky > 0 ? { reason: `${String(tests.flaky)} passed only on a retry` } : {}),
    tests,
    browserVersion: version,
  };
}

/** The version of the browser a project drives, or null when it is not installed. */
function browserVersion(project, channel) {
  const engine = project.includes('firefox') ? 'firefox' : 'chromium';
  const script =
    `import { ${engine} } from '@playwright/test';` +
    `const browser = await ${engine}.launch(${channel === undefined ? '' : JSON.stringify({ channel })});` +
    'process.stdout.write(browser.version()); await browser.close();';
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim() !== '' ? result.stdout.trim() : null;
}

/* -------------------------------------------------------------------------- */
/* Gathering the evidence                                                      */
/* -------------------------------------------------------------------------- */

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function git(argv) {
  const result = spawnSync('git', argv, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${argv.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

/** Tracked files and new ones that are not ignored: what a commit of this tree would hold. */
function sourceFiles() {
  return git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
}

function currentState() {
  return {
    sourceDigest: sourceDigest(REPO_ROOT, sourceFiles()),
    buildFingerprint: fingerprintBuild(DIST).fingerprint,
  };
}

function contentIdentity() {
  const compiled = compileContent(readContentFiles(), { floor: true });
  if (!compiled.ok || compiled.bundle === null) {
    throw new Error('the content does not compile; run npm run validate:content');
  }
  return {
    contentVersion: compiled.bundle.contentVersion,
    contentHash: compiled.bundle.contentHash,
    tuningDigest: tuningDigest(compiled.bundle),
  };
}

function digestOf(file) {
  const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readResults() {
  return STEPS.map((step) => readJson(path.join(STEPS_DIR, `${step.id}.json`))).filter((result) => result !== null);
}

function gather() {
  const state = currentState();
  const lock = readJson(path.join(REPO_ROOT, 'tests', 'fixtures', 'contracts', 'lock.json'));
  const results = readResults();
  const byId = new Map(results.map((result) => [result.id, result]));
  const identity = {
    applicationVersion: readJson(path.join(REPO_ROOT, 'package.json')).version,
    engineVersion: ENGINE_VERSION,
    protocolVersion: lock.protocolVersion,
    saveFormatVersion: lock.saveFormatVersion,
    campaignStateVersion: lock.campaignStateVersion,
    replayLogVersion: lock.replayLogVersion,
    ...contentIdentity(),
    contractLockDigest: digestOf('tests/fixtures/contracts/lock.json'),
    goldenCampaignDigest: digestOf('tests/fixtures/replays/golden-campaign.json'),
    ...state,
    commit: git(['rev-parse', '--short', 'HEAD']).trim(),
    dirty: git(['status', '--porcelain']).trim() !== '',
    node: process.version,
  };

  const suitesOf = (ids) =>
    ids.filter((id) => byId.get(id)?.status === 'passed').map((id) => STEPS.find((step) => step.id === id)?.title ?? id).join('; ') || '-';
  const browsers = [
    { name: 'Chromium', ids: ['browser', 'accessibility'] },
    { name: 'Firefox', ids: ['browser-firefox', 'accessibility-firefox'] },
    { name: 'Chrome', ids: ['browser-chrome'] },
    { name: 'Edge', ids: ['browser-edge'] },
  ]
    .filter((browser) => browser.ids.some((id) => byId.has(id)))
    .map((browser) => ({
      name: browser.name,
      version: browser.ids.map((id) => byId.get(id)?.browserVersion).find((version) => version !== undefined) ?? null,
      suites: suitesOf(browser.ids),
    }));

  const balanceReport = readJson(path.join(REPO_ROOT, 'reports', 'balance.json'));
  const balanceCandidate = readJson(path.join(REPO_ROOT, 'tests', 'fixtures', 'balance', 'candidate.json'));
  return {
    generatedFor: 'Galactic Soup',
    identity,
    judgement: judge(STEPS, results, state),
    results,
    build: byId.get('build')?.build ?? null,
    browsers,
    traceability: readJson(path.join(REPO_ROOT, 'reports', 'traceability.json')),
    performance: readJson(path.join(REPO_ROOT, 'reports', 'performance.json')),
    balance: balanceReport === null
      ? null
      : { ...balanceReport, matchesCandidate: sameBalance(balanceReport, balanceCandidate) },
    candidate: readJson(path.join(REPO_ROOT, CANDIDATE_FILE)),
  };
}
