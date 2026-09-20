import { readdirSync, readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import { FIT_VIOLATIONS, FIT_WARNINGS, MAX_SLOT_INDEX, SLOT_ORDER } from '@engine/domain';
import { SLOT_KINDS } from '@engine/ports';
import {
  FIT_VIOLATION_CODES,
  FIT_WARNING_CODES,
  PROTOCOL_VERSION,
  validateClientRequest,
  type AssetsData,
} from '@protocol';

import { shippedContent } from '../../support/content';

/**
 * The fitting contracts (Technical Specification 7.1, 17).
 *
 * The hand-written runtime validator and the published JSON Schemas must agree
 * exactly, because a future engine in another language validates against the
 * schemas rather than against this code.
 */

const Constructor = (Ajv2020 as unknown as { default: typeof Ajv2020 }).default;
const ajv = new Constructor({ strict: true, allErrors: true });
for (const file of readdirSync('schemas/protocol').filter((name) => name.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(`schemas/protocol/${file}`, 'utf8')));
}
const base = 'https://galacticsoup.invalid/schemas/protocol/';
const validateRequest = ajv.getSchema(`${base}client-request.schema.json`)!;

const entity = 'c0123456789abcdef01234567-e1';
const payloads: Record<string, Record<string, unknown>> = {
  'ship.get': { shipId: entity },
  'ship.undockValidity': { shipId: entity },
  'fitting.draft': {},
  'fitting.begin': { shipId: entity },
  'fitting.set': {
    slotKind: 'weapon',
    slotIndex: 0,
    moduleId: 'module.turret.autocannon.small',
    online: true,
  },
  'fitting.clear': { slotKind: 'weapon', slotIndex: 1 },
  'fitting.revert': {},
  'fitting.commit': {},
  'item.compare': {
    definitionId: 'module.turret.autocannon.small',
    againstDefinitionId: 'module.turret.railgun.small',
  },
};

describe('fitting protocol schemas', () => {
  it.each(Object.entries(payloads))(
    'agrees with runtime validation for %s and malformed variants [TECH-7.1, TECH-17]',
    (type, payload) => {
      const variants: Record<string, unknown>[] = [payload, { ...payload, unknown: 1 }];
      for (const key of Object.keys(payload)) {
        const missing = { ...payload };
        delete missing[key];
        variants.push(missing);
        for (const bad of [null, true, '', 'x', 0, -1, 1.5, 16, Number.MAX_SAFE_INTEGER + 1]) {
          variants.push({ ...payload, [key]: bad });
        }
      }
      for (const candidate of variants) {
        const request = {
          protocolVersion: PROTOCOL_VERSION,
          requestId: 'test',
          type,
          payload: candidate,
        };
        expect(validateClientRequest(request).ok, JSON.stringify(request)).toBe(
          validateRequest(request),
        );
      }
      expect(
        validateRequest({ protocolVersion: PROTOCOL_VERSION, requestId: 'test', type, payload }),
      ).toBe(true);
    },
  );

  it('accepts an optional charge and refuses one of the wrong namespace [TECH-7.1]', () => {
    const request = (ammunitionId: unknown) => ({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'charge',
      type: 'fitting.set',
      payload: { ...payloads['fitting.set'], ammunitionId },
    });

    for (const value of ['ammo.projectile.small.fusion', 'module.turret.railgun.small', 'ammo', 7]) {
      expect(validateClientRequest(request(value)).ok, String(value)).toBe(
        validateRequest(request(value)),
      );
    }
    expect(validateClientRequest(request('ammo.projectile.small.fusion')).ok).toBe(true);
  });

  it('bounds slot kinds and indices the same way the engine does [TECH-5.1, TECH-7.1]', () => {
    expect(SLOT_ORDER).toEqual([...SLOT_KINDS]);
    for (const slotIndex of [0, MAX_SLOT_INDEX, MAX_SLOT_INDEX + 1]) {
      const request = {
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'slot',
        type: 'fitting.clear',
        payload: { slotKind: 'weapon', slotIndex },
      };
      expect(validateClientRequest(request).ok, String(slotIndex)).toBe(validateRequest(request));
    }
  });

  it('publishes a message key for every fitting code the engine can report [TECH-5.4, TECH-12.5]', () => {
    expect([...FIT_VIOLATION_CODES].sort()).toEqual([...FIT_VIOLATIONS].sort());
    expect([...FIT_WARNING_CODES].sort()).toEqual([...FIT_WARNINGS].sort());
  });

  it('validates every fitting response against its schema and freezes it [TECH-7.3, TECH-17]', async () => {
    const host = createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() });
    let ordinal = 0;
    const ask = async (type: string, payload: unknown): Promise<unknown> => {
      const result = await host.handle({
        protocolVersion: PROTOCOL_VERSION,
        requestId: `r${String(ordinal++)}`,
        type,
        payload,
      });
      if (!result.ok) {
        throw new Error(JSON.stringify(result.error));
      }
      return result.data;
    };

    await ask('campaign.create', {
      displayName: 'Fitting Pilot',
      seed: '0123456789abcdef0123456789abcdef',
      createdAtRealMs: 1,
    });
    const assets = (await ask('assets.list', {})) as AssetsData;
    await ask('fitting.begin', { shipId: assets.activeShipId });
    await ask('fitting.set', {
      slotKind: 'engineering',
      slotIndex: 0,
      moduleId: 'module.plating.armor.small',
      online: true,
    });

    const queries: Record<string, unknown> = {
      'ship.get': { shipId: assets.activeShipId },
      'ship.undockValidity': { shipId: assets.activeShipId },
      'fitting.draft': {},
      'item.compare': {
        definitionId: 'module.turret.autocannon.small',
        againstDefinitionId: 'module.turret.railgun.small',
      },
    };

    for (const [type, payload] of Object.entries(queries)) {
      const view = await ask(type, payload);
      const validate = ajv.getSchema(`${base}${type}.data.schema.json`)!;
      expect(validate(view), `${type}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(Object.isFrozen(view), type).toBe(true);
    }
  });
});
