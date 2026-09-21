import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { createEngineHost } from '@engine';
import { createMemorySaveStore } from '@adapters/persistence';
import { PROTOCOL_VERSION, validateClientRequest, type AssetsData } from '@protocol';
import { shippedContent } from '../../support/content';

const Constructor = (Ajv2020 as unknown as { default: typeof Ajv2020 }).default;
const ajv = new Constructor({ strict: true, allErrors: true });
for (const file of readdirSync('schemas/protocol').filter((f) => f.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(`schemas/protocol/${file}`, 'utf8')));
}
const base = 'https://galacticsoup.invalid/schemas/protocol/';
const validateRequest = ajv.getSchema(base + 'client-request.schema.json')!;
const entity = 'c0123456789abcdef01234567-e1';
const payloads: Record<string, Record<string, unknown>> = {
  'assets.list': {}, 'wallet.get': {}, 'inventory.hangar': { stationId: 'station.test' },
  'inventory.cargo': { shipId: entity }, 'item.inspect': { stackId: entity },
  'inventory.maximum': { stackId: entity, destinationInventoryId: entity },
  'inventory.transfer': { stackId: entity, destinationInventoryId: entity, quantity: 1 },
  'inventory.split': { stackId: entity, quantity: 1 },
  'inventory.merge': { sourceStackId: entity, targetStackId: entity },
};
describe('asset protocol schemas', () => {
  it.each(Object.entries(payloads))('agrees with runtime validation for %s and malformed variants [TECH-7.1, TECH-17]', (type, payload) => {
    const variants = [payload, { ...payload, unknown: 1 }];
    for (const key of Object.keys(payload)) {
      const missing = { ...payload }; delete missing[key]; variants.push(missing);
      for (const bad of [null, true, '', 'x', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) variants.push({ ...payload, [key]: bad });
    }
    for (const p of variants) {
      const request = { protocolVersion: PROTOCOL_VERSION, requestId: 'test', type, payload: p };
      expect(validateClientRequest(request).ok, JSON.stringify(request)).toBe(validateRequest(request));
    }
    expect(validateRequest({ protocolVersion: PROTOCOL_VERSION, requestId: 'test', type, payload })).toBe(true);
  });
  it('rejects the previous protocol version with an explainable compatibility error [TECH-7.1, TECH-18]', () => {
    const request = { protocolVersion: 1, requestId: 'old-client', type: 'assets.list', payload: {} };
    expect(validateRequest(request)).toBe(false);
    const validation = validateClientRequest(request);
    expect(!validation.ok && validation.error.messageKey).toBe('error.invalidRequest.protocolVersion');
  });
  it('uses the shared definition ID grammar and length bound for station queries [TECH-5.1, TECH-7.1]', () => {
    for (const stationId of ['station.a-', 'station.a--b', `station.${'a'.repeat(88)}`, `station.${'a'.repeat(89)}`, 'station.a..b']) {
      const request = { protocolVersion: PROTOCOL_VERSION, requestId: 'station-query', type: 'inventory.hangar', payload: { stationId } };
      expect(validateClientRequest(request).ok).toBe(validateRequest(request));
    }
  });
  it('validates every new response and returns frozen views without exposing authority [TECH-7.3, TECH-17]', async () => {
    const host = createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() });
    let ordinal = 0;
    const ask = async (type: string, payload: unknown) => {
      const result = await host.handle({ protocolVersion: PROTOCOL_VERSION, requestId: `r${ordinal++}`, type, payload });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result.data;
    };
    await ask('campaign.create', { displayName: 'Schema Pilot', seed: '0123456789abcdef0123456789abcdef', createdAtRealMs: 1 });
    const assets = await ask('assets.list', {}) as AssetsData;
    const hangar = assets.inventories.find((i) => i.location.kind === 'hangar')!;
    const cargo = assets.inventories.find((i) => i.location.kind === 'cargo')!;
    const stack = hangar.stacks[0]!;
    const queries: Record<string, unknown> = {
      'assets.list': {}, 'wallet.get': {}, 'inventory.hangar': {
        stationId: assets.location.kind === 'station' ? assets.location.stationId : 'station.invalid',
      },
      'inventory.cargo': { shipId: assets.activeShipId }, 'item.inspect': { stackId: stack.id },
      'inventory.maximum': { stackId: stack.id, destinationInventoryId: cargo.id },
    };
    const before = await ask('diagnostics.stateHash', {});
    for (const [type, payload] of Object.entries(queries)) {
      const view = await ask(type, payload);
      const validate = ajv.getSchema(`${base}${type}.data.schema.json`)!;
      expect(validate(view), JSON.stringify(validate.errors)).toBe(true);
      expect(Object.isFrozen(view)).toBe(true);
    }
    expect(Object.isFrozen(stack.provenance)).toBe(true);
    expect(() => Object.assign(stack, { quantity: 999 })).toThrow();
    expect(await ask('diagnostics.stateHash', {})).toEqual(before);
  });
});
