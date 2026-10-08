import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  auditBuild,
  fingerprintBuild,
  isCandidateSource,
  judge,
  readPlaywrightResult,
  readVitestResult,
  renderGateReport,
  sourceDigest,
} from '../../../scripts/lib/release.mjs';

/**
 * The release gate's bookkeeping (MVP Implementation Plan phase 21).
 *
 * `npm run release:gate` runs the steps. These tests hold the parts that
 * decide to their rules: what counts as the candidate, what a built bundle may
 * not contain, and when a set of step records adds up to a green gate.
 */

const created: string[] = [];

function directory(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galactic-soup-release-'));
  created.push(root);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content, 'utf8');
  }
  return root;
}

afterEach(() => {
  for (const root of created.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const CONTENT_HASH = 'a'.repeat(64);

function build(overrides: Record<string, string> = {}): string {
  return directory({
    'index.html':
      '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-1.js"></script>' +
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />' +
      '<link rel="stylesheet" crossorigin href="/assets/index-1.css"></head><body><div id="root"></div></body></html>',
    'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="5"/></svg>',
    'assets/index-1.js': 'const link="https://react.dev/errors/";new Worker(new URL("/assets/engineWorker-1.js",import.meta.url));',
    'assets/index-1.css': '.frame{color:red}',
    'assets/engineWorker-1.js': `const bundle={contentHash:"${CONTENT_HASH}"};self.onmessage=()=>{};`,
    ...overrides,
  });
}

describe('the candidate sources', () => {
  it('leaves documents, reports of the gate and the candidate record outside the candidate [TECH-15.1]', () => {
    expect(isCandidateSource('src/engine/index.ts')).toBe(true);
    expect(isCandidateSource('content/rules/combat.json')).toBe(true);
    expect(isCandidateSource('tests/browser/offline.spec.ts')).toBe(true);
    expect(isCandidateSource('package-lock.json')).toBe(true);

    expect(isCandidateSource('docs/MVPScope.md')).toBe(false);
    expect(isCandidateSource('README.md')).toBe(false);
    expect(isCandidateSource('config/release-candidate.json')).toBe(false);
  });

  it('gives one digest whichever line ending a checkout holds, and another when a source changes [TECH-15.1]', () => {
    const unix = directory({ 'src/a.ts': 'one\ntwo\n', 'content/b.json': '{}\n', 'docs/note.md': 'first' });
    const windows = directory({ 'src/a.ts': 'one\r\ntwo\r\n', 'content/b.json': '{}\r\n', 'docs/note.md': 'second' });
    const changed = directory({ 'src/a.ts': 'one\nthree\n', 'content/b.json': '{}\n' });
    const files = ['src/a.ts', 'content/b.json', 'docs/note.md'];

    const digest = sourceDigest(unix, files);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceDigest(windows, [...files].reverse())).toBe(digest);
    expect(sourceDigest(changed, files)).not.toBe(digest);
  });
});

describe('the built bundle', () => {
  it('has one fingerprint over every shipped file, and none when there is no build [TECH-15.1]', () => {
    const first = fingerprintBuild(build());
    const same = fingerprintBuild(build());
    const different = fingerprintBuild(build({ 'assets/index-1.css': '.frame{color:blue}' }));

    expect(first.files.map((entry) => entry.file)).toEqual([
      'assets/engineWorker-1.js',
      'assets/index-1.css',
      'assets/index-1.js',
      'favicon.svg',
      'index.html',
    ]);
    expect(same.fingerprint).toBe(first.fingerprint);
    expect(different.fingerprint).not.toBe(first.fingerprint);
    expect(fingerprintBuild(path.join(os.tmpdir(), 'galactic-soup-no-such-build')).fingerprint).toBeNull();
  });

  it('passes a bundle that holds only its own files and the content it was built from [TECH-3.2]', () => {
    const audit = auditBuild(build(), { contentHash: CONTENT_HASH });

    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(audit.worker).toBe('assets/engineWorker-1.js');
  });

  it.each([
    ['a request from a script', { 'assets/index-1.js': 'const data=await fetch("/data.json");' }, /index-1\.js uses fetch/],
    ['a request from the worker', { 'assets/engineWorker-1.js': `const h="${CONTENT_HASH}";new WebSocket("wss://example.invalid");` }, /engineWorker-1\.js uses WebSocket/],
    ['a beacon', { 'assets/index-1.js': 'navigator.sendBeacon("/log","x");' }, /uses sendBeacon/],
    ['a script from elsewhere', { 'index.html': '<script src="https://example.invalid/a.js"></script>' }, /index\.html refers to an address outside the build/],
    ['a protocol-relative stylesheet', { 'index.html': '<link rel="stylesheet" href="//example.invalid/a.css">' }, /index\.html refers to an address outside the build/],
    ['an inline script', { 'index.html': '<script>window.x = 1</script>' }, /index\.html carries an inline script/],
    ['a page without an icon, which makes the browser ask for one', { 'index.html': '<script type="module" src="/assets/index-1.js"></script>' }, /index\.html declares no icon/],
    ['an icon that was not built', { 'index.html': '<link rel="icon" href="/mark.svg">' }, /declares the icon mark\.svg, which is not in the build/],
    ['an image that loads from elsewhere', { 'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a.png"/></svg>' }, /favicon\.svg refers to an address outside the build/],
    ['a font from elsewhere', { 'assets/index-1.css': '@font-face{src:url(https://example.invalid/f.woff2)}' }, /index-1\.css loads a resource from outside the build/],
  ] as const)('refuses %s [TECH-2, TECH-3.2]', (_, files, finding) => {
    const audit = auditBuild(build(files), { contentHash: CONTENT_HASH });

    expect(audit.ok).toBe(false);
    expect(audit.findings.join('\n')).toMatch(finding);
  });

  it.each([
    ['eval', 'const value=eval("1+1");', /uses eval/],
    ['a function built from text', 'const make=new Function("return 1");', /uses Function constructor/],
  ] as const)('refuses %s [TECH-14]', (_, source, finding) => {
    const audit = auditBuild(build({ 'assets/index-1.js': source }), { contentHash: CONTENT_HASH });

    expect(audit.findings.join('\n')).toMatch(finding);
  });

  it('accepts an icon written into the page, which is never asked for [TECH-3.2]', () => {
    const inline =
      '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3C/svg%3E" />' +
      '<script type="module" crossorigin src="/assets/index-1.js"></script>';

    expect(auditBuild(build({ 'index.html': inline }), { contentHash: CONTENT_HASH }).findings).toEqual([]);
  });

  it.each([
    ['a script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['an event handler', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'],
    ['embedded markup', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p>x</p></foreignObject></svg>'],
  ] as const)('refuses an image that carries %s [TECH-14]', (_, image) => {
    const audit = auditBuild(build({ 'favicon.svg': image }), { contentHash: CONTENT_HASH });

    expect(audit.findings).toContain('favicon.svg carries script or foreign content');
  });

  it('does not mistake a method or a longer name for a request [TECH-3.2]', () => {
    const audit = auditBuild(
      build({ 'assets/index-1.js': 'store.fetch(1);prefetch(2);const fetchPriority="high";medieval(3);' }),
      { contentHash: CONTENT_HASH },
    );

    expect(audit.findings).toEqual([]);
  });

  it('refuses a worker that was built from other content, and a build without one [TECH-6.3]', () => {
    expect(auditBuild(build(), { contentHash: 'b'.repeat(64) }).findings.join('\n')).toMatch(
      /engineWorker-1\.js does not carry content bbbbbbbbbbbb/,
    );

    const root = build();
    fs.rmSync(path.join(root, 'assets', 'engineWorker-1.js'));
    expect(auditBuild(root, { contentHash: CONTENT_HASH }).findings).toContain(
      'the engine worker bundle is missing from the build',
    );
  });
});

describe('a test runner result', () => {
  it('reads the counts and the failing names of a Vitest run [TECH-15.1]', () => {
    const tests = readVitestResult({
      numTotalTests: 4,
      numPassedTests: 2,
      numFailedTests: 1,
      numPendingTests: 1,
      testResults: [
        {
          name: 'a.test.ts',
          status: 'failed',
          assertionResults: [
            { status: 'passed', fullName: 'a passes' },
            { status: 'failed', fullName: 'a fails' },
          ],
        },
        { name: 'b.test.ts', status: 'failed', assertionResults: [] },
      ],
    });

    expect(tests).toMatchObject({ total: 4, passed: 2, failed: 1, skipped: 1 });
    expect(tests.failures).toEqual(['a fails', 'b.test.ts did not run']);
  });

  it('reads the counts of a Playwright run, and names a test that passed only on a retry [TECH-15.1]', () => {
    const tests = readPlaywrightResult({
      stats: { expected: 3, unexpected: 1, flaky: 1, skipped: 0 },
      suites: [
        {
          title: 'boot.spec.ts',
          specs: [{ title: 'starts', tests: [{ status: 'expected' }] }],
          suites: [
            {
              title: 'application boot',
              specs: [
                { title: 'reaches the engine', tests: [{ status: 'unexpected' }] },
                { title: 'saves', tests: [{ status: 'flaky' }] },
              ],
            },
          ],
        },
      ],
    });

    expect(tests).toMatchObject({ total: 5, passed: 3, failed: 1, flaky: 1, skipped: 0 });
    expect(tests.failures).toEqual([
      'boot.spec.ts > application boot > reaches the engine',
      'boot.spec.ts > application boot > saves (passed on a retry)',
    ]);
  });
});

describe('the verdict', () => {
  const plan = [
    { id: 'unit', title: 'Unit suite' },
    { id: 'build', title: 'Production build' },
    { id: 'browser', title: 'Browser suite', served: true },
    { id: 'browser-edge', title: 'Edge', served: true, optional: true },
  ];
  const current = { sourceDigest: 'source-1', buildFingerprint: 'build-1' };
  const passed = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    status: 'passed' as const,
    sourceDigest: 'source-1',
    buildFingerprint: 'build-1',
    ...overrides,
  });
  const all = [passed('unit'), passed('build'), passed('browser'), passed('browser-edge')];

  it('is green when every step passed against the sources and the bundle that are there now [TECH-15.1]', () => {
    const judgement = judge(plan, all, current);

    expect(judgement.verdict).toBe('green');
    expect(judgement.problems).toEqual([]);
  });

  it('is incomplete while a step has not run, optional or not [TECH-15.1]', () => {
    expect(judge(plan, all.slice(0, 3), current)).toMatchObject({
      verdict: 'incomplete',
      problems: ['browser-edge: missing (not run)'],
    });
  });

  it('is red when a step failed [TECH-15.1]', () => {
    const judgement = judge(plan, [passed('unit', { status: 'failed' }), ...all.slice(1)], current);

    expect(judgement.verdict).toBe('red');
    expect(judgement.problems).toEqual(['unit: failed']);
  });

  it('does not count a pass recorded against sources that have since changed [TECH-15.1]', () => {
    const judgement = judge(plan, [passed('unit', { sourceDigest: 'source-0' }), ...all.slice(1)], current);

    expect(judgement.verdict).toBe('incomplete');
    expect(judgement.steps[0]).toMatchObject({ state: 'stale' });
  });

  it('does not count a browser pass against a bundle that is not the one built now [TECH-15.1]', () => {
    const results = [passed('unit'), passed('build'), passed('browser', { buildFingerprint: 'build-0' }), passed('browser-edge')];

    expect(judge(plan, results, current).problems).toEqual([
      'browser: stale (run against a bundle that is not the one built now)',
    ]);
    // A step that is not served the bundle does not depend on it.
    expect(judge(plan, [passed('unit', { buildFingerprint: null }), ...all.slice(1)], current).verdict).toBe('green');
    // With no bundle at all, no browser pass counts.
    expect(judge(plan, all, { sourceDigest: 'source-1', buildFingerprint: null }).verdict).toBe('incomplete');
  });

  it('lets only an optional step be skipped [TECH-15.1]', () => {
    const skipped = (id: string) => passed(id, { status: 'skipped', reason: 'msedge is not installed on this machine' });

    expect(judge(plan, [...all.slice(0, 3), skipped('browser-edge')], current).verdict).toBe('green');
    expect(judge(plan, [...all.slice(0, 2), skipped('browser'), all[3]!], current)).toMatchObject({
      verdict: 'red',
      problems: ['browser: skipped (msedge is not installed on this machine)'],
    });
  });
});

describe('the gate report', () => {
  it('states the verdict, the identity and each step, and says what stands in the way [TECH-15.1]', () => {
    const plan = [{ id: 'unit', title: 'Unit suite' }, { id: 'browser', title: 'Browser suite', served: true }];
    const results = [
      {
        id: 'unit',
        status: 'passed' as const,
        sourceDigest: 'source-1',
        buildFingerprint: null,
        durationMs: 32_000,
        finishedAt: '2026-10-08T10:00:00Z',
        tests: { total: 3, passed: 3, failed: 0, skipped: 0, flaky: 0, failures: [] },
      },
    ];
    const current = { sourceDigest: 'source-1', buildFingerprint: null };
    const report = renderGateReport({
      identity: {
        applicationVersion: '0.1.0',
        engineVersion: '0.1.0',
        protocolVersion: 14,
        saveFormatVersion: 10,
        campaignStateVersion: 10,
        replayLogVersion: 1,
        contentVersion: '0.1.0+aaaaaaaaaaaa',
        contentHash: CONTENT_HASH,
        tuningDigest: 'c'.repeat(64),
        contractLockDigest: 'd'.repeat(64),
        goldenCampaignDigest: 'e'.repeat(64),
        ...current,
        commit: 'abc1234',
        dirty: false,
        node: 'v24.0.0',
      },
      judgement: judge(plan, results, current),
      results,
      build: null,
      browsers: [],
      traceability: null,
      performance: null,
      balance: null,
      candidate: null,
    });

    expect(report).toContain('**Automated gate: INCOMPLETE.**');
    expect(report).toContain('- browser: missing (not run)');
    expect(report).toContain('| Protocol version | 14 |');
    expect(report).toContain('| Unit suite | passed | 3 passed | 32.0 s | 2026-10-08T10:00:00Z |');
    expect(report).toContain('| Browser suite | NOT RUN - not run | - | - | - |');
    expect(report).toContain('No candidate has been recorded yet');
  });
});
