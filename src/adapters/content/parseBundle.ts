import type {
  AmmunitionDefinition,
  ContentIdentity,
  EncounterDefinition,
  HullDefinition,
  ItemDefinition,
  LootTableDefinition,
  MarketListingDefinition,
  ModuleDefinition,
  NpcProfileDefinition,
  RulesContent,
  StationDefinition,
  SystemDefinition,
} from '@engine/ports';
import { ContentIntegrityError } from '@engine/ports';
import {
  canonicalJson,
  cubicMetresToCubicDecimetres,
  isDefinitionId,
  sha256Hex,
  sortedKeys,
} from '@shared';

import { findStructuralViolation } from './structure.ts';

/**
 * Turns a compiled bundle into engine-facing content (Technical
 * Specification 6.3, 14).
 *
 * The build has already validated every authored field against the schemas in
 * `schemas/content` and against the semantic rules, and recorded a digest of
 * the canonical bytes. This module does what remains at load time:
 *
 *  - bounds the structure before touching it, because a bundle is untrusted
 *    input at its boundary;
 *  - checks that the digest matches the canonical bytes, so a truncated or
 *    edited bundle is rejected instead of half-loaded;
 *  - converts authored units to canonical ones, which is the only place
 *    cubic metres become cubic-decimetre units.
 *
 * It deliberately does not re-implement the schemas. The digest establishes
 * that this is the artefact the build produced; re-validating every field
 * would duplicate the contract without adding a guarantee.
 *
 * @implements TECH-6.3, TECH-14
 */

export interface ParsedContent {
  readonly identity: ContentIdentity;
  readonly rules: RulesContent;
  readonly hulls: readonly HullDefinition[];
  readonly modules: readonly ModuleDefinition[];
  readonly ammunition: readonly AmmunitionDefinition[];
  readonly items: readonly ItemDefinition[];
  readonly systems: readonly SystemDefinition[];
  readonly stations: readonly StationDefinition[];
  readonly npcProfiles: readonly NpcProfileDefinition[];
  readonly lootTables: readonly LootTableDefinition[];
  readonly encounters: readonly EncounterDefinition[];
  readonly listings: readonly MarketListingDefinition[];
  readonly localization: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Definition kinds a bundle must carry, in the order counts are reported. */
export const BUNDLE_DEFINITION_KINDS = [
  'ammunition',
  'encounters',
  'hulls',
  'items',
  'loot.tables',
  'modules',
  'npc.profiles',
  'stations',
  'systems',
] as const;

/** Fields that carry an authored volume and become canonical units on load. */
const VOLUME_FIELD = 'volumeCubicMetres';
const CARGO_FIELD = 'cargoCapacityCubicMetres';

export function parseContentBundle(value: unknown): ParsedContent {
  const violation = findStructuralViolation(value);
  if (violation !== null) {
    throw new ContentIntegrityError(violation.reason, violation.path, violation.detail);
  }

  const bundle = object(value, '');
  const identity: ContentIdentity = {
    contentVersion: text(bundle['contentVersion'], 'contentVersion'),
    contentHash: text(bundle['contentHash'], 'contentHash'),
    defaultLocale: text(bundle['defaultLocale'], 'defaultLocale'),
    locales: array(bundle['locales'], 'locales').map((entry, index) =>
      text(entry, `locales[${String(index)}]`),
    ),
  };

  verifyDigest(bundle, identity.contentHash);

  const definitions = object(bundle['definitions'], 'definitions');
  for (const kind of BUNDLE_DEFINITION_KINDS) {
    if (!Array.isArray(definitions[kind])) {
      throw new ContentIntegrityError(
        'unsupported-value',
        `definitions.${kind}`,
        'missing definition collection',
      );
    }
  }

  return {
    identity,
    rules: object(bundle['rules'], 'rules') as unknown as RulesContent,
    hulls: definitionList(definitions, 'hulls', 'hull', convertHull),
    modules: definitionList(definitions, 'modules', 'module', convertVolume),
    ammunition: definitionList(definitions, 'ammunition', 'ammo', convertVolume),
    items: definitionList(definitions, 'items', 'item', convertVolume),
    systems: definitionList(definitions, 'systems', 'system', identityOf),
    stations: definitionList(definitions, 'stations', 'station', identityOf),
    npcProfiles: definitionList(definitions, 'npc.profiles', 'npc', identityOf),
    lootTables: definitionList(definitions, 'loot.tables', 'loot', identityOf),
    encounters: definitionList(definitions, 'encounters', 'encounter', identityOf),
    listings: array(bundle['listings'], 'listings').map(
      (entry, index) => object(entry, `listings[${String(index)}]`) as unknown as
        MarketListingDefinition,
    ),
    localization: parseLocalization(bundle['localization']),
  };
}

/**
 * Recomputes the digest from the canonical bytes of everything except the
 * identity fields that embed it.
 */
export function bundleDigest(bundle: Readonly<Record<string, unknown>>): string {
  const { contentHash: _hash, contentVersion: _version, ...rest } = bundle;
  return sha256Hex(canonicalJson(rest));
}

function verifyDigest(bundle: Readonly<Record<string, unknown>>, declared: string): void {
  const actual = bundleDigest(bundle);
  if (actual !== declared) {
    throw new ContentIntegrityError(
      'digest-mismatch',
      'contentHash',
      `bundle declares ${declared} but its canonical bytes hash to ${actual}`,
    );
  }
}

function definitionList<T>(
  definitions: Readonly<Record<string, unknown>>,
  kind: string,
  namespace: string,
  convert: (entry: Record<string, unknown>, path: string) => Record<string, unknown>,
): readonly T[] {
  const entries = array(definitions[kind], `definitions.${kind}`);
  return entries.map((entry, index) => {
    const path = `definitions.${kind}[${String(index)}]`;
    const record = object(entry, path);
    const id = text(record['id'], `${path}.id`);
    if (!isDefinitionId(id) || !id.startsWith(`${namespace}.`)) {
      throw new ContentIntegrityError('unsupported-value', `${path}.id`, `"${id}" is not a ${namespace} id`);
    }
    return convert(record, path) as T;
  });
}

function identityOf(entry: Record<string, unknown>): Record<string, unknown> {
  return entry;
}

function convertVolume(entry: Record<string, unknown>, path: string): Record<string, unknown> {
  const { [VOLUME_FIELD]: authored, ...rest } = entry;
  return {
    ...rest,
    volumeCubicDecimetres: toCanonicalVolume(authored, `${path}.${VOLUME_FIELD}`),
  };
}

function convertHull(entry: Record<string, unknown>, path: string): Record<string, unknown> {
  const { [CARGO_FIELD]: authored, ...rest } = entry;
  return {
    ...rest,
    cargoCapacityCubicDecimetres: toCanonicalVolume(authored, `${path}.${CARGO_FIELD}`),
  };
}

function toCanonicalVolume(value: unknown, path: string): number {
  if (typeof value !== 'number') {
    throw new ContentIntegrityError('unsupported-value', path, 'volume is not a number');
  }
  try {
    return cubicMetresToCubicDecimetres(value);
  } catch (error: unknown) {
    throw new ContentIntegrityError(
      'unsupported-value',
      path,
      error instanceof Error ? error.message : 'volume does not convert',
    );
  }
}

function parseLocalization(
  value: unknown,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  const locales = object(value, 'localization');
  const out: Record<string, Record<string, string>> = {};
  for (const locale of sortedKeys(locales)) {
    const messages = object(locales[locale], `localization.${locale}`);
    const table: Record<string, string> = {};
    for (const key of sortedKeys(messages)) {
      table[key] = text(messages[key], `localization.${locale}.${key}`);
    }
    out[locale] = table;
  }
  return out;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentIntegrityError('unsupported-value', path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ContentIntegrityError('unsupported-value', path, 'expected an array');
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContentIntegrityError('unsupported-value', path, 'expected a non-empty string');
  }
  return value;
}
