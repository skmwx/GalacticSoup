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
    ['an unknown type', { type: 'campaign.create' }, 'error.invalidRequest.unsupportedRequestType'],
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
