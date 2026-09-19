import { describe, expect, it } from 'vitest';

import {
  EMPTY_PAYLOAD,
  MAX_REQUEST_ID_LENGTH,
  PROTOCOL_VERSION,
  readRequestId,
  UNKNOWN_REQUEST_ID,
  validateClientRequest,
} from '@protocol';

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-1',
    type: 'system.health',
    payload: EMPTY_PAYLOAD,
    ...overrides,
  };
}

describe('client request validation', () => {
  it('accepts a well-formed version 1 envelope [TECH-7.1]', () => {
    const result = validateClientRequest(envelope());

    expect(result.ok).toBe(true);
  });

  it('accepts the optional campaign and revision fields [TECH-7.1]', () => {
    const result = validateClientRequest(
      envelope({ campaignId: 'campaign-1', expectedRevision: 7 }),
    );

    expect(result.ok).toBe(true);
  });

  it('rejects a foreign protocol version and reports both versions [TECH-7.1, TECH-5.4]', () => {
    const result = validateClientRequest(envelope({ protocolVersion: 99 }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('INVALID_REQUEST');
    expect(result.error.messageKey).toBe('error.invalidRequest.protocolVersion');
    expect(result.error.params).toEqual({ expected: PROTOCOL_VERSION, received: '99' });
    expect(result.requestId).toBe('req-1');
  });

  it.each([
    ['a message that is not an object', 'not-an-envelope', 'error.invalidRequest.notAnObject'],
    ['an array', [], 'error.invalidRequest.notAnObject'],
    ['null', null, 'error.invalidRequest.notAnObject'],
  ])('rejects %s [TECH-7.1, TECH-5.4]', (_label, message, messageKey) => {
    const result = validateClientRequest(message);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.messageKey).toBe(messageKey);
      expect(result.requestId).toBe(UNKNOWN_REQUEST_ID);
    }
  });

  it.each([
    ['a missing request id', { requestId: undefined }, 'error.invalidRequest.nonTransportableValue'],
    ['an empty request id', { requestId: '' }, 'error.invalidRequest.requestId'],
    [
      'an over-long request id',
      { requestId: 'x'.repeat(MAX_REQUEST_ID_LENGTH + 1) },
      'error.invalidRequest.requestId',
    ],
    ['a missing type', { type: '' }, 'error.invalidRequest.requestType'],
    ['an unknown type', { type: 'campaign.summon' }, 'error.invalidRequest.unsupportedRequestType'],
    ['an empty campaign id', { campaignId: '' }, 'error.invalidRequest.campaignId'],
    ['a fractional revision', { expectedRevision: 1.5 }, 'error.invalidRequest.expectedRevision'],
    ['a negative revision', { expectedRevision: -1 }, 'error.invalidRequest.expectedRevision'],
    ['an unexpected field', { extra: 'value' }, 'error.invalidRequest.unknownField'],
    ['a non-object payload', { payload: 'text' }, 'error.invalidRequest.payload'],
    ['a payload with fields', { payload: { verbose: true } }, 'error.invalidRequest.payload'],
  ])('rejects %s [TECH-7.1, TECH-5.4]', (_label, overrides, messageKey) => {
    const result = validateClientRequest(envelope(overrides));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(result.error.messageKey).toBe(messageKey);
    }
  });

  it('rejects a value that cannot cross the transport [TECH-4.2, TECH-7.1]', () => {
    const result = validateClientRequest(envelope({ payload: { when: new Date(0) } }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.messageKey).toBe('error.invalidRequest.nonTransportableValue');
      expect(result.error.params).toMatchObject({ reason: 'non-plain-object' });
    }
  });
});

describe('request id extraction', () => {
  it('returns the id when the message carries a usable one [TECH-7.1]', () => {
    expect(readRequestId({ requestId: 'req-9' })).toBe('req-9');
  });

  it.each([
    ['a non-object', 42],
    ['a missing id', {}],
    ['an empty id', { requestId: '' }],
    ['a non-string id', { requestId: 7 }],
  ])('falls back to the unknown correlation id for %s [TECH-7.1]', (_label, message) => {
    expect(readRequestId(message)).toBe(UNKNOWN_REQUEST_ID);
  });
});

describe('command payload validation', () => {
  const seed = '0123456789abcdef0123456789abcdef';

  function create(payload: Record<string, unknown>): ReturnType<typeof validateClientRequest> {
    return validateClientRequest(envelope({ type: 'campaign.create', payload }));
  }

  it('accepts a well-formed campaign.create payload [TECH-7.1, FUNC-3.1]', () => {
    expect(create({ displayName: 'Vela', seed, createdAtRealMs: 0 }).ok).toBe(true);
  });

  it.each([
    ['a missing field', { displayName: 'Vela', seed }],
    ['an unexpected field', { displayName: 'Vela', seed, createdAtRealMs: 0, extra: 1 }],
    ['a blank display name', { displayName: '   ', seed, createdAtRealMs: 0 }],
    ['an over-long display name', { displayName: 'x'.repeat(49), seed, createdAtRealMs: 0 }],
    ['a control character in the name', { displayName: 'a\tb', seed, createdAtRealMs: 0 }],
    ['a short seed', { displayName: 'Vela', seed: 'abc', createdAtRealMs: 0 }],
    ['an upper-case seed', { displayName: 'Vela', seed: seed.toUpperCase(), createdAtRealMs: 0 }],
    ['a fractional timestamp', { displayName: 'Vela', seed, createdAtRealMs: 1.5 }],
  ])('rejects campaign.create with %s [TECH-7.1, TECH-5.4]', (_label, payload) => {
    const result = create(payload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.messageKey).toBe('error.invalidRequest.payload');
    }
  });

  it.each([
    ['a well-formed setting', { paused: false, rate: 1 }, true],
    ['pause', { paused: true, rate: 1 }, true],
    ['a missing rate', { paused: true }, false],
    ['a zero rate', { paused: false, rate: 0 }, false],
    ['a non-boolean pause', { paused: 'yes', rate: 1 }, false],
  ])('validates time.set with %s [TECH-7.1, FUNC-3.3]', (_label, payload, expected) => {
    expect(validateClientRequest(envelope({ type: 'time.set', payload })).ok).toBe(expected);
  });

  it.each([
    ['a whole delta', { elapsedRealMs: 16 }, true],
    ['a zero delta', { elapsedRealMs: 0 }, true],
    ['a fractional delta', { elapsedRealMs: 16.7 }, false],
    ['a negative delta', { elapsedRealMs: -1 }, false],
  ])('validates time.advance with %s [TECH-7.1, TECH-9.1]', (_label, payload, expected) => {
    expect(validateClientRequest(envelope({ type: 'time.advance', payload })).ok).toBe(expected);
  });

  it.each(['campaign.reset', 'campaign.session', 'campaign.frame', 'diagnostics.stateHash'])(
    'requires an empty payload for %s [TECH-7.1]',
    (type) => {
      expect(validateClientRequest(envelope({ type, payload: EMPTY_PAYLOAD })).ok).toBe(true);
      expect(validateClientRequest(envelope({ type, payload: { extra: 1 } })).ok).toBe(false);
    },
  );
});
