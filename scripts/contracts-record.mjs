#!/usr/bin/env node
/**
 * `npm run contracts:record`
 *
 * Records the contract lock of MVP Implementation Plan phase 20:
 * `tests/fixtures/contracts/lock.json` holds the protocol, save-format and
 * campaign-state versions, the request catalogue and a digest of every
 * published protocol and save schema.
 *
 * `tests/unit/protocol/contractClosure.test.ts` fails when the build no longer
 * matches the lock. Record it again only after bumping the version the change
 * belongs to (MVP plan section 2, rule 6), and review the diff: it is the list
 * of contracts that changed.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';

const vitest = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(
  process.execPath,
  [vitest, 'run', '--project', 'unit', 'tests/unit/protocol/contractClosure.test.ts'],
  { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, CONTRACTS_RECORD: '1' } },
);

if (result.status !== 0) {
  process.stderr.write('Contracts record: the contracts are not closed; fix the audit findings first.\n');
  process.exit(result.status ?? 1);
}
process.stdout.write('Contracts record: lock written. Review the diff before committing it.\n');
