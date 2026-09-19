/**
 * Package boundary, dependency direction, platform and cycle checks.
 *
 * Enforces Technical Specification 4.1 (dependency direction), 4.3 (public
 * package APIs and prohibited circular imports) and 2 (headless engine).
 *
 * The checker reads the declarations in `config/packages.mjs`. It is used by
 * `npm run check:architecture` and by tests/unit/architecture.test.ts, so a
 * boundary break fails the unit suite as well as the dedicated check.
 */
import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../../config/aliases.mjs';
import {
  FORBIDDEN_PURE_GLOBALS,
  PACKAGES,
  PACKAGE_NAMES_BY_SPECIFICITY,
  WORKER_ENTRY,
} from '../../config/packages.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const ASSET_EXTENSIONS = new Set(['.css', '.json', '.svg']);
const RESOLUTION_CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/**
 * @typedef {object} Violation
 * @property {string} rule
 * @property {string} file   Repository-relative path.
 * @property {number} line   1-indexed.
 * @property {string} message
 */

/**
 * @param {{ root?: string }} [options]
 * @returns {{ violations: Violation[], fileCount: number, edgeCount: number }}
 */
export function checkArchitecture(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const srcRoot = path.join(root, 'src');
  /** @type {Violation[]} */
  const violations = [];

  const files = listSourceFiles(srcRoot);
  /** @type {Map<string, string[]>} */
  const graph = new Map();
  let edgeCount = 0;

  for (const absolute of files) {
    const relative = toRelative(root, absolute);
    const owner = packageOf(root, absolute);

    if (owner === null) {
      violations.push({
        rule: 'package-membership',
        file: relative,
        line: 1,
        message: `${relative} is not inside a package declared in config/packages.mjs.`,
      });
      continue;
    }

    const source = fs.readFileSync(absolute, 'utf8');
    const { codeWithStrings, codeOnly } = scanSource(source);
    const rule = PACKAGES[owner];

    graph.set(relative, []);

    for (const reference of extractImports(codeWithStrings)) {
      edgeCount += 1;
      const edge = classifyImport({
        root,
        fromFile: absolute,
        fromPackage: owner,
        specifier: reference.specifier,
      });

      if (edge.violation !== null) {
        violations.push({
          rule: edge.violation.rule,
          file: relative,
          line: lineOf(source, reference.index),
          message: edge.violation.message,
        });
        continue;
      }

      if (edge.targetFile !== null) {
        graph.get(relative)?.push(toRelative(root, edge.targetFile));
      }
    }

    for (const reference of extractWorkerReferences(codeWithStrings)) {
      const resolved = resolveRelative(path.dirname(absolute), reference.specifier);
      if (resolved === null) {
        continue;
      }
      const target = toRelative(root, resolved).split(path.sep).join('/');
      const allowed =
        WORKER_ENTRY.spawnedBy.includes(owner) && target === WORKER_ENTRY.module;
      if (!allowed) {
        violations.push({
          rule: 'worker-entry',
          file: relative,
          line: lineOf(source, reference.index),
          message: `${owner} may not load "${target}" as a worker module. Only ${WORKER_ENTRY.spawnedBy.join(', ')} may start ${WORKER_ENTRY.module}.`,
        });
      }
    }

    if (rule.platform === 'pure') {
      for (const forbidden of FORBIDDEN_PURE_GLOBALS) {
        for (const hit of findGlobalUses(codeOnly, forbidden)) {
          violations.push({
            rule: 'headless-engine',
            file: relative,
            line: lineOf(source, hit),
            message: `${owner} must stay headless and deterministic: "${forbidden}" is not available to it (Technical Specification 2, 9.1, 9.4).`,
          });
        }
      }
    }
  }

  for (const cycle of findCycles(graph)) {
    violations.push({
      rule: 'no-cycles',
      file: cycle[0] ?? '',
      line: 1,
      message: `Circular import: ${cycle.join(' -> ')}.`,
    });
  }

  violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );

  return { violations, fileCount: files.length, edgeCount };
}

/** @returns {string[]} absolute paths */
function listSourceFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(absolute));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(absolute);
    }
  }
  return found.sort();
}

function toRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function packageOf(root, absolute) {
  const relative = toRelative(root, absolute);
  for (const name of PACKAGE_NAMES_BY_SPECIFICITY) {
    const dir = `${PACKAGES[name].dir}/`;
    if (relative.startsWith(dir)) {
      return name;
    }
  }
  return null;
}

function classifyImport({ root, fromFile, fromPackage, specifier }) {
  const rule = PACKAGES[fromPackage];

  if (specifier.startsWith('.')) {
    const resolved = resolveRelative(path.dirname(fromFile), specifier);
    if (resolved === null) {
      return violation('unresolved-import', `Cannot resolve relative import "${specifier}".`);
    }

    const extension = path.extname(resolved);
    const targetPackage = packageOf(root, resolved);

    if (targetPackage === null) {
      return violation(
        'package-boundary',
        `"${specifier}" reaches outside every declared package.`,
      );
    }
    if (targetPackage !== fromPackage) {
      return violation(
        'package-boundary',
        `${fromPackage} must reach ${targetPackage} through its public alias, not the relative path "${specifier}".`,
      );
    }
    if (ASSET_EXTENSIONS.has(extension)) {
      return { targetFile: null, violation: null };
    }
    return { targetFile: resolved, violation: null };
  }

  if (specifier.startsWith('node:')) {
    return violation(
      'external-dependency',
      `${fromPackage} may not use the Node built-in "${specifier}"; shipped code runs in the browser.`,
    );
  }

  const targetPackage = PACKAGE_NAMES_BY_SPECIFICITY.find((name) => name === specifier);
  if (targetPackage !== undefined) {
    if (PACKAGES[targetPackage].testOnly && !PACKAGES[fromPackage].testOnly) {
      return violation(
        'test-only-package',
        `${targetPackage} is test support and must not be imported by ${fromPackage}.`,
      );
    }
    if (!rule.mayImport.includes(targetPackage)) {
      return violation(
        'dependency-direction',
        `${fromPackage} may not import ${targetPackage} (allowed: ${rule.mayImport.join(', ') || 'none'}).`,
      );
    }
    return { targetFile: resolveAlias(root, targetPackage), violation: null };
  }

  if (specifier.startsWith('@')) {
    const owner = PACKAGE_NAMES_BY_SPECIFICITY.find((name) => specifier.startsWith(`${name}/`));
    if (owner !== undefined) {
      return violation(
        'public-api',
        `"${specifier}" reaches inside ${owner}. Import the package itself so its public index stays the contract.`,
      );
    }
  }

  if (!rule.externals.includes(specifier)) {
    return violation(
      'external-dependency',
      `${fromPackage} may not import "${specifier}" (allowed: ${rule.externals.join(', ') || 'none'}).`,
    );
  }

  return { targetFile: null, violation: null };
}

function violation(rule, message) {
  return { targetFile: null, violation: { rule, message } };
}

function resolveAlias(root, packageName) {
  const candidate = path.join(root, PACKAGES[packageName].dir, 'index.ts');
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveRelative(fromDir, specifier) {
  const base = path.resolve(fromDir, specifier);
  for (const suffix of RESOLUTION_CANDIDATES) {
    const candidate = suffix.startsWith('/') ? path.join(base, suffix.slice(1)) : base + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Replaces comments and string contents with spaces while preserving every
 * offset, so import specifiers stay readable in one output and identifier
 * scanning is free of false positives in the other.
 */
export function scanSource(source) {
  const withStrings = source.split('');
  const codeOnly = source.split('');
  let index = 0;

  const blank = (start, end, target) => {
    for (let i = start; i < end; i += 1) {
      if (target[i] !== '\n') {
        target[i] = ' ';
      }
    }
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop, withStrings);
      blank(index, stop, codeOnly);
      index = stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop, withStrings);
      blank(index, stop, codeOnly);
      index = stop;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const stop = endOfString(source, index, char);
      blank(index + 1, stop - 1, codeOnly);
      index = stop;
      continue;
    }

    index += 1;
  }

  return { codeWithStrings: withStrings.join(''), codeOnly: codeOnly.join('') };
}

function endOfString(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    if (quote !== '`' && char === '\n') {
      return index;
    }
    index += 1;
  }
  return source.length;
}

const IMPORT_PATTERN =
  /(?:^|[\s;}])(?:import|export)\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]|(?:^|[^.\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractImports(code) {
  /** @type {{ specifier: string, index: number }[]} */
  const references = [];
  IMPORT_PATTERN.lastIndex = 0;
  let match;
  while ((match = IMPORT_PATTERN.exec(code)) !== null) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) {
      const leading = match[0].length - match[0].trimStart().length;
      references.push({ specifier, index: match.index + leading });
    }
  }
  return references;
}

const WORKER_URL_PATTERN = /new\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

export function extractWorkerReferences(code) {
  /** @type {{ specifier: string, index: number }[]} */
  const references = [];
  WORKER_URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = WORKER_URL_PATTERN.exec(code)) !== null) {
    const specifier = match[1];
    if (specifier !== undefined && specifier.startsWith('.')) {
      references.push({ specifier, index: match.index });
    }
  }
  return references;
}

function findGlobalUses(code, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = name.includes('.')
    ? new RegExp(`(?<![.\\w$])${escaped}\\b`, 'g')
    : new RegExp(`(?<![.\\w$])${escaped}\\b(?!\\s*:)`, 'g');
  /** @type {number[]} */
  const hits = [];
  let match;
  while ((match = pattern.exec(code)) !== null) {
    hits.push(match.index);
  }
  return hits;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

function findCycles(graph) {
  /** @type {string[][]} */
  const cycles = [];
  const state = new Map();
  const stack = [];
  const seenSignatures = new Set();

  const visit = (node) => {
    state.set(node, 'open');
    stack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) {
        continue;
      }
      const status = state.get(next);
      if (status === 'open') {
        const start = stack.indexOf(next);
        const cycle = [...stack.slice(start), next];
        const signature = [...cycle].sort().join('|');
        if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          cycles.push(cycle);
        }
      } else if (status === undefined) {
        visit(next);
      }
    }

    stack.pop();
    state.set(node, 'closed');
  };

  for (const node of [...graph.keys()].sort()) {
    if (state.get(node) === undefined) {
      visit(node);
    }
  }

  return cycles;
}
