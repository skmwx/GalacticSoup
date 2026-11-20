#!/usr/bin/env node
/**
 * `npm run verify:feature`
 *
 * The everyday verification for feature work and pull requests (Test Suite
 * Optimization Plan phase 2; Technical Specification 15.1). It runs, in order
 * and stopping at the first failure:
 *
 *   1. the type check, once;
 *   2. the architecture check and content validation;
 *   3. the unit, fast integration and component Vitest projects, in the
 *      invocations `FEATURE_VITEST_GROUPS` names (unit with component, then
 *      the fast integration selection alone: the component cases keep 5 s
 *      timeouts that sharing processors with the CPU-bound integration files
 *      exceeds, and the work is the same either way);
 *   4. traceability;
 *   5. one production build, without a second type check;
 *   6. the Chromium feature smoke (the Playwright project `feature-smoke`:
 *      the existing browser and accessibility cases tagged `@feature`) against
 *      a managed preview of that build.
 *
 * The preview is started for this run and stopped after it, on a port that
 * must be free: the run fails at once, before any other step, when something
 * already answers on it, and Vite's `--strictPort` refuses the port if it is
 * taken later. A stale server can therefore never answer for the fresh build.
 *
 * The release-only integration selection, performance, Firefox and the long
 * journeys are not run here; `npm run release:gate` runs them, and `npm run
 * verify` keeps its full behaviour.
 *
 * Writes the timings of the run to `reports/verify-feature.json`.
 *
 *   npm run verify:feature
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';
import {
  FEATURE_SMOKE_PROJECT,
  FEATURE_VITEST_GROUPS,
  PREVIEW_PORT,
} from '../config/testSelections.mjs';

const TSC = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const VITEST = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const VITE = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const PLAYWRIGHT = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const OUT = path.join(REPO_ROOT, 'reports', 'verify-feature.json');

/**
 * Whether anything accepts a connection on the port, over IPv4 or IPv6.
 * `localhost` resolves to either, depending on the machine, so both are asked.
 */
async function portAnswers(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ host, port });
      socket.setTimeout(1_000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => resolve(false));
    });
  const answers = await Promise.all(['127.0.0.1', '::1'].map(probe));
  return answers.some(Boolean);
}

/** @type {{ id: string, title: string, argv: string[], env?: Record<string, string> }[]} */
const STEPS = [
  { id: 'typecheck', title: 'Type check', argv: [TSC, '--noEmit'] },
  { id: 'architecture', title: 'Architecture check', argv: ['scripts/check-architecture.mjs'] },
  { id: 'content', title: 'Content validation', argv: ['scripts/validate-content.mjs'] },
  ...FEATURE_VITEST_GROUPS.map((group) => ({
    id: `vitest-${group.join('+')}`,
    title: `Vitest: ${group.join(', ')}`,
    argv: [VITEST, 'run', ...group.flatMap((project) => ['--project', project])],
  })),
  { id: 'traceability', title: 'Traceability', argv: ['scripts/traceability.mjs'] },
  { id: 'build', title: 'Production build', argv: [VITE, 'build'] },
  {
    id: 'smoke',
    title: 'Chromium feature smoke against a managed preview',
    argv: [PLAYWRIGHT, 'test', `--project=${FEATURE_SMOKE_PROJECT}`, '--retries=0'],
    env: { FEATURE_VERIFY_SERVE_BUILT: '1' },
  },
];

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const started = Date.now();
/** @type {{ id: string, title: string, status: string, durationMs: number, exitCode?: number | null }[]} */
const results = [];

function finish(ok, reason) {
  const record = {
    startedAt: new Date(started).toISOString(),
    ok,
    ...(reason === undefined ? {} : { reason }),
    durationMs: Date.now() - started,
    port: PREVIEW_PORT,
    node: process.version,
    steps: results,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write('\nverify:feature\n');
  for (const step of results) {
    process.stdout.write(`  ${step.status.padEnd(7)} ${step.id.padEnd(30)} ${seconds(step.durationMs).padStart(8)}\n`);
  }
  process.stdout.write(`  ${ok ? 'PASSED' : 'FAILED'} in ${seconds(record.durationMs)}${reason === undefined ? '' : `: ${reason}`}\n`);
  process.exit(ok ? 0 : 1);
}

// The port is checked before anything runs, so an occupied port costs no time.
if (await portAnswers(PREVIEW_PORT)) {
  results.push({ id: 'port', title: `Port ${String(PREVIEW_PORT)} is free`, status: 'failed', durationMs: Date.now() - started });
  finish(
    false,
    `port ${String(PREVIEW_PORT)} is already in use. verify:feature serves the build it has just made and will not ` +
      'reuse another server; stop whatever is listening there (for example an `npm run preview`) and run it again',
  );
}

for (const step of STEPS) {
  process.stdout.write(`\n> ${step.title}\n`);
  const begin = Date.now();
  const result = spawnSync(process.execPath, step.argv, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(step.env ?? {}) },
  });
  const durationMs = Date.now() - begin;
  const passed = result.status === 0;
  results.push({ id: step.id, title: step.title, status: passed ? 'passed' : 'failed', durationMs, exitCode: result.status });
  if (!passed) finish(false, `${step.title} failed (exit ${String(result.status)})`);
}
finish(true);
