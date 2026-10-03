#!/usr/bin/env node
/**
 * `npm run traceability`
 *
 * Builds the coverage report required by Technical Specification 15.2 and MVP
 * Scope 9.2: for every MVP acceptance criterion and every normative section
 * MVP Scope selects, the engine modules, projections, interface code, content,
 * protocol requests and tests that carry it.
 *
 * Sources of truth:
 *   - `config/requirements.json` lists the requirements and says which are
 *     included in this delivery;
 *   - production code claims a requirement with an `@implements <ID>` comment;
 *   - a test covers a requirement by carrying `[<ID>]` in its name.
 *
 * Recognised id shapes: `TECH-<section>` (Technical Specification),
 * `FUNC-<section>` (Functional Specification) and `MVP-AC-<nn>`
 * (MVP Scope acceptance criteria).
 *
 * The run fails when an included requirement is uncovered, when code or a test
 * names an id the registry does not list, or when the registry names content
 * or a request that does not exist. The report proves coverage; it does not
 * replace human playtesting.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../config/aliases.mjs';
import { buildTraceability, renderMarkdown } from './lib/traceability.mjs';

const report = buildTraceability();

const reportsDir = path.join(REPO_ROOT, 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(
  path.join(reportsDir, 'traceability.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
fs.writeFileSync(path.join(reportsDir, 'traceability.md'), renderMarkdown(report), 'utf8');

const { summary } = report;
process.stdout.write(
  `Traceability: ${String(summary.requirements)} requirements, ${String(summary.included)} included, ` +
    `${String(summary.covered)} covered, ${String(summary.deferred)} deferred. ` +
    'Report written to reports/traceability.md.\n',
);

if (report.problems.length > 0) {
  process.stderr.write(`\nThe traceability report has ${String(report.problems.length)} problem(s):\n`);
  for (const problem of report.problems) {
    process.stderr.write(`  ${problem}\n`);
  }
  process.exit(1);
}
