#!/usr/bin/env node
/**
 * `npm run validate:content`
 *
 * Validates the authored content bundle against the schemas in `schemas/`
 * (Technical Specification 6.2). Phase 1 establishes the entry point and the
 * schema-driven mechanism; the content bundle itself arrives with the phase
 * that authors it, at which point this script already refuses invalid data.
 *
 * Every JSON file under `content/` must parse, and must validate against the
 * schema in `schemas/content/<top-level folder>.schema.json` when one exists.
 * Protocol schemas are always checked for being valid JSON Schema documents.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { REPO_ROOT } from '../config/aliases.mjs';

const CONTENT_ROOT = path.join(REPO_ROOT, 'content');
const CONTENT_SCHEMA_ROOT = path.join(REPO_ROOT, 'schemas', 'content');
const PROTOCOL_SCHEMA_ROOT = path.join(REPO_ROOT, 'schemas', 'protocol');

/** @type {string[]} */
const errors = [];
let validatedFiles = 0;
let validatedSchemas = 0;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats.default(ajv);

for (const file of listJsonFiles(PROTOCOL_SCHEMA_ROOT)) {
  const document = readJson(file);
  if (document === null) {
    continue;
  }
  try {
    ajv.compile(document);
    validatedSchemas += 1;
  } catch (error) {
    errors.push(`${relative(file)}: not a valid JSON Schema - ${describe(error)}`);
  }
}

const contentFiles = listJsonFiles(CONTENT_ROOT);

for (const file of contentFiles) {
  const document = readJson(file);
  if (document === null) {
    continue;
  }

  const schemaFile = schemaFor(file);
  if (schemaFile === null) {
    errors.push(
      `${relative(file)}: no schema found. Expected ${relative(expectedSchemaPath(file))}.`,
    );
    continue;
  }

  const schema = readJson(schemaFile);
  if (schema === null) {
    continue;
  }

  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    errors.push(`${relative(schemaFile)}: not a valid JSON Schema - ${describe(error)}`);
    continue;
  }

  if (!validate(document)) {
    for (const issue of validate.errors ?? []) {
      errors.push(
        `${relative(file)}: ${issue.instancePath === '' ? '/' : issue.instancePath} ${issue.message ?? 'is invalid'}`,
      );
    }
    continue;
  }

  validatedFiles += 1;
}

if (errors.length > 0) {
  process.stderr.write(`Content validation failed (${String(errors.length)}):\n\n`);
  for (const error of errors) {
    process.stderr.write(`  ${error}\n`);
  }
  process.exit(1);
}

if (contentFiles.length === 0) {
  process.stdout.write(
    `Content OK: ${String(validatedSchemas)} protocol schemas compile. No content bundle is installed yet.\n`,
  );
} else {
  process.stdout.write(
    `Content OK: ${String(validatedFiles)} content files validated against their schemas, ${String(validatedSchemas)} protocol schemas compile.\n`,
  );
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listJsonFiles(absolute));
    } else if (entry.name.endsWith('.json')) {
      found.push(absolute);
    }
  }
  return found.sort();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${relative(file)}: invalid JSON - ${describe(error)}`);
    return null;
  }
}

function expectedSchemaPath(file) {
  const relativePath = path.relative(CONTENT_ROOT, file).split(path.sep);
  const group = relativePath[0] ?? 'unknown';
  return path.join(CONTENT_SCHEMA_ROOT, `${group}.schema.json`);
}

function schemaFor(file) {
  const candidate = expectedSchemaPath(file);
  return fs.existsSync(candidate) ? candidate : null;
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
