#!/usr/bin/env node
/**
 * `npm run validate:content`
 *
 * Compiles and validates the authored content bundle (Technical Specification
 * 6.2, 6.3). It runs the same compiler the development server, the test run
 * and the production build use, so a problem found here is a problem that
 * would have stopped any of them.
 *
 * On success it writes the compiled bundle to `reports/content-bundle.json`
 * for inspection. That file is a diagnostic; the build does not read it.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';
import { compileContent, serialiseBundle } from './lib/content/compile.mjs';
import { formatIssue } from './lib/content/issues.mjs';
import { readContentFiles } from './lib/content/read.mjs';
import { loadSchemas } from './lib/content/schema.mjs';

const files = readContentFiles();
const schemas = loadSchemas();

if (files.length === 0) {
  process.stderr.write('Content validation failed: no content files were found.\n');
  process.exit(1);
}

const result = compileContent(files);

if (!result.ok) {
  process.stderr.write(`Content validation failed (${String(result.issues.length)}):\n\n`);
  for (const issue of result.issues) {
    process.stderr.write(`  ${formatIssue(issue)}\n`);
  }
  process.stderr.write('\n');
  process.exit(1);
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
