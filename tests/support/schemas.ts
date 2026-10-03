import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { REPO_ROOT } from '../../config/aliases.mjs';

/**
 * The published JSON Schemas, compiled for tests
 * (Technical Specification 7.1, 11.2, 17).
 *
 * The engine validates with hand-written code and carries no schema library;
 * the schemas are the contract a second implementation reads. Tests therefore
 * check real engine output against them, and this is the one place that knows
 * how they are loaded.
 */

type AjvValidator = ((value: unknown) => boolean) & { errors?: unknown };

const AjvConstructor = (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default as unknown as typeof Ajv2020;

const SCHEMA_BASE = 'https://galacticsoup.invalid/schemas';

export interface SchemaCheck {
  /** `null` when the value satisfies the schema, otherwise what it objected to. */
  (value: unknown): string | null;
}

function check(validate: AjvValidator): SchemaCheck {
  return (value) => (validate(value) ? null : JSON.stringify(validate.errors ?? null));
}

function readSchemas(directory: string): object[] {
  const folder = path.join(REPO_ROOT, 'schemas', directory);
  return readdirSync(folder)
    .filter((file) => file.endsWith('.schema.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(folder, file), 'utf8')) as object);
}

export function readSchema(directory: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'schemas', directory, file), 'utf8')) as Record<string, unknown>;
}

export interface SaveSchemas {
  readonly envelope: SchemaCheck;
  readonly state: SchemaCheck;
}

export function saveSchemas(): SaveSchemas {
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  for (const schema of readSchemas('save')) ajv.addSchema(schema);
  const of = (file: string): SchemaCheck =>
    check(ajv.getSchema(`${SCHEMA_BASE}/save/${file}`) as unknown as AjvValidator);
  return { envelope: of('save-envelope.schema.json'), state: of('campaign-state.schema.json') };
}

export interface ProtocolSchemas {
  /** The check for a request type's response data, or `null` when it has no schema of its own. */
  dataOf(type: string): SchemaCheck | null;
  /** Every request type that has a published data schema. */
  readonly types: readonly string[];
}

/** A preview query answers with one of the shared transaction-preview shapes. */
const SHARED_DATA_SCHEMAS: Readonly<Record<string, string>> = {
  'market.previewBuy': 'transaction-preview.data.schema.json',
  'market.previewSell': 'transaction-preview.data.schema.json',
  'repair.preview': 'transaction-preview.data.schema.json',
  'resupply.preview': 'transaction-preview.data.schema.json',
  'insurance.preview': 'transaction-preview.data.schema.json',
};

export function protocolSchemas(): ProtocolSchemas {
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  for (const schema of readSchemas('protocol')) ajv.addSchema(schema);
  const folder = path.join(REPO_ROOT, 'schemas', 'protocol');
  const types = readdirSync(folder)
    .filter((file) => file.endsWith('.data.schema.json'))
    .map((file) => file.slice(0, -'.data.schema.json'.length))
    .sort();
  return {
    types,
    dataOf(type: string): SchemaCheck | null {
      const file = SHARED_DATA_SCHEMAS[type] ?? `${type}.data.schema.json`;
      if (!existsSync(path.join(folder, file))) return null;
      const validate = ajv.getSchema(`${SCHEMA_BASE}/protocol/${file}`);
      return validate === undefined ? null : check(validate as unknown as AjvValidator);
    },
  };
}
