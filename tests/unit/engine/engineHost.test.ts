import { describe, expect, it } from 'vitest';

import { createEngineHost, ENGINE_VERSION } from '@engine';
import {
  EMPTY_PAYLOAD,
  NO_CAMPAIGN_REVISION,
  PROTOCOL_VERSION,
  REQUEST_TYPES,
  UNKNOWN_REQUEST_ID,
  isTransportValue,
  type CapabilitiesData,
  type CommandResultData,
  type FrameData,
  type HealthData,
  type SessionData,
  type StateHashData,
} from '@protocol';

import { shippedContent } from '../../support/content.ts';

const content = shippedContent();

function request(type: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-1',
    type,
    payload: EMPTY_PAYLOAD,
    ...overrides,
  };
}

describe('engine host', () => {
  it('reports its health without a campaign [TECH-7.1]', async () => {
    const response = await createEngineHost({ content }).handle(request('system.health'));

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }
    expect(response.requestId).toBe('req-1');
    expect(response.revision).toBe(NO_CAMPAIGN_REVISION);
    expect(response.data as HealthData).toEqual({
      status: 'ready',
      engineVersion: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it('reports the request types it accepts [TECH-7.1]', async () => {
    const response = await createEngineHost({ content, engineVersion: '9.9.9' }).handle(
      request('system.capabilities'),
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }
    expect(response.data as CapabilitiesData).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      engineVersion: '9.9.9',
      requestTypes: [...REQUEST_TYPES],
    });
  });

  it('answers every request with a transport-safe response [TECH-4.2]', async () => {
    const response = await createEngineHost({ content }).handle(request('system.capabilities'));

    expect(isTransportValue(response)).toBe(true);
  });

  it('returns a stable error instead of throwing on malformed input [TECH-5.4]', async () => {
    const host = createEngineHost({ content });
    const malformed: unknown[] = [
      undefined,
      null,
      'text',
      42,
      [],
      {},
      { requestId: 'req-2' },
      request('campaign.create'),
      request('system.health', { protocolVersion: 2 }),
      request('system.health', { payload: { verbose: true } }),
    ];

    for (const message of malformed) {
      const response = await host.handle(message);

      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.code).toBe('INVALID_REQUEST');
        expect(response.error.messageKey.startsWith('error.invalidRequest')).toBe(true);
        expect(isTransportValue(response)).toBe(true);
      }
    }
  });

  it('correlates a failure that carries no request id with the unknown id [TECH-7.1]', async () => {
    const response = await createEngineHost({ content }).handle('nonsense');

    expect(response.requestId).toBe(UNKNOWN_REQUEST_ID);
  });

  it('never resolves a state-changing revision above zero before campaigns exist [TECH-7.1]', async () => {
    const response = await createEngineHost({ content }).handle(request('system.health'));

    expect(response.ok && response.revision).toBe(NO_CAMPAIGN_REVISION);
  });

  it('publishes a semantic version string [TECH-18]', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('campaign session', () => {
  const seed = '0123456789abcdef0123456789abcdef';

  function create(requestId = 'req-create', overrides: Record<string, unknown> = {}): unknown {
    return request('campaign.create', {
      requestId,
      payload: { displayName: 'Vela', seed, createdAtRealMs: 1_700_000_000_000, ...overrides },
    });
  }

  function advance(requestId: string, elapsedRealMs: number): unknown {
    return request('time.advance', { requestId, payload: { elapsedRealMs } });
  }

  function run(requestId: string): unknown {
    return request('time.set', { requestId, payload: { paused: false, rate: 1 } });
  }

  it('opens a campaign and reports it in the session projection [MVP-AC-01, TECH-7.3, FUNC-19.1]', async () => {
    const host = createEngineHost({ content });
    const created = await host.handle(create());
    const session = await host.handle(request('campaign.session', { requestId: 'req-session' }));

    expect(created.ok).toBe(true);
    expect(session.ok).toBe(true);
    if (!created.ok || !session.ok) {
      return;
    }
    expect(created.revision).toBe(1);
    expect(session.revision).toBe(1);
    const data = session.data as SessionData;
    expect(data.campaign?.displayName).toBe('Vela');
    expect(data.time.paused).toBe(true);
    expect(data.time.availableRates).toEqual([...content.rules.time.timeRates]);
    expect(data.contentHash).toBe(content.contentHash);
  });

  it('reports no campaign before one is created [TECH-7.3]', async () => {
    const response = await createEngineHost({ content }).handle(
      request('campaign.session', { requestId: 'req-session' }),
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect((response.data as SessionData).campaign).toBeNull();
      expect(response.revision).toBe(NO_CAMPAIGN_REVISION);
    }
  });

  it('returns the original result for a duplicated command [TECH-7.2]', async () => {
    const host = createEngineHost({ content });
    await host.handle(create());
    await host.handle(run('req-run'));

    const first = await host.handle(advance('req-advance', 1_000));
    const repeat = await host.handle(advance('req-advance', 1_000));
    const frame = await host.handle(request('campaign.frame', { requestId: 'req-frame' }));

    expect(repeat).toEqual(first);
    expect(first.ok && repeat.ok).toBe(true);
    if (first.ok && frame.ok) {
      expect((frame.data as FrameData).simulationTimeMs).toBe(
        (first.data as CommandResultData).simulationTimeMs,
      );
      expect(frame.revision).toBe(first.revision);
    }
  });

  it('runs a query again rather than replaying a cached answer [TECH-7.3]', async () => {
    const host = createEngineHost({ content });
    const before = await host.handle(request('campaign.session', { requestId: 'req-shared' }));
    await host.handle(create('req-create'));
    const after = await host.handle(request('campaign.session', { requestId: 'req-shared' }));

    expect(before.ok && (before.data as SessionData).campaign).toBeNull();
    expect(after.ok && (after.data as SessionData).campaign).not.toBeNull();
  });

  it('rejects a command that expected another revision [TECH-7.2, TECH-5.4]', async () => {
    const host = createEngineHost({ content });
    await host.handle(create());

    const stale = await host.handle(
      request('time.set', {
        requestId: 'req-stale',
        expectedRevision: 99,
        payload: { paused: false, rate: 1 },
      }),
    );
    const session = await host.handle(request('campaign.session', { requestId: 'req-session' }));

    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('STALE_REVISION');
      expect(stale.error.params).toEqual({ expected: 99, actual: 1 });
    }
    expect(session.ok && session.revision).toBe(1);
    expect(session.ok && (session.data as SessionData).time.paused).toBe(true);
  });

  it('accepts a command that expected the current revision [TECH-7.2]', async () => {
    const host = createEngineHost({ content });
    await host.handle(create());

    const accepted = await host.handle(
      request('time.set', {
        requestId: 'req-current',
        expectedRevision: 1,
        payload: { paused: false, rate: 1 },
      }),
    );

    expect(accepted.ok).toBe(true);
    expect(accepted.ok && accepted.revision).toBe(2);
  });

  it('rejects a request addressed to another campaign [FUNC-22.10]', async () => {
    const host = createEngineHost({ content });
    await host.handle(create());

    const mismatched = await host.handle(
      request('campaign.frame', { requestId: 'req-other', campaignId: 'c000000000000000000000ff' }),
    );

    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.error.messageKey).toBe('error.ruleViolation.campaignMismatch');
    }
  });

  it('advances only while running, and reports the frame [FUNC-3.3, MVP-AC-01]', async () => {
    const host = createEngineHost({ content });
    const quantum = content.rules.time.simulationQuantumMs;
    await host.handle(create());

    const whilePaused = await host.handle(advance('req-paused', quantum * 4));
    await host.handle(run('req-run'));
    const whileRunning = await host.handle(advance('req-running', quantum * 4));

    expect(whilePaused.ok && (whilePaused.data as CommandResultData).committed).toBe(false);
    expect(whilePaused.ok && (whilePaused.data as CommandResultData).simulationTimeMs).toBe(0);
    expect(whileRunning.ok && (whileRunning.data as CommandResultData).simulationTimeMs).toBe(
      quantum * 4,
    );
  });

  it('reports the same state hash for the same command sequence [TECH-9.5]', async () => {
    const hashes: string[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const host = createEngineHost({ content });
      await host.handle(create());
      await host.handle(run('req-run'));
      await host.handle(advance('req-advance', 500));
      const response = await host.handle(
        request('diagnostics.stateHash', { requestId: 'req-hash' }),
      );
      expect(response.ok).toBe(true);
      if (response.ok) {
        hashes.push((response.data as StateHashData).stateHash ?? '');
      }
    }

    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('ends the campaign on reset [MVP-AC-01]', async () => {
    const host = createEngineHost({ content });
    await host.handle(create());
    const reset = await host.handle(request('campaign.reset', { requestId: 'req-reset' }));
    const session = await host.handle(request('campaign.session', { requestId: 'req-session' }));

    expect(reset.ok && reset.revision).toBe(NO_CAMPAIGN_REVISION);
    expect(session.ok && (session.data as SessionData).campaign).toBeNull();
  });
});

describe('duplicate requests after a campaign ends', () => {
  const seed = '0123456789abcdef0123456789abcdef';

  it('forgets results that describe a campaign that no longer exists [TECH-7.2]', async () => {
    const host = createEngineHost({ content });
    const create = (requestId: string): unknown =>
      request('campaign.create', {
        requestId,
        payload: { displayName: 'Vela', seed, createdAtRealMs: 0 },
      });

    await host.handle(create('req-create'));
    const reset = await host.handle(request('campaign.reset', { requestId: 'req-reset' }));
    const repeatedReset = await host.handle(request('campaign.reset', { requestId: 'req-reset' }));

    // The reset itself stays idempotent for a duplicated message...
    expect(repeatedReset).toEqual(reset);

    // ...but the create from the ended campaign is no longer remembered, so
    // reusing its id starts a campaign instead of replaying a stale result.
    const recreated = await host.handle(create('req-create'));
    const session = await host.handle(request('campaign.session', { requestId: 'req-session' }));

    expect(recreated.ok).toBe(true);
    expect(session.ok && (session.data as SessionData).campaign).not.toBeNull();
  });
});
