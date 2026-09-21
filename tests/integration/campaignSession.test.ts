import { PROTOCOL_VERSION } from '@protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import {
  EMPTY_PAYLOAD,
  type CommandResultData,
  type FrameData,
  type SessionData,
} from '@protocol';

import { shippedContent } from '../support/content.ts';

/**
 * The campaign session through a real transport
 * (Technical Specification 7.2, 15.1; MVP-AC-01).
 *
 * These cases run against the channel gateway, which uses the production
 * worker dispatcher and structured-clone messaging, so a value that cannot
 * cross the boundary fails here rather than in the browser.
 */

const content = shippedContent();
const QUANTUM = content.rules.time.simulationQuantumMs;
const SEED = '0123456789abcdef0123456789abcdef';

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

const TRANSPORTS = ['direct', 'channel'] as const;

type TransportName = (typeof TRANSPORTS)[number];

function gatewayFor(name: TransportName): ClientGateway {
  if (name === 'direct') {
    const direct = createDirectGateway({
      host: createEngineHost({ content, saves: createMemorySaveStore() }),
      defaultTimeoutMs: 5_000,
    });
    disposers.push(() => direct.dispose());
    return direct;
  }

  const channel = createChannelGateway({
    host: createEngineHost({ content, saves: createMemorySaveStore() }),
    defaultTimeoutMs: 5_000,
  });
  disposers.push(() => channel.close());
  return channel.gateway;
}

async function create(gateway: ClientGateway): Promise<CommandResultData> {
  const response = await gateway.request('campaign.create', {
    displayName: 'Vela Trask',
    seed: SEED,
    createdAtRealMs: 1_700_000_000_000,
  });
  if (!response.ok) {
    throw new Error(`campaign.create failed: ${JSON.stringify(response.error)}`);
  }
  return response.data;
}

describe('campaign session over a transport', () => {
  it.each(TRANSPORTS)(
    'creates, runs and resets a campaign over the %s gateway [MVP-AC-01, TECH-15.1]',
    async (name) => {
      const gateway = gatewayFor(name);

      const created = await create(gateway);
      expect(created.committed).toBe(true);
      expect(created.revision).toBe(1);
      expect(created.invalidations).toEqual(
        ['assets', 'destinations', 'fitting', 'frame', 'insurance', 'inventory', 'market',
          'navigation', 'repair', 'resupply', 'saves', 'session', 'ship', 'site', 'station', 'wallet'],
      );

      const running = await gateway.request('time.set', { paused: false, rate: 1 });
      expect(running.ok).toBe(true);

      const advanced = await gateway.request('time.advance', { elapsedRealMs: QUANTUM * 2 });
      expect(advanced.ok && advanced.data.simulationTimeMs).toBe(QUANTUM * 2);

      const frame = await gateway.request('campaign.frame', EMPTY_PAYLOAD);
      expect(frame.ok && (frame.data as FrameData).paused).toBe(false);
      expect(frame.ok && (frame.data as FrameData).scheduledBoundaryCount).toBe(1);
      expect(frame.ok && (frame.data as FrameData).nextBoundaryAtMs).toBe(3_600_000);

      const reset = await gateway.request('campaign.reset', EMPTY_PAYLOAD);
      expect(reset.ok && reset.data.campaignId).toBeNull();

      const session = await gateway.request('campaign.session', EMPTY_PAYLOAD);
      expect(session.ok && (session.data as SessionData).campaign).toBeNull();
    },
  );

  it('reports the same campaign identity for the same seed [TECH-5.1, TECH-9.5]', async () => {
    const left = await create(gatewayFor('direct'));
    const right = await create(gatewayFor('channel'));

    expect(left.campaignId).toBe(right.campaignId);
    expect(left.campaignId).toMatch(/^c[0-9a-f]{24}$/);
  });

  it('carries every published event across the transport [TECH-4.2, TECH-7.2]', async () => {
    const gateway = gatewayFor('channel');

    const created = await create(gateway);
    const changed = await gateway.request('time.set', { paused: false, rate: 1 });

    expect(created.events).toEqual([
      {
        ordinal: 1,
        kind: 'campaign.created',
        simulationTimeMs: 0,
        params: { campaignId: created.campaignId },
      },
    ]);
    expect(changed.ok && changed.data.events).toEqual([
      {
        ordinal: 2,
        kind: 'time.settingChanged',
        simulationTimeMs: 0,
        params: { paused: false, rate: 1 },
      },
    ]);
  });

  it('refuses a malformed create payload before any state changes [TECH-7.1, TECH-7.2]', async () => {
    const gateway = gatewayFor('direct');

    const rejected = await gateway.sendEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'bad-create',
      type: 'campaign.create',
      payload: { displayName: '', seed: SEED, createdAtRealMs: 0 },
    });
    const session = await gateway.request('campaign.session', EMPTY_PAYLOAD);

    expect(rejected.ok).toBe(false);
    expect(session.ok && (session.data as SessionData).campaign).toBeNull();
  });
});
