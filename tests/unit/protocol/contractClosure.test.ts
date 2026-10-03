import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { COMMAND_TYPES, PERSISTENCE_TYPES, REQUEST_TYPES } from '@protocol';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import {
  contractDifferences,
  currentContractLock,
  readContractLock,
  writeContractLock,
} from '../../support/contractLock.ts';
import { auditSchema } from '../../support/schemaAudit.ts';
import { protocolSchemas, readSchema } from '../../support/schemas.ts';

/**
 * The MVP protocol and save contracts, closed
 * (MVP Implementation Plan phase 20; Technical Specification 7.1, 11.2, 17,
 * 18).
 *
 * `npm run contracts:record` runs this file with `CONTRACTS_RECORD=1`, which
 * writes the lock instead of comparing with it.
 */

const recording = process.env['CONTRACTS_RECORD'] === '1';

/**
 * The fields the specification itself makes optional, as `pointer#property`.
 * Every other field of every protocol message is required.
 */
const OPTIONAL_BY_SPECIFICATION: Readonly<Record<string, readonly string[]>> = {
  // Technical Specification 7.1: the envelope names a campaign and an expected
  // revision only when the caller wants them checked.
  'client-request.schema.json': [
    '/#campaignId',
    '/#expectedRevision',
    // Functional Specification 11.3: bought goods go to the hangar by default.
    '/$defs/marketBuyPreviewPayload#destinationInventoryId',
    // Technical Specification 12.5: absent asks for the default locale.
    '/$defs/contentMessagesPayload#locale',
  ],
  // Technical Specification 7.1: a failure reports a revision when one exists.
  'engine-response.schema.json': ['/$defs/failure#revision'],
  // Technical Specification 5.4, 7.4: parameters when the message has any, and
  // the replacement preview only with STALE_PREVIEW.
  'engine-error.schema.json': ['/#params', '/#replacementPreview'],
  'domain-event.schema.json': ['/#params'],
};

/**
 * Values a second schema describes: the payload is selected by the request
 * type, and the data of a success by the request it answers. The two tests
 * after the audit check that every type has both.
 */
const DESCRIBED_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  'client-request.schema.json': ['/properties/payload'],
  'engine-response.schema.json': ['/$defs/success/properties/data'],
};

const protocolFiles = readdirSync(path.join(REPO_ROOT, 'schemas', 'protocol'))
  .filter((file) => file.endsWith('.schema.json'))
  .sort();

describe('the published protocol contracts are closed', () => {
  it.each(protocolFiles)('%s leaves no field undescribed or silently optional [TECH-7.1, TECH-17, TECH-18]', (file) => {
    const findings = auditSchema(readSchema('protocol', file), {
      optional: OPTIONAL_BY_SPECIFICATION[file] ?? [],
      deferred: DESCRIBED_BY_TYPE[file] ?? [],
    });
    expect(findings).toEqual([]);
  });

  it('describes the payload of every request type [TECH-7.1, TECH-7.2]', () => {
    const request = readSchema('protocol', 'client-request.schema.json') as {
      properties: { type: { enum: string[] } };
      allOf: { if: { properties: { type: { enum?: string[]; const?: string } } }; then: { properties: { payload: object } } }[];
    };
    expect([...request.properties.type.enum].sort()).toEqual([...REQUEST_TYPES].sort());

    // The payload itself is described by one conditional per type.
    const described = new Set<string>();
    for (const conditional of request.allOf) {
      const selector = conditional.if.properties.type;
      expect(conditional.then.properties.payload).toBeDefined();
      for (const type of selector.enum ?? [selector.const ?? '']) described.add(type);
    }
    expect(REQUEST_TYPES.filter((type) => !described.has(type))).toEqual([]);
  });

  it('publishes the answer of every request type [TECH-7.1, TECH-7.3, TECH-17]', () => {
    const schemas = protocolSchemas();
    const answered = (type: string): boolean =>
      (COMMAND_TYPES as readonly string[]).includes(type) ||
      (PERSISTENCE_TYPES as readonly string[]).includes(type) ||
      schemas.dataOf(type) !== null;
    expect(REQUEST_TYPES.filter((type) => !answered(type))).toEqual([]);
    // A command answers with the shared command result and a save request with
    // the save status; both are published too.
    expect(schemas.dataOf('command-result')).not.toBeNull();
    expect(schemas.dataOf('save-status')).not.toBeNull();
  });
});

describe('what the protocol does not offer', () => {
  it('has no request for another player and none that steers [FUNC-22.14, FUNC-7.1]', () => {
    // Every request belongs to a family the single-player loop needs.
    const families = new Set(REQUEST_TYPES.map((type) => type.slice(0, type.indexOf('.'))));
    expect([...families].sort()).toEqual([
      'assets', 'audio', 'campaign', 'combat', 'content', 'diagnostics', 'encounter', 'fitting',
      'insurance', 'inventory', 'item', 'loot', 'loss', 'market', 'module', 'movement', 'navigation',
      'notifications', 'onboarding', 'repair', 'resupply', 'ship', 'station', 'system', 'targeting',
      'time', 'wallet', 'weapon',
    ]);
    // Movement is the five discrete orders of Functional Specification 7.1;
    // nothing takes a held direction or a throttle.
    expect(REQUEST_TYPES.filter((type) => type.startsWith('movement.')).sort()).toEqual([
      'movement.approach', 'movement.keepRange', 'movement.moveToPoint', 'movement.orbit', 'movement.stop',
    ]);
  });
});

describe('the contract lock', () => {
  it('matches the versions and schemas this build publishes [TECH-7.1, TECH-11.2, TECH-18]', () => {
    if (recording) writeContractLock(currentContractLock());

    const recorded = readContractLock();
    expect(recorded, 'No contract lock is recorded; run npm run contracts:record.').not.toBeNull();
    if (recorded === null) return;
    expect(
      contractDifferences(recorded, currentContractLock()),
      'A published contract changed. Bump the version the change belongs to (MVP plan section 2, rule 6), ' +
        'then record the lock again with npm run contracts:record.',
    ).toEqual([]);
  });
});
