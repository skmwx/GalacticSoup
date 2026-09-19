import { afterEach, describe, expect, it } from 'vitest';

import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import {
  EMPTY_PAYLOAD,
  type CapabilitiesData,
  type ContentSummaryData,
  type EngineResponse,
} from '@protocol';

import { shippedContent } from '../support/content.ts';
import { fixtureRepository } from '../support/contentFixtures.ts';

/**
 * The engine reaches content only through its port, and reports the identity
 * of what it loaded over the protocol (Technical Specification 6.3, 7.1).
 *
 * The same host answered through the in-process transport and through the
 * production worker dispatcher must give the same answer, because a future
 * remote engine has to as well.
 */

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

function transports(content = shippedContent()): { name: string; gateway: ClientGateway }[] {
  const host = createEngineHost({ content });

  const direct = createDirectGateway({ host, defaultTimeoutMs: 2_000 });
  disposers.push(() => direct.dispose());

  const channel = createChannelGateway({ host, defaultTimeoutMs: 2_000 });
  disposers.push(() => channel.close());

  return [
    { name: 'direct', gateway: direct },
    { name: 'channel', gateway: channel.gateway },
  ];
}

function withoutRequestId(response: EngineResponse<unknown>): unknown {
  const { requestId: _requestId, ...rest } = response;
  return rest;
}

describe('content over the protocol', () => {
  it('reports the identity of the content the engine loaded [TECH-6.3, TECH-7.1]', async () => {
    const content = shippedContent();
    const [direct] = transports(content);

    const response = await direct!.gateway.request('content.summary', EMPTY_PAYLOAD);

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }
    const summary = response.data as ContentSummaryData;
    expect(summary.contentVersion).toBe(content.contentVersion);
    expect(summary.contentHash).toBe(content.contentHash);
    expect(summary.defaultLocale).toBe(content.defaultLocale);
    expect(summary.definitionCounts['hulls']).toBe(content.hulls().length);
  });

  it('answers identically over both transports [TECH-4.2, TECH-7.1, TECH-15.1]', async () => {
    const [direct, channel] = transports();

    const first = await direct!.gateway.request('content.summary', EMPTY_PAYLOAD);
    const second = await channel!.gateway.request('content.summary', EMPTY_PAYLOAD);

    expect(withoutRequestId(first)).toEqual(withoutRequestId(second));
  });

  it('reports the content the host was given, not a global one [TECH-4.1, TECH-6.3]', async () => {
    const fixture = fixtureRepository();
    const [direct] = transports(fixture);

    const response = await direct!.gateway.request('content.summary', EMPTY_PAYLOAD);

    expect(response.ok && (response.data as ContentSummaryData).contentVersion).toBe(
      fixture.contentVersion,
    );
    expect(fixture.contentVersion).not.toBe(shippedContent().contentVersion);
  });

  it('lists the content request among the engine capabilities [TECH-7.1]', async () => {
    const [direct] = transports();

    const response = await direct!.gateway.request('system.capabilities', EMPTY_PAYLOAD);

    expect(response.ok && (response.data as CapabilitiesData).requestTypes).toContain(
      'content.summary',
    );
  });
});
