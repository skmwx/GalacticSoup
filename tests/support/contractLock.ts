import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CAMPAIGN_STATE_VERSION, SAVE_FORMAT_VERSION } from '@engine';
import { PROTOCOL_VERSION, REQUEST_TYPES } from '@protocol';
import { canonicalJson, sha256Hex } from '@shared';

import { REPO_ROOT } from '../../config/aliases.mjs';

import { REPLAY_LOG_VERSION } from './golden/recording.ts';

/**
 * The contract lock (MVP Implementation Plan phase 20; Technical
 * Specification 7.1, 11.2, 18).
 *
 * Phase 20 closes the MVP protocol and save versions. "Closed" is made
 * checkable here: the lock records the versions and a digest of every
 * published protocol and save schema, and a test compares the build with it.
 * A schema that changes without the lock changing fails that test, so a
 * contract change is always a deliberate act - bump the version the change
 * belongs to, then record the lock again with `npm run contracts:record`.
 *
 * A digest covers what a schema requires, not how it is described: titles,
 * descriptions and comments are left out, so rewording one is not a contract
 * change.
 */

export const CONTRACT_LOCK_FILE = path.join(REPO_ROOT, 'tests', 'fixtures', 'contracts', 'lock.json');

export interface ContractLock {
  readonly $comment: string;
  readonly protocolVersion: number;
  readonly saveFormatVersion: number;
  readonly campaignStateVersion: number;
  readonly replayLogVersion: number;
  readonly requestTypes: readonly string[];
  /** Digest of each schema's requirements, keyed by its path under `schemas/`. */
  readonly schemas: Readonly<Record<string, string>>;
}

const ANNOTATIONS = new Set(['title', 'description', '$comment']);

/** A schema with its annotations removed. A property that happens to be named like one is kept. */
function requirementsOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(requirementsOf);
  if (typeof value !== 'object' || value === null) return value;
  const kept: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (ANNOTATIONS.has(key) && typeof entry === 'string') continue;
    kept[key] = requirementsOf(entry);
  }
  return kept;
}

function schemaDigests(): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const family of ['protocol', 'save']) {
    const folder = path.join(REPO_ROOT, 'schemas', family);
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.schema.json')).sort()) {
      const schema = JSON.parse(readFileSync(path.join(folder, file), 'utf8')) as unknown;
      digests[`${family}/${file}`] = sha256Hex(canonicalJson(requirementsOf(schema) as Record<string, unknown>));
    }
  }
  return digests;
}

export function currentContractLock(): ContractLock {
  return {
    $comment:
      'The closed MVP contracts (MVP Implementation Plan phase 20). Written by npm run contracts:record; do not edit by hand. A schema digest covers requirements only, not titles or descriptions.',
    protocolVersion: PROTOCOL_VERSION,
    saveFormatVersion: SAVE_FORMAT_VERSION,
    campaignStateVersion: CAMPAIGN_STATE_VERSION,
    replayLogVersion: REPLAY_LOG_VERSION,
    requestTypes: [...REQUEST_TYPES].sort(),
    schemas: schemaDigests(),
  };
}

export function readContractLock(): ContractLock | null {
  if (!existsSync(CONTRACT_LOCK_FILE)) return null;
  return JSON.parse(readFileSync(CONTRACT_LOCK_FILE, 'utf8')) as ContractLock;
}

export function writeContractLock(lock: ContractLock): void {
  mkdirSync(path.dirname(CONTRACT_LOCK_FILE), { recursive: true });
  writeFileSync(CONTRACT_LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

/** What differs between the recorded lock and the build, one line per difference. */
export function contractDifferences(recorded: ContractLock, current: ContractLock): string[] {
  const differences: string[] = [];
  for (const field of ['protocolVersion', 'saveFormatVersion', 'campaignStateVersion', 'replayLogVersion'] as const) {
    if (recorded[field] !== current[field]) {
      differences.push(`${field}: recorded ${String(recorded[field])}, build ${String(current[field])}`);
    }
  }
  const recordedTypes = new Set(recorded.requestTypes);
  const currentTypes = new Set(current.requestTypes);
  for (const type of current.requestTypes) if (!recordedTypes.has(type)) differences.push(`request type added: ${type}`);
  for (const type of recorded.requestTypes) if (!currentTypes.has(type)) differences.push(`request type removed: ${type}`);
  for (const file of new Set([...Object.keys(recorded.schemas), ...Object.keys(current.schemas)])) {
    const before = recorded.schemas[file];
    const after = current.schemas[file];
    if (before === undefined) differences.push(`schema added: ${file}`);
    else if (after === undefined) differences.push(`schema removed: ${file}`);
    else if (before !== after) differences.push(`schema changed: ${file}`);
  }
  return differences.sort();
}
