/**
 * JSON Schema validation of authored content and of the compiled bundle
 * (Technical Specification 6.2).
 *
 * Every schema under `schemas/content` is registered by its `$id`, so a schema
 * may reference another. A content file names its kind, and the schema whose
 * file name matches that kind validates it; an unknown kind is an error rather
 * than an unchecked file.
 */
import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import { issue } from './issues.mjs';

const SCHEMA_ROOT = path.join(REPO_ROOT, 'schemas', 'content');

/** Schemas that describe a build artefact rather than an authored file. */
const NON_KIND_SCHEMAS = new Set(['common', 'bundle']);

let cache = null;

export function loadSchemas() {
  if (cache !== null) {
    return cache;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats.default(ajv);

  /** @type {Map<string, object>} */
  const byKind = new Map();

  for (const file of fs.readdirSync(SCHEMA_ROOT).sort()) {
    if (!file.endsWith('.schema.json')) {
      continue;
    }
    const document = JSON.parse(fs.readFileSync(path.join(SCHEMA_ROOT, file), 'utf8'));
    ajv.addSchema(document);
    const kind = file.slice(0, -'.schema.json'.length);
    if (!NON_KIND_SCHEMAS.has(kind)) {
      byKind.set(kind, document);
    }
  }

  cache = {
    ajv,
    kinds: [...byKind.keys()].sort(),
    validatorFor(kind) {
      const document = byKind.get(kind);
      return document === undefined ? null : ajv.getSchema(document.$id);
    },
    bundleValidator: ajv.getSchema(
      'https://galactic-soup.local/schemas/content/bundle.schema.json',
    ),
  };
  return cache;
}

/**
 * Validates one parsed content document against the schema for its kind.
 *
 * @param {string} file Repository-relative path, for the diagnostic.
 * @param {unknown} document
 * @returns {import('./issues.mjs').ContentIssue[]}
 */
export function validateDocument(file, document) {
  const schemas = loadSchemas();
  const kind = typeof document === 'object' && document !== null ? document.kind : undefined;

  if (typeof kind !== 'string') {
    return [issue('unknownKind', file, '', 'the document does not name a content kind')];
  }

  const validate = schemas.validatorFor(kind);
  if (validate === null || validate === undefined) {
    return [
      issue(
        'unknownKind',
        file,
        'kind',
        `"${kind}" has no schema. Known kinds: ${schemas.kinds.join(', ')}.`,
      ),
    ];
  }

  if (validate(document)) {
    return [];
  }

  return (validate.errors ?? []).map((error) =>
    issue(
      'schema',
      file,
      error.instancePath === '' ? '' : error.instancePath.replace(/^\//, '').replaceAll('/', '.'),
      describe(error),
    ),
  );
}

/**
 * Validates the compiled bundle against its own contract.
 * @param {unknown} bundle
 */
export function validateBundle(bundle) {
  const { bundleValidator } = loadSchemas();
  if (bundleValidator === undefined) {
    throw new Error('schemas/content/bundle.schema.json is missing.');
  }
  if (bundleValidator(bundle)) {
    return [];
  }
  return (bundleValidator.errors ?? []).map((error) =>
    issue(
      'schema',
      '',
      error.instancePath === '' ? '' : error.instancePath.replace(/^\//, '').replaceAll('/', '.'),
      describe(error),
    ),
  );
}

function describe(error) {
  const detail = error.message ?? 'is invalid';
  const params = error.params ?? {};
  const extras = Object.entries(params)
    .filter(([key]) => key !== 'passingSchemas')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(', ');
  return extras === '' ? detail : `${detail} (${extras})`;
}

function formatValue(value) {
  return Array.isArray(value) ? value.join('|') : String(value);
}
