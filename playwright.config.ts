import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

import { BRANDED_ONLY_SPECS, FEATURE_SMOKE_PROJECT, FEATURE_TAG, PREVIEW_PORT } from './config/testSelections.mjs';

const PORT = PREVIEW_PORT;
const BASE_URL = `http://localhost:${PORT}`;

// The release gate builds the bundle once, fingerprints it and then serves
// exactly those files to every browser suite; an ordinary run builds first
// (MVP Implementation Plan phase 21).
const SERVE_BUILT = process.env['RELEASE_GATE_SERVE_BUILT'] === '1';
// `npm run verify:feature` has just built the bundle and manages its own
// preview: it serves that build and never reuses a server that is already on
// the port, so a stale preview cannot answer for the fresh build (Test Suite
// Optimization Plan phase 2).
const FEATURE_VERIFY = process.env['FEATURE_VERIFY_SERVE_BUILT'] === '1';
const RESULTS_FILE = process.env['RELEASE_GATE_RESULTS'];
// The short branded offline flow runs only in Chrome and Edge; the required
// browser projects run the whole offline sortie instead (Test Suite
// Optimization Plan phase 9).
const BRANDED_ONLY = BRANDED_ONLY_SPECS.map((file) => `**/${file}`);

const reporter: ReporterDescription[] = process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']];
if (RESULTS_FILE !== undefined) reporter.push(['json', { outputFile: RESULTS_FILE }]);

// Browser-level checks run against the production build so that the boot path,
// the module worker and content loading are exercised as shipped
// (Technical Specification 3.1, 3.2, 15.1).
//
// The release targets are current Chromium-based browsers and Firefox (MVP
// Scope 7). `browser` and `accessibility` run in the Chromium Playwright
// bundles and are the everyday suites; the `-firefox` projects run the same
// files in Firefox. `browser-chrome` and `browser-edge` run them in the
// branded stable builds installed on this machine, which the release gate uses
// for the short start, save and offline flows (`BRANDED_SMOKE_SPECS`).
// @implements TECH-3.2, TECH-15.1
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'browser',
      testDir: 'tests/browser',
      testIgnore: BRANDED_ONLY,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'accessibility',
      testDir: 'tests/accessibility',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'browser-firefox',
      testDir: 'tests/browser',
      testIgnore: BRANDED_ONLY,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'accessibility-firefox',
      testDir: 'tests/accessibility',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      // The Chromium feature smoke of `npm run verify:feature`: the existing
      // browser and accessibility cases tagged @feature, which stay in the
      // four release projects above. The release gate names its projects, so
      // it never runs this one and no case runs twice in the gate.
      name: FEATURE_SMOKE_PROJECT,
      testDir: 'tests',
      testMatch: ['browser/**/*.spec.ts', 'accessibility/**/*.spec.ts'],
      grep: new RegExp(FEATURE_TAG),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'browser-chrome',
      testDir: 'tests/browser',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'browser-edge',
      testDir: 'tests/browser',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
  webServer: {
    command: SERVE_BUILT || FEATURE_VERIFY
      ? `npm run preview -- --port ${PORT} --strictPort`
      : `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'] && !FEATURE_VERIFY,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
