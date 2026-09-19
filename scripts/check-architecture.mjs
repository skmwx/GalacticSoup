#!/usr/bin/env node
/**
 * `npm run check:architecture`
 *
 * Fails when the source tree breaks a package boundary, the dependency
 * direction, the headless-engine rule or the prohibition on circular imports
 * (Technical Specification 4.1, 4.3, 2).
 */
import process from 'node:process';

import { checkArchitecture } from './lib/architecture.mjs';

const { violations, fileCount, edgeCount } = checkArchitecture();

if (violations.length === 0) {
  process.stdout.write(
    `Architecture OK: ${String(fileCount)} source files, ${String(edgeCount)} imports, no boundary or cycle violations.\n`,
  );
  process.exit(0);
}

process.stderr.write(`Architecture violations (${String(violations.length)}):\n\n`);
for (const violation of violations) {
  process.stderr.write(
    `  ${violation.file}:${String(violation.line)}  [${violation.rule}]\n    ${violation.message}\n`,
  );
}
process.stderr.write('\nSee config/packages.mjs for the declared boundaries.\n');
process.exit(1);
