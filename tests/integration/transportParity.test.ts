import { afterEach, describe, expect, it } from 'vitest';

import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import {
  EMPTY_PAYLOAD,
  PROTOCOL_VERSION,
  REQUEST_TYPES,
  type CapabilitiesData,
  type EngineResponse,
  type HealthData,
} from '@protocol';

import { shippedContent } from '../support/content.ts';

/**
 * The same engine, reached two ways, must answer identically
 * (Technical Specification 7.1, 15.1, 17). The direct gateway calls the host in
 * process; the channel gateway goes through the production worker dispatcher
 * and real structured-clone messaging.
 */

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

function transports(): { name: string; gateway: ClientGateway }[] {
  const host = createEngineHost({ content: shippedContent(), engineVersion: '1.2.3' });

  const direct = createDirectGateway({ host, defaultTimeoutMs: 2_000 });
  disposers.push(() => direct.dispose());

  const channel = createChannelGateway({ host, defaultTimeoutMs: 2_000 });
  disposers.push(() => channel.close());

  return [
    { name: 'direct', gateway: direct },
    { name: 'channel', gateway: channel.gateway },
  ];
}

/** Request ids differ per call; everything else must match exactly. */
function withoutRequestId(response: EngineResponse<unknown>): unknown {
  const { requestId: _requestId, ...rest } = response;
  return rest;
}

describe('transport parity', () => {
  it('returns the same health response over both transports [TECH-4.2, TECH-7.1, TECH-15.1]', async () => {
    const [direct, channel] = transports();

    const first = await direct!.gateway.request('system.health', EMPTY_PAYLOAD);
    const second = await channel!.gateway.request('system.health', EMPTY_PAYLOAD);

    expect(withoutRequestId(first)).toEqual(withoutRequestId(second));
    expect(first.ok && (first.data as HealthData).engineVersion).toBe('1.2.3');
  });

  it('returns the same capabilities over both transports [TECH-4.2, TECH-7.1]', async () => {
    const [direct, channel] = transports();

    const first = await direct!.gateway.request('system.capabilities', EMPTY_PAYLOAD);
    const second = await channel!.gateway.request('system.capabilities', EMPTY_PAYLOAD);

    expect(withoutRequestId(first)).toEqual(withoutRequestId(second));
    expect(first.ok && (first.data as CapabilitiesData).requestTypes).toEqual([
      ...REQUEST_TYPES,
    ]);
  });

  it.each([
    [
      'an unknown request type',
      {
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'parity-unknown',
        type: 'campaign.summon',
        payload: {},
      },
      'error.invalidRequest.unsupportedRequestType',
    ],
    [
      'a foreign protocol version',
      { protocolVersion: 99, requestId: 'parity-version', type: 'system.health', payload: {} },
      'error.invalidRequest.protocolVersion',
    ],
    [
      'an unexpected envelope field',
      {
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'parity-extra',
        type: 'system.health',
        payload: {},
        extra: 1,
      },
      'error.invalidRequest.unknownField',
    ],
  ])(
    'rejects %s identically over both transports [TECH-5.4, TECH-15.1]',
    async (_label, message, messageKey) => {
      const [direct, channel] = transports();

      const first = await direct!.gateway.sendEnvelope(message);
      const second = await channel!.gateway.sendEnvelope(message);

      expect(withoutRequestId(first)).toEqual(withoutRequestId(second));
      expect(first.ok).toBe(false);
      if (!first.ok) {
        expect(first.error.messageKey).toBe(messageKey);
      }
    },
  );

  it('rejects a message that is not an envelope over both transports [TECH-5.4]', async () => {
    const [direct, channel] = transports();

    const first = await direct!.gateway.sendEnvelope('nonsense', { correlationId: '' });
    const second = await channel!.gateway.sendEnvelope('nonsense', { correlationId: '' });

    expect(withoutRequestId(first)).toEqual(withoutRequestId(second));
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('reports its transport without changing the contract [TECH-17]', () => {
    const [direct, channel] = transports();

    expect(direct!.gateway.transport).toBe('direct');
    expect(channel!.gateway.transport).toBe('port');
  });
});
