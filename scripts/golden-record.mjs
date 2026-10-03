#!/usr/bin/env node
/**
 * `npm run golden:record`
 *
 * Records the golden campaign of MVP Implementation Plan phase 20: one whole
 * campaign flown through the protocol, written as
 *
 *   - `tests/fixtures/replays/golden-campaign.json`, the replay log with the
 *     canonical state hash at every checkpoint, and
 *   - `tests/fixtures/saves/golden/<state>.json`, one sealed save per
 *     representative state.
 *
 * The recording is deterministic for a given content set and engine. It goes
 * stale when content, the protocol or the save format changes, and
 * `tests/integration/goldenCampaign.test.ts` then fails until this is run
 * again. Recording is a deliberate act: review the diff it produces.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';

const vitest = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(
  process.execPath,
  [vitest, 'run', '--project', 'integration', 'tests/integration/goldenCampaign.test.ts'],
  { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, GOLDEN_RECORD: '1' } },
);

if (result.status !== 0) {
  process.stderr.write('Golden record: the campaign could not be recorded.\n');
  process.exit(result.status ?? 1);
}
process.stdout.write('Golden record: fixtures written. Review the diff before committing it.\n');
