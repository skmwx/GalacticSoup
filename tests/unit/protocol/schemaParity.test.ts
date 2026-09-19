import { readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { createEngineHost } from '@engine';
import { EMPTY_PAYLOAD, PROTOCOL_VERSION, validateClientRequest } from '@protocol';

import { REPO_ROOT } from '../../../config/aliases.mjs';

/**
 * The runtime validator is hand-written so the engine carries no library
 * dependency. The published JSON Schemas must describe exactly the same
 * contract, because a future Java engine validates against them
 * (Technical Specification 7.1, 17, 18).
 */

type Validator = (value: unknown) => boolean;

const AjvConstructor = (
  Ajv2020 as unknown as { default?: typeof Ajv2020 }
).default as unknown as typeof Ajv2020;

let validateRequest: Validator;
let validateResponse: Validator;
let validateHealthData: Validator;
let validateCapabilitiesData: Validator;

function loadSchema(name: string): object {
  const file = path.join(REPO_ROOT, 'schemas', 'protocol', name);
  return JSON.parse(readFileSync(file, 'utf8')) as object;
}

beforeAll(() => {
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  ajv.addSchema(loadSchema('engine-error.schema.json'));
  validateRequest = ajv.compile(loadSchema('client-request.schema.json')) as Validator;
  validateResponse = ajv.compile(loadSchema('engine-response.schema.json')) as Validator;
  validateHealthData = ajv.compile(loadSchema('system.health.data.schema.json')) as Validator;
  validateCapabilitiesData = ajv.compile(
    loadSchema('system.capabilities.data.schema.json'),
  ) as Validator;
});

const JSON_FIXTURES: readonly { readonly label: string; readonly message: unknown }[] = [
  {
    label: 'a valid health request',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-1',
      type: 'system.health',
      payload: EMPTY_PAYLOAD,
    },
  },
  {
    label: 'a valid capabilities request with campaign and revision',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-2',
      campaignId: 'campaign-1',
      expectedRevision: 3,
      type: 'system.capabilities',
      payload: {},
    },
  },
  {
    label: 'a foreign protocol version',
    message: { protocolVersion: 2, requestId: 'r', type: 'system.health', payload: {} },
  },
  {
    label: 'an unknown request type',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.create',
      payload: {},
    },
  },
  {
    label: 'an empty request id',
    message: { protocolVersion: PROTOCOL_VERSION, requestId: '', type: 'system.health', payload: {} },
  },
  {
    label: 'an unexpected envelope field',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'system.health',
      payload: {},
      extra: true,
    },
  },
  {
    label: 'a payload with fields',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'system.health',
      payload: { verbose: true },
    },
  },
  {
    label: 'a negative expected revision',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'system.health',
      payload: {},
      expectedRevision: -1,
    },
  },
  { label: 'a message that is not an object', message: 'nonsense' },
];

describe('protocol schema parity', () => {
  it.each(JSON_FIXTURES)(
    'agrees with the runtime validator on $label [TECH-7.1]',
    ({ message }) => {
      expect(validateRequest(message)).toBe(validateClientRequest(message).ok);
    },
  );

  it('validates both engine responses against the response schema [TECH-7.1]', async () => {
    const host = createEngineHost();

    const health = await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-health',
      type: 'system.health',
      payload: EMPTY_PAYLOAD,
    });
    const capabilities = await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-capabilities',
      type: 'system.capabilities',
      payload: EMPTY_PAYLOAD,
    });

    expect(validateResponse(health)).toBe(true);
    expect(validateResponse(capabilities)).toBe(true);
    expect(health.ok && validateHealthData(health.data)).toBe(true);
    expect(capabilities.ok && validateCapabilitiesData(capabilities.data)).toBe(true);
  });

  it('validates a failure response against the response schema [TECH-5.4, TECH-7.1]', async () => {
    const failure = await createEngineHost().handle({ nonsense: true });

    expect(failure.ok).toBe(false);
    expect(validateResponse(failure)).toBe(true);
  });
});
