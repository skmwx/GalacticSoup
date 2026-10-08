/**
 * The release gate's bookkeeping (MVP Implementation Plan phase 21).
 *
 * The gate is a list of steps - the checks of `npm run verify`, the production
 * build, and the browser suites in every release target - and each step writes
 * what it found to `reports/release/steps/`. A step also writes down what it
 * was run against: a digest of the sources and, for a browser suite, the
 * fingerprint of the bundle it was served. The verdict is green only when
 * every required step passed against the sources and the bundle that are there
 * now, so a result left over from an earlier state cannot pass for evidence.
 *
 * This module holds the parts that decide: the digests, the audit of the
 * built bundle, the reading of a test runner's result file, the verdict and
 * the report. It reads files and returns data. `scripts/release-gate.mjs`
 * runs the steps, and a unit test holds these functions to their rules.
 *
 * @implements TECH-3.2, TECH-15.1
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RELEASE_DIR = path.join('reports', 'release');
export const CANDIDATE_FILE = path.join('config', 'release-candidate.json');

/**
 * Paths that are not part of the candidate: documents, generated reports and
 * the candidate record itself, which is written from a green gate.
 */
const OUTSIDE_THE_CANDIDATE = [/^docs\//, /^\.claude\//, /\.md$/, /^config\/release-candidate\.json$/];

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** A checkout may hold text with either line ending; the digest must not care. */
function normalised(buffer) {
  if (buffer.includes(0)) return buffer;
  return Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

/** Whether a repository path belongs to the candidate. */
export function isCandidateSource(file) {
  return !OUTSIDE_THE_CANDIDATE.some((pattern) => pattern.test(file));
}

/**
 * One digest over every source file of the candidate.
 *
 * @param {string} root
 * @param {readonly string[]} files repository-relative paths with forward slashes
 */
export function sourceDigest(root, files) {
  const hash = createHash('sha256');
  for (const file of [...files].filter(isCandidateSource).sort()) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    hash.update(`${file}\0${sha256(normalised(fs.readFileSync(absolute)))}\n`);
  }
  return hash.digest('hex');
}

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(absolute, base));
    else found.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return found.sort();
}

/**
 * The files of a built bundle and one fingerprint over them. Source maps are
 * shipped files too, so they count.
 *
 * @param {string} distDir
 */
export function fingerprintBuild(distDir) {
  const files = listFiles(distDir).map((file) => {
    const bytes = fs.readFileSync(path.join(distDir, file));
    return { file, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const hash = createHash('sha256');
  for (const entry of files) hash.update(`${entry.file}\0${entry.sha256}\n`);
  return { fingerprint: files.length === 0 ? null : hash.digest('hex'), files };
}

/**
 * Ways a script can reach the network or run text as code. None may appear in
 * the shipped scripts: the game makes no request of its own (Technical
 * Specification 2, 3.1) and evaluates nothing (Technical Specification 14).
 */
const FORBIDDEN_IN_SCRIPTS = [
  ['fetch', /(?<![\w$.])fetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bnew\s+WebSocket\b/],
  ['EventSource', /\bnew\s+EventSource\b/],
  ['sendBeacon', /\.sendBeacon\s*\(/],
  ['importScripts', /\bimportScripts\s*\(/],
  ['service worker registration', /serviceWorker\s*\.\s*register\s*\(/],
  ['eval', /(?<![\w$.])eval\s*\(/],
  ['Function constructor', /\bnew\s+Function\s*\(/],
];

/** An address in markup that would leave the build's own origin. */
const FOREIGN_REFERENCE = /\b(?:src|href|action|poster|data)\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * Audits a built bundle for anything that could make a request outside its
 * own files, and checks that the engine worker carries the content it was
 * built from.
 *
 * @param {string} distDir
 * @param {{ contentHash?: string }} [expected]
 * @returns {{ ok: boolean, findings: string[], scripts: string[], worker: string | null }}
 */
export function auditBuild(distDir, expected = {}) {
  /** @type {string[]} */
  const findings = [];
  const files = listFiles(distDir);
  if (!files.includes('index.html')) findings.push('index.html is missing from the build');

  const scripts = files.filter((file) => file.endsWith('.js'));
  for (const file of files.filter((entry) => entry.endsWith('.html'))) {
    const markup = fs.readFileSync(path.join(distDir, file), 'utf8');
    if (FOREIGN_REFERENCE.test(markup)) findings.push(`${file} refers to an address outside the build`);
    if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(markup)) findings.push(`${file} carries an inline script`);
    // A page that declares no icon makes the browser ask for /favicon.ico by
    // itself. An icon written into the page is never asked for at all.
    const icon = /<link\b[^>]*\brel\s*=\s*["']?icon\b[^>]*>/i.exec(markup)?.[0];
    const iconFile = icon === undefined ? undefined : /\bhref\s*=\s*["']?\/?([^"'\s>]+)/i.exec(icon)?.[1];
    if (iconFile === undefined) {
      findings.push(`${file} declares no icon, so a browser will ask for one the build does not hold`);
    } else if (!iconFile.startsWith('data:') && !files.includes(iconFile)) {
      findings.push(`${file} declares the icon ${iconFile}, which is not in the build`);
    }
  }
  for (const file of files.filter((entry) => entry.endsWith('.svg'))) {
    const image = fs.readFileSync(path.join(distDir, file), 'utf8');
    if (/<script\b|<foreignObject\b|\son[a-z]+\s*=/i.test(image)) findings.push(`${file} carries script or foreign content`);
    if (/\b(?:href|src)\s*=\s*["']\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(image)) {
      findings.push(`${file} refers to an address outside the build`);
    }
  }
  for (const file of scripts) {
    const source = fs.readFileSync(path.join(distDir, file), 'utf8');
    for (const [name, pattern] of FORBIDDEN_IN_SCRIPTS) {
      if (pattern.test(source)) findings.push(`${file} uses ${name}`);
    }
  }
  for (const file of files.filter((entry) => entry.endsWith('.css'))) {
    const styles = fs.readFileSync(path.join(distDir, file), 'utf8');
    if (/@import\b|url\(\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(styles)) {
      findings.push(`${file} loads a resource from outside the build`);
    }
  }

  const worker = scripts.find((file) => /engineWorker/.test(file)) ?? null;
  if (worker === null) {
    findings.push('the engine worker bundle is missing from the build');
  } else if (expected.contentHash !== undefined) {
    const source = fs.readFileSync(path.join(distDir, worker), 'utf8');
    if (!source.includes(expected.contentHash)) {
      findings.push(`${worker} does not carry content ${expected.contentHash.slice(0, 12)}`);
    }
  }
  return { ok: findings.length === 0, findings, scripts, worker };
}

/**
 * Test counts from a Vitest JSON result.
 *
 * @param {any} result
 */
export function readVitestResult(result) {
  /** @type {string[]} */
  const failures = [];
  for (const file of result.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'failed') failures.push(assertion.fullName ?? assertion.title ?? 'unnamed test');
    }
    if ((file.assertionResults ?? []).length === 0 && file.status === 'failed') {
      failures.push(`${String(file.name ?? 'a test file')} did not run`);
    }
  }
  return {
    total: result.numTotalTests ?? 0,
    passed: result.numPassedTests ?? 0,
    failed: result.numFailedTests ?? 0,
    skipped: (result.numPendingTests ?? 0) + (result.numTodoTests ?? 0),
    flaky: 0,
    files: (result.testResults ?? []).length,
    failures,
  };
}

/**
 * Test counts from a Playwright JSON result.
 *
 * @param {any} result
 */
export function readPlaywrightResult(result) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const flaky = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const name = [...trail, spec.title].filter(Boolean).join(' > ');
        if (test.status === 'unexpected') failures.push(name);
        if (test.status === 'flaky') flaky.push(name);
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  };
  for (const suite of result.suites ?? []) walk(suite, [suite.title]);
  const stats = result.stats ?? {};
  const passed = stats.expected ?? 0;
  const failed = stats.unexpected ?? 0;
  const skipped = stats.skipped ?? 0;
  return {
    total: passed + failed + skipped + (stats.flaky ?? 0),
    passed,
    failed,
    skipped,
    flaky: stats.flaky ?? 0,
    files: (result.suites ?? []).length,
    failures: [...failures, ...flaky.map((name) => `${name} (passed on a retry)`)],
  };
}

/**
 * @typedef {object} StepPlan
 * @property {string} id
 * @property {string} title
 * @property {boolean} [optional] a step that may be skipped without failing the gate
 * @property {boolean} [served] a step that is served the built bundle
 *
 * @typedef {object} StepResult
 * @property {string} id
 * @property {'passed' | 'failed' | 'skipped'} status
 * @property {string} sourceDigest
 * @property {string | null} [buildFingerprint]
 * @property {string} [reason]
 */

/**
 * The gate's verdict: green only when every required step passed against the
 * sources and the bundle that are there now.
 *
 * @param {readonly StepPlan[]} plan
 * @param {readonly StepResult[]} results
 * @param {{ sourceDigest: string, buildFingerprint: string | null }} current
 */
export function judge(plan, results, current) {
  const byId = new Map(results.map((result) => [result.id, result]));
  /** @type {string[]} */
  const problems = [];
  const steps = plan.map((step) => {
    const result = byId.get(step.id);
    /** @type {'passed' | 'failed' | 'skipped' | 'missing' | 'stale'} */
    let state;
    let note = '';
    if (result === undefined) {
      state = 'missing';
      note = 'not run';
    } else if (result.sourceDigest !== current.sourceDigest) {
      state = 'stale';
      note = 'run against sources that have since changed';
    } else if (
      step.served === true &&
      result.status === 'passed' &&
      (current.buildFingerprint === null || result.buildFingerprint !== current.buildFingerprint)
    ) {
      state = 'stale';
      note = 'run against a bundle that is not the one built now';
    } else {
      state = result.status;
      note = result.reason ?? '';
    }
    const blocks = state === 'skipped' ? step.optional !== true : state !== 'passed';
    if (blocks) problems.push(`${step.id}: ${state}${note === '' ? '' : ` (${note})`}`);
    return { id: step.id, title: step.title, state, note, optional: step.optional === true };
  });
  const everyRequiredRan = steps.every((step) => step.state !== 'missing' && step.state !== 'stale');
  /** @type {'green' | 'red' | 'incomplete'} */
  const verdict = problems.length === 0 ? 'green' : everyRequiredRan ? 'red' : (
    steps.some((step) => step.state === 'failed') ? 'red' : 'incomplete'
  );
  return { verdict, problems, steps };
}

function duration(ms) {
  if (ms === undefined || ms === null) return '-';
  if (ms < 1_000) return `${String(Math.round(ms))} ms`;
  if (ms < 90_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function tests(result) {
  if (result?.tests === undefined) return '-';
  const { passed, failed, skipped, flaky } = result.tests;
  const parts = [`${String(passed)} passed`];
  if (failed > 0) parts.push(`${String(failed)} failed`);
  if (flaky > 0) parts.push(`${String(flaky)} on a retry`);
  if (skipped > 0) parts.push(`${String(skipped)} skipped`);
  return parts.join(', ');
}

const STATE_LABEL = {
  passed: 'passed',
  failed: 'FAILED',
  skipped: 'skipped',
  missing: 'NOT RUN',
  stale: 'STALE',
};

/**
 * The gate's evidence as Markdown.
 *
 * @param {object} evidence
 */
export function renderGateReport(evidence) {
  const { identity, judgement, results, build, browsers, traceability, performance, balance, candidate } = evidence;
  const byId = new Map(results.map((result) => [result.id, result]));
  const lines = [
    '# Release gate evidence',
    '',
    'Generated by `npm run release:gate` (MVP Implementation Plan phase 21). Do not edit by hand.',
    '',
    `**Automated gate: ${judgement.verdict.toUpperCase()}.**` +
      (judgement.verdict === 'green'
        ? ' Every required step passed against the sources and the bundle identified below.'
        : ''),
    '',
  ];
  if (judgement.problems.length > 0) {
    lines.push('What stands in the way:', '');
    for (const problem of judgement.problems) lines.push(`- ${problem}`);
    lines.push('');
  }

  lines.push(
    '## Candidate identity',
    '',
    '| | |',
    '|---|---|',
    `| Application version | ${identity.applicationVersion} |`,
    `| Engine version | ${identity.engineVersion} |`,
    `| Protocol version | ${String(identity.protocolVersion)} |`,
    `| Save format version | ${String(identity.saveFormatVersion)} |`,
    `| Campaign state version | ${String(identity.campaignStateVersion)} |`,
    `| Replay log version | ${String(identity.replayLogVersion)} |`,
    `| Content version | ${identity.contentVersion} |`,
    `| Content hash | \`${identity.contentHash}\` |`,
    `| Tuning digest | \`${identity.tuningDigest}\` |`,
    `| Contract lock digest | \`${identity.contractLockDigest}\` |`,
    `| Golden campaign digest | \`${identity.goldenCampaignDigest}\` |`,
    `| Source digest | \`${identity.sourceDigest}\` |`,
    `| Build fingerprint | ${identity.buildFingerprint === null ? 'no build present' : `\`${identity.buildFingerprint}\``} |`,
    `| Commit | ${identity.commit}${identity.dirty ? ' with uncommitted changes' : ''} |`,
    `| Node.js | ${identity.node} |`,
    '',
  );
  if (candidate !== null) {
    const same = candidate.sourceDigest === identity.sourceDigest && candidate.buildFingerprint === identity.buildFingerprint;
    lines.push(
      same
        ? `This is the recorded candidate **${candidate.candidate}** (\`config/release-candidate.json\`).`
        : `The recorded candidate is **${candidate.candidate}**; the sources or the bundle have changed since it was recorded, so this is not it.`,
      '',
    );
  } else {
    lines.push('No candidate has been recorded yet (`npm run release:record`).', '');
  }

  lines.push('## Steps', '', '| Step | Result | Tests | Took | Finished |', '|---|---|---|---|---|');
  for (const step of judgement.steps) {
    const result = byId.get(step.id);
    const state = STATE_LABEL[step.state] + (step.note === '' ? '' : ` - ${step.note}`);
    lines.push(
      `| ${step.title}${step.optional ? ' (optional)' : ''} | ${state} | ${tests(result)} | ` +
        `${duration(result?.durationMs)} | ${result?.finishedAt ?? '-'} |`,
    );
  }
  lines.push('');
  const failing = results.filter((result) => (result.tests?.failures ?? []).length > 0);
  if (failing.length > 0) {
    lines.push('### Failing or retried tests', '');
    for (const result of failing) {
      for (const name of result.tests.failures) lines.push(`- ${result.id}: ${name}`);
    }
    lines.push('');
  }

  lines.push('## The bundle', '');
  if (build === null) {
    lines.push('The build step has not run.', '');
  } else {
    lines.push(
      `Built twice from the same sources: ${build.reproducible ? 'both builds are byte for byte the same' : '**the two builds differ**'}.`,
      build.audit.ok
        ? 'No script in it can make a request or evaluate text, no markup or style refers outside the build, and the engine worker carries the content named above.'
        : `**Audit findings:** ${build.audit.findings.join('; ')}.`,
      '',
      '| File | Bytes | SHA-256 |',
      '|---|---|---|',
    );
    for (const file of build.files) {
      lines.push(`| \`${file.file}\` | ${file.bytes.toLocaleString('en-US')} | \`${file.sha256.slice(0, 16)}\` |`);
    }
    lines.push('');
  }

  if (browsers.length > 0) {
    lines.push('## Browsers', '', '| Browser | Version | Suites |', '|---|---|---|');
    for (const browser of browsers) {
      lines.push(`| ${browser.name} | ${browser.version ?? 'not installed'} | ${browser.suites} |`);
    }
    lines.push('');
  }

  if (traceability !== null) {
    lines.push(
      '## Traceability',
      '',
      `${String(traceability.summary.requirements)} requirements: ${String(traceability.summary.included)} included, ` +
        `${String(traceability.summary.covered)} covered, ${String(traceability.summary.uncovered)} uncovered, ` +
        `${String(traceability.summary.deferred)} deferred. The full table is \`reports/traceability.md\`.`,
      '',
      '| Acceptance criterion | Integration | Browser | Accessibility | Other levels |',
      '|---|---|---|---|---|',
    );
    for (const requirement of traceability.requirements.filter((entry) => entry.id.startsWith('MVP-AC-'))) {
      const other = requirement.tests.unit.length + requirement.tests.component.length + requirement.tests.performance.length;
      lines.push(
        `| ${requirement.id} ${requirement.title} | ${String(requirement.tests.integration.length)} | ` +
          `${String(requirement.tests.browser.length)} | ${String(requirement.tests.accessibility.length)} | ${String(other)} |`,
      );
    }
    lines.push('', 'Counts are test files that name the criterion.', '');
  }

  if (performance !== null) {
    lines.push(
      '## Performance',
      '',
      `Measured at ${performance.fixture.encounterId} with ${String(performance.fixture.ships)} ships, content ${performance.contentVersion}.`,
      '',
      '| Target (Technical Specification 13) | Budget | Measured |',
      '|---|---|---|',
      `| One 50 ms quantum, 95th percentile, production checks | ${String(performance.targets.quantumP95Ms)} ms | ${String(performance.quantum.best.p95Ms)} ms (median ${String(performance.quantum.best.medianMs)} ms) |`,
      `| The same with complete checks, as tests and development run | recorded | ${String(performance.quantumWithCompleteChecks.best.p95Ms)} ms |`,
      `| A non-advancing command or query, 95th percentile | ${String(performance.targets.requestP95Ms)} ms | ${String(performance.request.p95Ms)} ms |`,
      `| Snapshot capture, 95th percentile | ${performance.targets.snapshotMs.toFixed(1)} ms | ${String(performance.snapshotCapture.p95Ms)} ms |`,
      `| Open a validated campaign, 95th percentile | ${String(performance.targets.openCampaignMs)} ms | ${String(performance.snapshotOpen.p95Ms)} ms |`,
      '',
    );
  }

  if (balance !== null) {
    lines.push(
      '## Balance fixtures',
      '',
      `Tuning digest \`${balance.tuningDigest.slice(0, 16)}\`, ${String(balance.seeds.length)} fixture seeds` +
        (balance.matchesCandidate ? ', identical to the recorded balance candidate.' : ', **differs from the recorded balance candidate**.'),
      'The full report is `reports/balance.md`.',
      '',
      '| Scenario | Completed | Median fight | Hit points lost |',
      '|---|---|---|---|',
    );
    for (const [id, scenario] of Object.entries(balance.headline.scenarios)) {
      lines.push(
        `| ${id} | ${String(scenario.completed)}/${String(scenario.planned)} | ` +
          `${scenario.medianFightSeconds === null ? '-' : `${String(scenario.medianFightSeconds)} s`} | ` +
          `${(scenario.hitPointsLost * 100).toFixed(0)}% |`,
      );
    }
    lines.push('', '| Career | Seeds finished | Sorties | Simulated minutes |', '|---|---|---|---|');
    for (const [id, runs] of Object.entries(balance.headline.careers)) {
      const all = Object.values(runs);
      const range = (values) => {
        const low = Math.min(...values);
        const high = Math.max(...values);
        return low === high ? String(low) : `${String(low)}-${String(high)}`;
      };
      lines.push(
        `| ${id} | ${String(all.filter((run) => run.finished).length)}/${String(all.length)} | ` +
          `${range(all.map((run) => run.sorties))} | ${range(all.map((run) => run.simulationMinutes))} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
