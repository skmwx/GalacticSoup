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
export const BRANDED_SMOKE_SPECS = [
  'tests/browser/boot.spec.ts',
  'tests/browser/campaign.spec.ts',
  'tests/browser/persistence.spec.ts',
  'tests/browser/offline.spec.ts',
];
