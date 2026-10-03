/**
 * The traceability join (Technical Specification 15.2; MVP Implementation Plan
 * phase 20).
 *
 * Three sources say what covers a requirement, and none of them is this file:
 *
 *   - `config/requirements.json` is the registry: every MVP acceptance
 *     criterion and every normative section, whether MVP Scope selects it, and
 *     the authored content and protocol requests that carry it;
 *   - production code claims a requirement with an `@implements <ID>` comment;
 *   - a test covers one by carrying `[<ID>]` in its name.
 *
 * This module joins them into one report and decides whether an included
 * requirement is uncovered. It reads files and returns data; the script around
 * it writes the report and sets the exit code, and a unit test holds the join
 * to its rules.
 *
 * @implements TECH-15.2
 */
import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../../config/aliases.mjs';
import { REQUEST_TYPES } from '../../src/protocol/requests.ts';

export const REGISTRY_FILE = path.join(REPO_ROOT, 'config', 'requirements.json');

const ID_PATTERN = /\b(TECH-\d+(?:\.\d+)*|FUNC-\d+(?:\.\d+)*|MVP-AC-\d{2})\b/g;
const IMPLEMENTS_PATTERN = /@implements\s+([^\n*]+)/g;
const TAG_PATTERN = /\[((?:TECH|FUNC|MVP)-[^\]]+)\]/g;

/** Where production claims are looked for, and the file types that can carry one. */
const CLAIM_ROOTS = ['src', 'scripts', 'config'];
const CLAIM_FILES = ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'];
const CLAIM_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs']);
const TEST_EXTENSIONS = new Set(['.ts', '.tsx']);

/** The layer an implementing file belongs to, by its path (Technical Specification 4.3). */
const LAYERS = [
  ['projections', /^src\/engine\/projections\//],
  ['engine', /^src\/engine\//],
  ['interface', /^src\/(ui|app)\//],
  ['protocol', /^src\/(protocol|gateway)\//],
  ['adapters', /^src\/adapters\//],
  ['shared', /^src\/shared\//],
  ['tooling', /^(scripts|config)\/|\.config\.ts$/],
];

export const TEST_LEVELS = ['unit', 'integration', 'performance', 'component', 'browser', 'accessibility'];

/**
 * @typedef {object} Requirement
 * @property {string} id
 * @property {string} title
 * @property {'included' | 'deferred'} scope
 * @property {string} [extent]
 * @property {string} [reason]
 * @property {'tests'} [evidence]
 * @property {string[]} [content]
 * @property {string[]} [requests]
 */

/** @returns {{ requirements: Requirement[] }} */
export function readRegistry(file = REGISTRY_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(absolute, extensions));
    else if (extensions.has(path.extname(entry.name))) found.push(absolute);
  }
  return found.sort();
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function idsIn(text) {
  return [...text.matchAll(ID_PATTERN)].map((match) => match[1] ?? '').filter(Boolean);
}

/** Every `@implements` claim in production code and tooling, by requirement id. */
export function scanClaims(root = REPO_ROOT) {
  /** @type {Map<string, Set<string>>} */
  const claims = new Map();
  const files = [
    ...CLAIM_ROOTS.flatMap((directory) => listFiles(path.join(root, directory), CLAIM_EXTENSIONS)),
    ...CLAIM_FILES.map((file) => path.join(root, file)).filter((file) => fs.existsSync(file)),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPLEMENTS_PATTERN)) {
      for (const id of idsIn(match[1] ?? '')) {
        if (!claims.has(id)) claims.set(id, new Set());
        claims.get(id).add(relative(file));
      }
    }
  }
  return claims;
}

/** Every `[ID]` tag in a test name, by requirement id. */
export function scanTests(root = REPO_ROOT) {
  /** @type {Map<string, Set<string>>} */
  const tags = new Map();
  for (const file of listFiles(path.join(root, 'tests'), TEST_EXTENSIONS)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(TAG_PATTERN)) {
      for (const id of idsIn(match[1] ?? '')) {
        if (!tags.has(id)) tags.set(id, new Set());
        tags.get(id).add(relative(file));
      }
    }
  }
  return tags;
}

function layerOf(file) {
  return LAYERS.find(([, pattern]) => pattern.test(file))?.[0] ?? 'tooling';
}

function levelOf(file) {
  return TEST_LEVELS.find((level) => file.startsWith(`tests/${level}/`)) ?? null;
}

function compareIds(a, b) {
  return a.localeCompare(b, 'en', { numeric: true });
}

/**
 * Joins the registry with the claims and the tags.
 *
 * @param {object} [sources]
 * @param {{ requirements: Requirement[] }} [sources.registry]
 * @param {Map<string, Set<string>>} [sources.claims]
 * @param {Map<string, Set<string>>} [sources.tests]
 * @param {string} [sources.root]
 */
export function buildTraceability(sources = {}) {
  const root = sources.root ?? REPO_ROOT;
  const registry = sources.registry ?? readRegistry();
  const claims = sources.claims ?? scanClaims(root);
  const tests = sources.tests ?? scanTests(root);
  const requestTypes = new Set(REQUEST_TYPES);

  /** @type {string[]} */
  const problems = [];
  const known = new Set();
  for (const requirement of registry.requirements) {
    if (known.has(requirement.id)) problems.push(`${requirement.id}: listed twice in the registry`);
    known.add(requirement.id);
  }
  for (const id of [...new Set([...claims.keys(), ...tests.keys()])].sort(compareIds)) {
    if (!known.has(id)) problems.push(`${id}: used in code or tests but not in the registry`);
  }

  const requirements = registry.requirements.map((requirement) => {
    const implementedBy = [...(claims.get(requirement.id) ?? [])].sort();
    const coveredBy = [...(tests.get(requirement.id) ?? [])].sort();
    const implementation = Object.fromEntries(LAYERS.map(([layer]) => [layer, []]));
    for (const file of implementedBy) implementation[layerOf(file)].push(file);
    const byLevel = Object.fromEntries(TEST_LEVELS.map((level) => [level, []]));
    for (const file of coveredBy) {
      const level = levelOf(file);
      if (level !== null) byLevel[level].push(file);
    }
    const content = requirement.content ?? [];
    const requests = requirement.requests ?? [];

    /** @type {string[]} */
    const gaps = [];
    for (const entry of content) {
      if (!fs.existsSync(path.join(root, entry))) gaps.push(`content "${entry}" does not exist`);
    }
    for (const type of requests) {
      if (!requestTypes.has(type)) gaps.push(`"${type}" is not a protocol request`);
    }

    if (requirement.scope === 'included') {
      const tested = TEST_LEVELS.some((level) => byLevel[level].length > 0);
      if (!tested) gaps.push('no test names it');
      if (requirement.evidence !== 'tests' && implementedBy.length === 0 && content.length === 0) {
        gaps.push('no production code claims it and no content carries it');
      }
      // An acceptance criterion is about the played loop, so a unit test alone
      // does not demonstrate it (MVP Scope 9.2).
      if (
        requirement.id.startsWith('MVP-AC-') &&
        byLevel.integration.length === 0 &&
        byLevel.browser.length === 0
      ) {
        gaps.push('no integration or browser test names it');
      }
    } else if (implementedBy.length > 0) {
      gaps.push(`deferred, yet claimed by ${implementedBy.join(', ')}`);
    }

    const status =
      requirement.scope === 'deferred' ? 'deferred' : gaps.length === 0 ? 'covered' : 'uncovered';
    return {
      id: requirement.id,
      title: requirement.title,
      scope: requirement.scope,
      ...(requirement.extent === undefined ? {} : { extent: requirement.extent }),
      ...(requirement.reason === undefined ? {} : { reason: requirement.reason }),
      evidence: requirement.evidence ?? 'implementation',
      status,
      implementation,
      content,
      requests,
      tests: byLevel,
      gaps,
    };
  });

  for (const requirement of requirements) {
    for (const gap of requirement.gaps) problems.push(`${requirement.id}: ${gap}`);
  }

  const included = requirements.filter((requirement) => requirement.scope === 'included');
  return {
    generatedFor: 'Galactic Soup',
    summary: {
      requirements: requirements.length,
      included: included.length,
      covered: included.filter((requirement) => requirement.status === 'covered').length,
      uncovered: included.filter((requirement) => requirement.status === 'uncovered').length,
      deferred: requirements.length - included.length,
    },
    problems,
    requirements,
  };
}

function cell(files) {
  return files.length === 0 ? '-' : files.map((file) => `\`${file}\``).join('<br>');
}

/** The report as Markdown: a summary, the included requirements, then the deferred ones. */
export function renderMarkdown(report) {
  const lines = [
    '# Traceability report',
    '',
    'Generated by `npm run traceability` from `config/requirements.json`, the `@implements` claims in',
    'production code and the `[ID]` tags in test names. Do not edit by hand.',
    '',
    `Requirements: ${String(report.summary.requirements)} - ${String(report.summary.included)} included, ` +
      `${String(report.summary.covered)} covered, ${String(report.summary.uncovered)} uncovered, ` +
      `${String(report.summary.deferred)} deferred.`,
    '',
  ];

  if (report.problems.length > 0) {
    lines.push('## Problems', '');
    for (const problem of report.problems) lines.push(`- ${problem}`);
    lines.push('');
  }

  lines.push(
    '## Included requirements',
    '',
    '| Requirement | Engine | Projections | Interface | Other code | Content | Requests | Tests |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const requirement of report.requirements.filter((entry) => entry.scope === 'included')) {
    const other = [
      ...requirement.implementation.protocol,
      ...requirement.implementation.adapters,
      ...requirement.implementation.shared,
      ...requirement.implementation.tooling,
    ];
    const tests = TEST_LEVELS
      .filter((level) => requirement.tests[level].length > 0)
      .map((level) => `${level}: ${String(requirement.tests[level].length)}`)
      .join(', ');
    const name = `**${requirement.id}** ${requirement.title}` +
      (requirement.extent === undefined ? '' : `<br>_${requirement.extent}_`) +
      (requirement.status === 'uncovered' ? '<br>**UNCOVERED**' : '');
    lines.push(
      `| ${name} | ${cell(requirement.implementation.engine)} | ${cell(requirement.implementation.projections)} | ` +
        `${cell(requirement.implementation.interface)} | ${cell(other)} | ${cell(requirement.content)} | ` +
        `${requirement.requests.length === 0 ? '-' : requirement.requests.map((type) => `\`${type}\``).join(' ')} | ` +
        `${tests === '' ? '-' : tests} |`,
    );
  }

  lines.push('', '## Tests by requirement', '', '| Requirement | Level | Tests |', '|---|---|---|');
  for (const requirement of report.requirements.filter((entry) => entry.scope === 'included')) {
    for (const level of TEST_LEVELS) {
      if (requirement.tests[level].length === 0) continue;
      lines.push(`| ${requirement.id} | ${level} | ${cell(requirement.tests[level])} |`);
    }
  }

  lines.push('', '## Deferred requirements', '', '| Requirement | Why it is outside this delivery |', '|---|---|');
  for (const requirement of report.requirements.filter((entry) => entry.scope === 'deferred')) {
    lines.push(`| **${requirement.id}** ${requirement.title} | ${requirement.reason ?? ''} |`);
  }
  lines.push('');
  return lines.join('\n');
}
