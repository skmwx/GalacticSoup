import { afterEach, describe, expect, it } from 'vitest';

import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';

import { shippedContent } from '../support/content.ts';
import { runReplay, type ReplayScript } from '../support/replay.ts';

/**
 * Deterministic replay (Technical Specification 9.5).
 *
 * The same content, the same starting campaign and the same ordered deltas and
 * commands must reach the same serialised authoritative state - through the
 * in-process gateway and through the production worker dispatcher alike. The
 * checkpoint hashes make a divergence locatable.
 */

const content = shippedContent();
const QUANTUM = content.rules.time.simulationQuantumMs;

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

function directGateway(): ClientGateway {
  const gateway = createDirectGateway({
    host: createEngineHost({ content }),
    defaultTimeoutMs: 10_000,
  });
  disposers.push(() => gateway.dispose());
  return gateway;
}

function channelGateway(): ClientGateway {
  const channel = createChannelGateway({
    host: createEngineHost({ content }),
    defaultTimeoutMs: 10_000,
  });
  disposers.push(() => channel.close());
  return channel.gateway;
}

const SCRIPT: ReplayScript = {
  displayName: 'Replay Pilot',
  seed: '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  createdAtRealMs: 1_700_000_000_000,
  steps: [
    { command: 'time.set', payload: { paused: false, rate: 1 } },
    { advanceMs: QUANTUM },
    { advanceMs: QUANTUM * 2 + 7 },
    { advanceMs: 1 },
    { command: 'time.set', payload: { paused: true, rate: 1 } },
    { advanceMs: 5_000 },
    { command: 'time.set', payload: { paused: false, rate: 1 } },
    { advanceMs: 10_000 },
    { advanceMs: QUANTUM * 3 },
  ],
};

describe('deterministic replay', () => {
  it('reaches the same state twice through the direct gateway [TECH-9.5, TECH-15.1]', async () => {
    const first = await runReplay(directGateway(), SCRIPT);
    const second = await runReplay(directGateway(), SCRIPT);

    expect(first.checkpoints).toEqual(second.checkpoints);
    expect(first.finalHash).toBe(second.finalHash);
    expect(first.finalHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reaches the same state through both transports [TECH-9.5, TECH-15.1, TECH-17]', async () => {
    const direct = await runReplay(directGateway(), SCRIPT);
    const channel = await runReplay(channelGateway(), SCRIPT);

    expect(channel.checkpoints).toEqual(direct.checkpoints);
    expect(channel.finalHash).toBe(direct.finalHash);
  });

  it('records a checkpoint per step and advances the revision with it [TECH-9.5]', async () => {
    const run = await runReplay(directGateway(), SCRIPT);

    expect(run.checkpoints).toHaveLength(SCRIPT.steps.length);
    const revisions = run.checkpoints.map((checkpoint) => checkpoint.revision);
    expect([...revisions].sort((a, b) => a - b)).toEqual(revisions);
    expect(run.finalRevision).toBe(revisions[revisions.length - 1]);
  });

  it('discards the delta delivered while paused [FUNC-3.3, FUNC-22.12]', async () => {
    const run = await runReplay(directGateway(), SCRIPT);
    const beforePause = run.checkpoints[4];
    const afterPause = run.checkpoints[5];

    expect(beforePause).toBeDefined();
    expect(afterPause?.simulationTimeMs).toBe(beforePause?.simulationTimeMs);
    expect(afterPause?.revision).toBe(beforePause?.revision);
  });

  it('caps a single delta rather than replaying it [TECH-9.1, FUNC-22.12]', async () => {
    const cap = content.rules.time.maxFrameDeltaMs;
    const script: ReplayScript = {
      ...SCRIPT,
      steps: [
        { command: 'time.set', payload: { paused: false, rate: 1 } },
        { advanceMs: 3_600_000 },
      ],
    };

    const run = await runReplay(directGateway(), script);

    expect(run.simulationTimeMs).toBe(Math.floor(cap / QUANTUM) * QUANTUM);
  });

  it('diverges when the script diverges [TECH-9.5]', async () => {
    const other: ReplayScript = { ...SCRIPT, steps: [...SCRIPT.steps, { advanceMs: QUANTUM }] };

    const base = await runReplay(directGateway(), SCRIPT);
    const extended = await runReplay(directGateway(), other);

    expect(extended.finalHash).not.toBe(base.finalHash);
  });

  it('depends on the campaign seed [TECH-9.4, TECH-9.5]', async () => {
    const other: ReplayScript = { ...SCRIPT, seed: '00112233445566778899aabbccddeeff' };

    const base = await runReplay(directGateway(), SCRIPT);
    const reseeded = await runReplay(directGateway(), other);

    expect(reseeded.finalHash).not.toBe(base.finalHash);
  });
});
