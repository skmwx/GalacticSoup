#!/usr/bin/env node
/**
 * `npm run validate:content`
 *
 * Compiles and validates the authored content bundle (Technical Specification
 * 6.2, 6.3). It runs the same compiler the development server, the test run
 * and the production build use, so a problem found here is a problem that
 * would have stopped any of them.
 *
 * The shipped content is also held to the content floor profile its manifest
 * names (v0.2 Implementation Plan phase 0). With `--release`, as the release
 * gate runs it, any profile but the complete v0.2 release floor fails.
 *
 * On success it writes the compiled bundle to `reports/content-bundle.json`
 * for inspection. That file is a diagnostic; the build does not read it.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';
import { compileContent, serialiseBundle } from './lib/content/compile.mjs';
import { formatWarning } from './lib/content/budgets.mjs';
import { formatIssue } from './lib/content/issues.mjs';
import { readContentFiles } from './lib/content/read.mjs';
import { loadSchemas } from './lib/content/schema.mjs';
import { RELEASE_FLOOR_PROFILE } from './lib/content/floor.mjs';

const files = readContentFiles();
const schemas = loadSchemas();

if (files.length === 0) {
  process.stderr.write('Content validation failed: no content files were found.\n');
  process.exit(1);
}

const result = compileContent(files, { floor: true });

if (process.argv.includes('--release')) {
  const manifest = files.find((file) => file.path.endsWith('manifest.json'));
  const declared = manifest === undefined ? undefined : JSON.parse(manifest.text ?? '{}').contentFloor;
  if ((declared ?? RELEASE_FLOOR_PROFILE) !== RELEASE_FLOOR_PROFILE) {
    process.stderr.write(
      `Content validation failed: the content declares the development floor "${String(declared)}". ` +
        `A release needs "${RELEASE_FLOOR_PROFILE}", the complete v0.2 floor.
`,
    );
    process.exit(1);
  }
}

if (!result.ok) {
  process.stderr.write(`Content validation failed (${String(result.issues.length)}):\n\n`);
  for (const issue of result.issues) {
    process.stderr.write(`  ${formatIssue(issue)}\n`);
  }
  process.stderr.write('\n');
  process.exit(1);
}

// A soft budget is a notice, not a failure (Technical Specification 13).
for (const warning of result.warnings) {
  process.stderr.write(`Content warning: ${formatWarning(warning)}\n`);
}

const reportsDir = path.join(REPO_ROOT, 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(
  path.join(reportsDir, 'content-bundle.json'),
  serialiseBundle(result.bundle),
  'utf8',
);

process.stdout.write(
  [
    `Content OK: ${String(result.stats.files)} files, `,
    `${String(result.stats.definitions)} definitions, `,
    `${String(result.stats.messages)} messages, `,
    `${String(schemas.kinds.length)} content kinds.\n`,
    `  contentVersion ${result.bundle.contentVersion}\n`,
    '  bundle written to reports/content-bundle.json\n',
  ].join(''),
);
