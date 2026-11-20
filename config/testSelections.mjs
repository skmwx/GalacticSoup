/**
 * Named test selections shared by the Vitest configuration, the npm scripts,
 * the release gate and `scripts/test-discovery.mjs`, so that each selection is
 * declared once (Test Suite Optimization Plan phases 0-1; Technical
 * Specification 15.1).
 *
 * Integration tests are split into two disjoint Vitest projects:
 *
 *   - `integration-fast`: every integration file that is not release-only.
 *     It keeps replay, persistence, properties, the golden campaign and the
 *     fixed-seed Scout sortie of `encounter.test.ts`, and is what feature
 *     verification runs.
 *   - `integration-release`: the long headless simulations - the balance
 *     careers and fit matrix, the progression scenarios and the site ladder.
 *     They write the sections `npm run balance` assembles.
 *
 * Their union is the integration suite as it was before the split
 * (`tests/integration/**\/*.test.ts`). `npm run test:integration`, `npm test`,
 * `npm run verify` and the release gate run both.
 */

/** Every integration test file: the suite before the split. */
export const INTEGRATION_INCLUDE = ['tests/integration/**/*.test.ts'];

/** The long headless simulations, run in the release gate and by `npm run balance`. */
export const INTEGRATION_RELEASE_INCLUDE = [
  'tests/integration/balance/**/*.test.ts',
  'tests/integration/progression.test.ts',
  'tests/integration/progressionMastery.test.ts',
  'tests/integration/siteLadder.test.ts',
];

/**
 * Whether a repository-relative test file is in the release-only selection:
 * `INTEGRATION_RELEASE_INCLUDE` as a predicate, for tools that read a result
 * which does not name the project of each file.
 *
 * @param {string} file e.g. `tests/integration/siteLadder.test.ts`
 */
export function isIntegrationReleaseFile(file) {
  const normal = file.split('\\').join('/');
  return (normal.startsWith('tests/integration/balance/') && normal.endsWith('.test.ts')) ||
    INTEGRATION_RELEASE_INCLUDE.includes(normal);
}

/** Vitest project names of the two integration selections. */
export const INTEGRATION_FAST_PROJECT = 'integration-fast';
export const INTEGRATION_RELEASE_PROJECT = 'integration-release';

/** The Playwright projects whose results are required release evidence. */
export const REQUIRED_PLAYWRIGHT_PROJECTS = ['browser', 'accessibility', 'browser-firefox', 'accessibility-firefox'];

/** The optional branded Chromium projects, and the flows short enough to repeat in each. */
export const BRANDED_PLAYWRIGHT_PROJECTS = ['browser-chrome', 'browser-edge'];
/**
 * Specs only the branded projects run (Test Suite Optimization Plan phase 9):
 * the short offline flow. The required `browser` projects ignore them and run
 * the whole offline sortie, `tests/browser/offline.spec.ts`, instead.
 */
export const BRANDED_ONLY_SPECS = ['tests/browser/offlineSmoke.spec.ts'];
/** The full sortie the branded projects leave to the required browser projects. */
export const FULL_OFFLINE_SPEC = 'tests/browser/offline.spec.ts';
export const BRANDED_SMOKE_SPECS = [
  'tests/browser/boot.spec.ts',
  'tests/browser/campaign.spec.ts',
  'tests/browser/persistence.spec.ts',
  ...BRANDED_ONLY_SPECS,
];

/**
 * Feature verification (`npm run verify:feature`, Test Suite Optimization Plan
 * phase 2): the Vitest projects it runs in one invocation, and the Chromium
 * smoke project that selects the browser and accessibility cases carrying
 * `FEATURE_TAG`. Tagged cases stay in the four required projects, and the
 * release gate never names the smoke project, so the gate runs each of them
 * exactly once per engine.
 */
export const FEATURE_VITEST_PROJECTS = ['unit', INTEGRATION_FAST_PROJECT, 'component'];
/**
 * How `verify:feature` invokes them. Unit and component share one invocation;
 * the fast integration selection runs on its own, because the component cases
 * keep Vitest's 5 s timeout and time out when they share processors with the
 * CPU-bound property and golden-replay files.
 */
export const FEATURE_VITEST_GROUPS = [['unit', 'component'], [INTEGRATION_FAST_PROJECT]];
export const FEATURE_SMOKE_PROJECT = 'feature-smoke';
export const FEATURE_TAG = '@feature';

/** The port the production preview serves the build on for every Playwright run. */
export const PREVIEW_PORT = 4173;
