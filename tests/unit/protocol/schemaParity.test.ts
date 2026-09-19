import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { createEngineHost } from '@engine';
import {
  CONTENT_ERROR_REASONS,
  EMPTY_PAYLOAD,
  PROTOCOL_VERSION,
  REQUEST_TYPES,
  validateClientRequest,
} from '@protocol';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import { shippedContent } from '../../support/content.ts';

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
let validateContentSummaryData: Validator;
let validateCommandResultData: Validator;
let validateSessionData: Validator;
let validateFrameData: Validator;
let validateStateHashData: Validator;

const content = shippedContent();

function loadSchema(name: string): object {
  const file = path.join(REPO_ROOT, 'schemas', 'protocol', name);
  return JSON.parse(readFileSync(file, 'utf8')) as object;
}

beforeAll(() => {
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  ajv.addSchema(loadSchema('engine-error.schema.json'));
  ajv.addSchema(loadSchema('domain-event.schema.json'));
  validateRequest = ajv.compile(loadSchema('client-request.schema.json')) as Validator;
  validateResponse = ajv.compile(loadSchema('engine-response.schema.json')) as Validator;
  validateHealthData = ajv.compile(loadSchema('system.health.data.schema.json')) as Validator;
  validateCapabilitiesData = ajv.compile(
    loadSchema('system.capabilities.data.schema.json'),
  ) as Validator;
  validateContentSummaryData = ajv.compile(
    loadSchema('content.summary.data.schema.json'),
  ) as Validator;
  validateCommandResultData = ajv.compile(
    loadSchema('command-result.data.schema.json'),
  ) as Validator;
  validateSessionData = ajv.compile(loadSchema('campaign.session.data.schema.json')) as Validator;
  validateFrameData = ajv.compile(loadSchema('campaign.frame.data.schema.json')) as Validator;
  validateStateHashData = ajv.compile(
    loadSchema('diagnostics.stateHash.data.schema.json'),
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
      type: 'campaign.summon',
      payload: {},
    },
  },
  {
    label: 'a well-formed campaign.create',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.create',
      payload: {
        displayName: 'Vela',
        seed: '0123456789abcdef0123456789abcdef',
        createdAtRealMs: 1,
      },
    },
  },
  {
    label: 'a campaign.create with a malformed seed',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.create',
      payload: { displayName: 'Vela', seed: 'nope', createdAtRealMs: 1 },
    },
  },
  {
    label: 'a campaign.create with a blank display name',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.create',
      payload: {
        displayName: '  ',
        seed: '0123456789abcdef0123456789abcdef',
        createdAtRealMs: 1,
      },
    },
  },
  {
    label: 'a well-formed time.set',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'time.set',
      payload: { paused: false, rate: 1 },
    },
  },
  {
    label: 'a time.set with a zero rate',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'time.set',
      payload: { paused: false, rate: 0 },
    },
  },
  {
    label: 'a well-formed time.advance',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'time.advance',
      payload: { elapsedRealMs: 16 },
    },
  },
  {
    label: 'a time.advance with a fractional delta',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'time.advance',
      payload: { elapsedRealMs: 16.5 },
    },
  },
  {
    label: 'a query carrying payload fields',
    message: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r',
      type: 'campaign.session',
      payload: { verbose: true },
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

  it('validates every engine response against the response schema [TECH-7.1]', async () => {
    const host = createEngineHost({ content });

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

    const summary = await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-content',
      type: 'content.summary',
      payload: EMPTY_PAYLOAD,
    });

    expect(validateResponse(health)).toBe(true);
    expect(validateResponse(capabilities)).toBe(true);
    expect(validateResponse(summary)).toBe(true);
    expect(health.ok && validateHealthData(health.data)).toBe(true);
    expect(capabilities.ok && validateCapabilitiesData(capabilities.data)).toBe(true);
    expect(summary.ok && validateContentSummaryData(summary.data)).toBe(true);
  });

  it('publishes a compilable schema for every protocol contract [TECH-7.1, TECH-17]', () => {
    const ajv = new AjvConstructor({ allErrors: true, strict: true });
    const directory = path.join(REPO_ROOT, 'schemas', 'protocol');
    const files = readdirSync(directory).filter((file) => file.endsWith('.schema.json'));

    expect(files.length).toBeGreaterThan(0);

    const ids = files.map((file) => {
      const schema = loadSchema(file) as { $id?: string };
      ajv.addSchema(schema);
      expect(schema.$id, file).toBeTypeOf('string');
      return schema.$id as string;
    });

    // getSchema compiles the schema and its references, so an unresolvable
    // reference or an illegal keyword fails here rather than in production.
    for (const id of ids) {
      expect(ajv.getSchema(id), id).toBeTypeOf('function');
    }
  });

  it('lists the same request types as the runtime catalogue [TECH-7.1, TECH-17]', () => {
    const schema = loadSchema('client-request.schema.json') as {
      properties: { type: { enum: string[] } };
    };

    expect(schema.properties.type.enum).toEqual([...REQUEST_TYPES]);
  });

  it('lists the same content error reasons as the runtime catalogue [TECH-5.4, TECH-6.2]', () => {
    const schema = loadSchema('content-issue.schema.json') as {
      properties: { reason: { enum: string[] } };
    };

    expect(schema.properties.reason.enum).toEqual([...CONTENT_ERROR_REASONS]);
  });

  it('validates a failure response against the response schema [TECH-5.4, TECH-7.1]', async () => {
    const failure = await createEngineHost({ content }).handle({ nonsense: true });

    expect(failure.ok).toBe(false);
    expect(validateResponse(failure)).toBe(true);
  });
});

describe('campaign protocol schema parity', () => {
  const seed = 'aa11bb22cc33dd44ee55ff6677889900';

  async function ask(
    host: ReturnType<typeof createEngineHost>,
    type: string,
    payload: unknown,
    requestId: string,
  ): Promise<unknown> {
    return host.handle({ protocolVersion: PROTOCOL_VERSION, requestId, type, payload });
  }

  it('publishes a schema for every campaign response shape [TECH-7.1, TECH-17]', async () => {
    const host = createEngineHost({ content });

    const created = await ask(
      host,
      'campaign.create',
      { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000 },
      'req-create',
    );
    const running = await ask(host, 'time.set', { paused: false, rate: 1 }, 'req-run');
    const advanced = await ask(host, 'time.advance', { elapsedRealMs: 120 }, 'req-advance');
    const session = await ask(host, 'campaign.session', EMPTY_PAYLOAD, 'req-session');
    const frame = await ask(host, 'campaign.frame', EMPTY_PAYLOAD, 'req-frame');
    const hash = await ask(host, 'diagnostics.stateHash', EMPTY_PAYLOAD, 'req-hash');

    for (const response of [created, running, advanced, session, frame, hash]) {
      expect(validateResponse(response)).toBe(true);
    }

    const dataOf = (response: unknown): unknown => (response as { data: unknown }).data;

    expect(validateCommandResultData(dataOf(created))).toBe(true);
    expect(validateCommandResultData(dataOf(running))).toBe(true);
    expect(validateCommandResultData(dataOf(advanced))).toBe(true);
    expect(validateSessionData(dataOf(session))).toBe(true);
    expect(validateFrameData(dataOf(frame))).toBe(true);
    expect(validateStateHashData(dataOf(hash))).toBe(true);
  });

  it('validates the no-campaign projections against their schemas [TECH-7.1, TECH-7.3]', async () => {
    const host = createEngineHost({ content });

    const session = await ask(host, 'campaign.session', EMPTY_PAYLOAD, 'req-session');
    const frame = await ask(host, 'campaign.frame', EMPTY_PAYLOAD, 'req-frame');
    const hash = await ask(host, 'diagnostics.stateHash', EMPTY_PAYLOAD, 'req-hash');

    expect(validateSessionData((session as { data: unknown }).data)).toBe(true);
    expect(validateFrameData((frame as { data: unknown }).data)).toBe(true);
    expect(validateStateHashData((hash as { data: unknown }).data)).toBe(true);
  });
});
