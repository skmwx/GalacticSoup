import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import { AUTOSAVE_INTERVAL_MS, createCampaignSeed, createCampaignSession } from '@gateway';
import type { ClientGateway } from '@gateway';
import { createDirectGateway } from '@gateway/direct';

import { shippedContent } from '../../support/content.ts';

/**
 * The client half of the session (Functional Specification 3.1, 3.4).
 *
 * The client owns exactly two things the engine cannot have: the entropy a
 * campaign seed is made of, and the wall clock a snapshot is stamped with,
 * including the play timer behind the periodic autosave.
 */

const content = shippedContent();

interface Harness {
  readonly gateway: ClientGateway;
  readonly session: ReturnType<typeof createCampaignSession>;
  readonly clock: { value: number };
  readonly waits: number[];
  dispose(): void;
}

function harness(options: { autosaveIntervalMs?: number } = {}): Harness {
  const gateway = createDirectGateway({
    host: createEngineHost({ content, saves: createMemorySaveStore() }),
    defaultTimeoutMs: 5_000,
  });
  const waits: number[] = [];
  const clock = { value: 1_700_000_000_000 };
  const session = createCampaignSession({
    gateway,
    now: () => clock.value,
    createSeed: () => '0123456789abcdef0123456789abcdef',
    wait: (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
    ...(options.autosaveIntervalMs === undefined
      ? {}
      : { autosaveIntervalMs: options.autosaveIntervalMs }),
  });

  return {
    gateway,
    session,
    clock,
    waits,
    dispose: () => {
      gateway.dispose();
    },
  };
}

describe('campaign seeds', () => {
  it('produces 128 bits of lowercase hexadecimal [TECH-9.4]', () => {
    const seed = createCampaignSeed();

    expect(seed).toMatch(/^[0-9a-f]{32}$/);
    expect(createCampaignSeed()).not.toBe(seed);
  });
});

describe('campaign session', () => {
  it('reports an empty slot before anything is created [MVP-AC-01]', async () => {
    const test = harness();
    await test.session.refresh();

    expect(test.session.state.loading).toBe(false);
    expect(test.session.state.session?.campaign).toBeNull();
    expect(test.session.state.slot?.resumable).toBeNull();

    test.dispose();
  });

  it('creates a campaign and leaves it saved [MVP-AC-01, FUNC-3.1, FUNC-3.4]', async () => {
    const test = harness();
    await test.session.create('Vela Trask');

    const { state } = test.session;
    expect(state.session?.campaign?.displayName).toBe('Vela Trask');
    expect(state.slot?.saveCount).toBe(1);
    expect(state.slot?.status.state).toBe('saved');
    expect(state.slot?.status.lastSavedAtRealMs).toBe(test.clock.value);
    expect(state.error).toBeNull();

    test.dispose();
  });

  it('closes and resumes the same campaign [MVP-AC-01, FUNC-3.4]', async () => {
    const test = harness();
    await test.session.create('Vela Trask');
    const campaignId = test.session.state.session?.campaign?.campaignId;

    await test.session.close();
    expect(test.session.state.session?.campaign).toBeNull();
    expect(test.session.state.slot?.resumable?.campaignId).toBe(campaignId);

    await test.session.resume();
    expect(test.session.state.session?.campaign?.campaignId).toBe(campaignId);

    test.dispose();
  });

  it('resets the campaign and every save of it [FUNC-3.4]', async () => {
    const test = harness();
    await test.session.create('Vela Trask');

    await test.session.reset();

    expect(test.session.state.session?.campaign).toBeNull();
    expect(test.session.state.slot?.saveCount).toBe(0);
    expect(test.session.state.slot?.resumable).toBeNull();

    test.dispose();
  });

  it('reports why a resume was refused [FUNC-22.10]', async () => {
    const test = harness();
    await test.session.resume();

    expect(test.session.state.error?.messageKey).toBe('error.ruleViolation.noResumableSave');

    test.dispose();
  });

  it('stamps a manual save with the wall clock [TECH-11.3]', async () => {
    const test = harness();
    await test.session.create('Vela Trask');

    test.clock.value += 60_000;
    await test.session.save('manual');

    expect(test.session.state.slot?.status.lastSaveKind).toBe('manual');
    expect(test.session.state.slot?.status.lastSavedAtRealMs).toBe(test.clock.value);

    test.dispose();
  });

  it('follows a queued write until it is durable [TECH-11.3, FUNC-3.4]', async () => {
    // Capture is synchronous but the write is not, so `campaign.save` always
    // answers `pending`. The session must keep reading until the write
    // settles rather than leaving the interface saying "saving" forever.
    const test = harness();
    await test.session.create('Vela Trask');
    await test.session.save('manual');

    expect(test.session.state.slot?.status.state).toBe('saved');
    expect(test.session.state.slot?.status.pendingWrites).toBe(0);
    expect(test.waits.length).toBeGreaterThan(0);

    test.dispose();
  });

  it('asks for an autosave once enough play time has passed [FUNC-3.4, TECH-11.3]', async () => {
    const test = harness({ autosaveIntervalMs: 1_000 });
    await test.session.create('Vela Trask');
    const before = test.session.state.slot?.status.lastSavedAtRealMs;

    test.clock.value += 5_000;
    test.session.notePlayTime(600, false);
    test.session.notePlayTime(600, false);
    await test.session.refresh();
    await test.session.refresh();

    expect(test.session.state.slot?.status.lastSavedAtRealMs).toBe(test.clock.value);
    expect(test.session.state.slot?.status.lastSavedAtRealMs).not.toBe(before);

    test.dispose();
  });

  it('never counts paused time towards the autosave interval [FUNC-3.3, TECH-11.3]', async () => {
    const test = harness({ autosaveIntervalMs: 1_000 });
    await test.session.create('Vela Trask');
    const before = test.session.state.slot?.status.lastSavedAtRealMs;

    test.clock.value += 5_000;
    for (let tick = 0; tick < 10; tick += 1) {
      test.session.notePlayTime(600, true);
    }
    await test.session.refresh();

    expect(test.session.state.slot?.status.lastSavedAtRealMs).toBe(before);

    test.dispose();
  });

  it('does not ask for an autosave while no campaign is open [FUNC-3.4]', async () => {
    const test = harness({ autosaveIntervalMs: 1 });
    await test.session.refresh();

    test.session.notePlayTime(10_000, false);
    await test.session.refresh();

    expect(test.session.state.slot?.saveCount).toBe(0);
    expect(test.session.state.error).toBeNull();

    test.dispose();
  });

  it('defaults to a five-minute interval [FUNC-3.4]', () => {
    expect(AUTOSAVE_INTERVAL_MS).toBe(300_000);
  });

  it('publishes every change to its subscribers [TECH-12.1]', async () => {
    const test = harness();
    const seen: number[] = [];
    const unsubscribe = test.session.subscribe((state) => {
      seen.push(state.slot?.saveCount ?? -1);
    });

    await test.session.create('Vela Trask');
    unsubscribe();
    const after = seen.length;
    await test.session.close();

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBe(after);

    test.dispose();
  });
});
