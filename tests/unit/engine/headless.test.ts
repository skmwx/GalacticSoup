import { describe, expect, it } from 'vitest';

import { EMPTY_PAYLOAD, PROTOCOL_VERSION } from '@protocol';

/**
 * The engine must import and run with no DOM, no browser storage and no
 * rendering environment present (Technical Specification 2, 4.1, 16). This test
 * runs in the plain Node environment, so a stray browser dependency fails it at
 * import time rather than in a browser later.
 */
describe('headless engine', () => {
  it('has no DOM or browser storage available to it [TECH-2]', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
    expect(typeof indexedDB).toBe('undefined');
  });

  it('imports and answers a request in that environment [TECH-2, TECH-4.1]', async () => {
    const { createEngineHost } = await import('@engine');
    const { shippedContent } = await import('../../support/content.ts');

    const response = await createEngineHost({ content: shippedContent() }).handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'headless-1',
      type: 'system.health',
      payload: EMPTY_PAYLOAD,
    });

    expect(response.ok).toBe(true);
  });
});

describe('deterministic engine', () => {
  it('runs a whole campaign session without a wall clock [TECH-2, TECH-9.1, FUNC-22.12]', async () => {
    const { createEngineHost } = await import('@engine');
    const { shippedContent } = await import('../../support/content.ts');

    const content = shippedContent();
    const host = createEngineHost({ content });
    const ask = (requestId: string, type: string, payload: unknown): Promise<unknown> =>
      host.handle({ protocolVersion: PROTOCOL_VERSION, requestId, type, payload });

    await ask('h-create', 'campaign.create', {
      displayName: 'Headless',
      seed: '0123456789abcdef0123456789abcdef',
      createdAtRealMs: 0,
    });
    await ask('h-run', 'time.set', { paused: false, rate: 1 });
    await ask('h-advance', 'time.advance', { elapsedRealMs: 200 });
    const frame = (await ask('h-frame', 'campaign.frame', EMPTY_PAYLOAD)) as {
      ok: boolean;
      data: { simulationTimeMs: number };
    };

    // Simulation time came only from the supplied delta, never from a clock.
    expect(frame.ok).toBe(true);
    expect(frame.data.simulationTimeMs).toBe(
      Math.floor(200 / content.rules.time.simulationQuantumMs) *
        content.rules.time.simulationQuantumMs,
    );
  });
});
