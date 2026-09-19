/**
 * Content compilation (Technical Specification 6.3).
 *
 * Authored files in, one canonical bundle out:
 *
 *   1. parse, with the size and structure limits that guard untrusted input;
 *   2. validate each file against the schema for its declared kind;
 *   3. collect the kinds into one set and check the cross-file rules;
 *   4. canonicalise - sort by stable id, drop authoring-only metadata;
 *   5. hash the canonical bytes and derive `contentVersion`.
 *
 * The same function serves `npm run validate:content`, the development server,
 * the test run and the production build, so all four accept or reject exactly
 * the same content.
 */
import { canonicalJson, sha256Hex } from '../../../src/shared/index.ts';
import {
  CONTENT_LIMITS,
  findStructuralViolation,
} from '../../../src/adapters/content/limits.ts';

import { issue, sortIssues } from './issues.mjs';
import { validateBundle, validateDocument } from './schema.mjs';
import { validateSemantics } from './semantic.mjs';

/** Collection kinds that become `definitions.<kind>` in the bundle. */
const DEFINITION_KINDS = [
  'ammunition',
  'encounters',
  'hulls',
  'items',
  'loot.tables',
  'modules',
  'npc.profiles',
  'stations',
  'systems',
];

const RULE_KINDS = ['rules.time', 'rules.combat', 'rules.economy'];

/** Keys stripped from the canonical bundle: they exist for authors only. */
const AUTHORING_KEYS = new Set(['$comment', '$schema']);

/**
 * @typedef {object} ContentFile
 * @property {string} path  Repository-relative, forward slashes.
 * @property {string} text
 *
 * @typedef {object} CompileResult
 * @property {boolean} ok
 * @property {object | null} bundle
 * @property {import('./issues.mjs').ContentIssue[]} issues
 * @property {{ files: number, definitions: number, messages: number }} stats
 */

/**
 * @param {ContentFile[]} files
 * @returns {CompileResult}
 */
export function compileContent(files) {
  /** @type {import('./issues.mjs').ContentIssue[]} */
  const issues = [];
  const documents = [];
  let totalBytes = 0;

  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const bytes = Buffer.byteLength(file.text, 'utf8');
    totalBytes += bytes;
    if (bytes > CONTENT_LIMITS.maxFileBytes) {
      issues.push(
        issue('tooLarge', file.path, '', `${String(bytes)} bytes exceeds the per-file limit`),
      );
      continue;
    }

    let document;
    try {
      document = JSON.parse(file.text);
    } catch (error) {
      issues.push(issue('invalidJson', file.path, '', describe(error)));
      continue;
    }

    const violation = findStructuralViolation(document);
    if (violation !== null) {
      issues.push(issue('structure', file.path, violation.path, `${violation.reason}: ${violation.detail}`));
      continue;
    }

    const schemaIssues = validateDocument(file.path, document);
    if (schemaIssues.length > 0) {
      issues.push(...schemaIssues);
      continue;
    }

    documents.push({ file: file.path, document });
  }

  if (totalBytes > CONTENT_LIMITS.maxTotalBytes) {
    issues.push(issue('tooLarge', '', '', `${String(totalBytes)} bytes exceeds the content limit`));
  }

  const { collected, issues: collectIssues } = collect(documents);
  issues.push(...collectIssues);

  if (issues.length > 0) {
    return failure(issues);
  }

  issues.push(...validateSemantics(collected));
  if (issues.length > 0) {
    return failure(issues);
  }

  const bundle = canonicalise(collected);
  const bundleIssues = validateBundle(bundle);
  if (bundleIssues.length > 0) {
    return failure(bundleIssues);
  }

  return {
    ok: true,
    bundle,
    issues: [],
    stats: {
      files: documents.length,
      definitions: DEFINITION_KINDS.reduce(
        (total, kind) => total + bundle.definitions[kind].length,
        0,
      ),
      messages: Object.values(bundle.localization).reduce(
        (total, table) => total + Object.keys(table).length,
        0,
      ),
    },
  };
}

/** Groups validated documents by kind and reports missing or duplicated ones. */
function collect(documents) {
  /** @type {import('./issues.mjs').ContentIssue[]} */
  const issues = [];

  /** @type {Collected} */
  const collected = {
    manifest: null,
    rules: {},
    definitions: Object.fromEntries(DEFINITION_KINDS.map((kind) => [kind, []])),
    listings: [],
    localization: {},
  };

  for (const { file, document } of documents) {
    const kind = document.kind;

    if (kind === 'manifest') {
      if (collected.manifest !== null) {
        issues.push(
          issue('duplicateKind', file, 'kind', `a manifest already exists in ${collected.manifest.file}`),
        );
        continue;
      }
      collected.manifest = { value: document, file };
      continue;
    }

    if (RULE_KINDS.includes(kind)) {
      const group = kind.slice('rules.'.length);
      if (collected.rules[group] !== undefined) {
        issues.push(
          issue(
            'duplicateKind',
            file,
            'kind',
            `the ${group} rules are already defined in ${collected.rules[group].file}`,
          ),
        );
        continue;
      }
      collected.rules[group] = { values: document.values, file };
      continue;
    }

    if (DEFINITION_KINDS.includes(kind)) {
      document.definitions.forEach((value, index) => {
        collected.definitions[kind].push({ value, file, path: `definitions[${index}]` });
      });
      continue;
    }

    if (kind === 'market.listings') {
      collected.listings.push({ stationId: document.stationId, listings: document.listings, file });
      continue;
    }

    if (kind === 'localization') {
      if (collected.localization[document.locale] !== undefined) {
        issues.push(
          issue(
            'duplicateKind',
            file,
            'locale',
            `locale "${document.locale}" is already defined in ${collected.localization[document.locale].file}`,
          ),
        );
        continue;
      }
      collected.localization[document.locale] = { messages: document.messages, file };
      continue;
    }

    issues.push(issue('unknownKind', file, 'kind', `"${kind}" is not a collected content kind`));
  }

  if (collected.manifest === null) {
    issues.push(issue('missingKind', '', '', 'no content manifest was found'));
  }
  for (const kind of RULE_KINDS) {
    const group = kind.slice('rules.'.length);
    if (collected.rules[group] === undefined) {
      issues.push(issue('missingKind', '', '', `no "${kind}" file was found`));
    }
  }
  for (const kind of DEFINITION_KINDS) {
    if (collected.definitions[kind].length === 0) {
      issues.push(issue('missingKind', '', '', `no "${kind}" definitions were found`));
    }
  }
  if (collected.listings.length === 0) {
    issues.push(issue('missingKind', '', '', 'no "market.listings" file was found'));
  }
  if (Object.keys(collected.localization).length === 0) {
    issues.push(issue('missingKind', '', '', 'no "localization" file was found'));
  }

  return { collected, issues };
}

/**
 * Produces the canonical bundle: definitions sorted by stable id, authoring
 * metadata stripped, then the digest and version derived from the canonical
 * bytes of everything else.
 */
function canonicalise(collected) {
  const definitions = {};
  for (const kind of DEFINITION_KINDS) {
    definitions[kind] = collected.definitions[kind]
      .map((entry) => strip(entry.value))
      .sort((a, b) => compare(a.id, b.id));
  }

  const listings = [];
  for (const table of collected.listings) {
    for (const listing of table.listings) {
      listings.push({ stationId: table.stationId, ...strip(listing) });
    }
  }
  listings.sort((a, b) => compare(a.stationId, b.stationId) || compare(a.itemId, b.itemId));

  const localization = {};
  for (const locale of Object.keys(collected.localization).sort(compare)) {
    const messages = collected.localization[locale].messages;
    localization[locale] = Object.fromEntries(
      Object.keys(messages)
        .sort(compare)
        .map((key) => [key, messages[key]]),
    );
  }

  const rest = {
    defaultLocale: collected.manifest.value.defaultLocale,
    locales: [...collected.manifest.value.locales].sort(compare),
    rules: {
      time: strip(collected.rules.time.values),
      combat: strip(collected.rules.combat.values),
      economy: strip(collected.rules.economy.values),
    },
    definitions,
    listings,
    localization,
  };

  const contentHash = sha256Hex(canonicalJson(rest));
  return {
    contentHash,
    contentVersion: `${collected.manifest.value.version}+${contentHash.slice(0, 12)}`,
    ...rest,
  };
}

/** Removes authoring-only keys anywhere in a definition. */
function strip(value) {
  if (Array.isArray(value)) {
    return value.map(strip);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (AUTHORING_KEYS.has(key)) {
      continue;
    }
    out[key] = strip(value[key]);
  }
  return out;
}

/** Serialises a compiled bundle in the canonical profile. */
export function serialiseBundle(bundle) {
  return `${canonicalJson(bundle)}\n`;
}

function failure(issues) {
  return {
    ok: false,
    bundle: null,
    issues: sortIssues(issues),
    stats: { files: 0, definitions: 0, messages: 0 },
  };
}

function compare(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @typedef {object} Collected
 * @property {{ value: object, file: string } | null} manifest
 * @property {Record<string, { values: object, file: string }>} rules
 * @property {Record<string, { value: object, file: string, path: string }[]>} definitions
 * @property {{ stationId: string, listings: object[], file: string }[]} listings
 * @property {Record<string, { messages: Record<string, string>, file: string }>} localization
 */
