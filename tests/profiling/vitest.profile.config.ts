import { defineConfig } from 'vitest/config';

import { aliasEntries } from '../../config/aliases.mjs';
import { contentPlugin } from '../../config/contentPlugin.mjs';

/**
 * Headless release-work profiler (Test Suite Optimization Plan phase 13).
 *
 * Not a test project: no selection, gate step or `npm test` run picks it up,
 * and it asserts nothing. It flies one matrix cell or one career with the
 * real drivers and writes where the time went. See
 * `docs/test-suite-optimization/phase-13-14-profile-and-acceptance.md`.
 *
 *   npx vitest run --config tests/profiling/vitest.profile.config.ts
 *
 * `PROFILE_TARGET` picks the workload (`cell:<fitId>@<encounterId>` or
 * `career:<careerId>`; `<target>#<n>` flies only the first n seeds), and
 * `PROFILE_OUT` names the JSON written. `PROFILE_CPU=<dir>` also writes a V8
 * CPU profile of the workload to `<dir>/workload.cpuprofile`, for
 * `node tests/profiling/cpuProfileSummary.mjs <file>`.
 */
const alias = aliasEntries();

export default defineConfig({
  resolve: { alias },
  plugins: [contentPlugin()],
  test: {
    name: 'headless-profile',
    environment: 'node',
    include: ['tests/profiling/headless.profile.ts'],
    root: new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 3_600_000,
  },
});
