import { PROTOCOL_VERSION } from '@protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import {
  EMPTY_PAYLOAD,
  isSuccess,
  type CommandResultData,
  type SaveSlotData,
  type SessionData,
  type StateHashData,
} from '@protocol';

import { shippedContent } from '../support/content.ts';

/**
 * Save, close and resume across a real transport
 * (MVP-AC-01; Functional Specification 3.3-3.4; Technical Specification 11).
 *
 * The campaign, its snapshots and the store all live behind the same gateway
 * the interface uses, so a value that cannot cross the boundary, or a resume
 * that does not reproduce what was stored, fails here rather than in a
 * browser.
 */

const content = shippedContent();
const QUANTUM = content.rules.time.simulationQuantumMs;
const SEED = '0123456789abcdef0123456789abcdef';
const CREATED_AT = 1_700_000_000_000;

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

const TRANSPORTS = ['direct', 'channel'] as const;

type TransportName = (typeof TRANSPORTS)[number];

interface Session {
  readonly gateway: ClientGateway;
  readonly store: MemorySaveStore;
}

/**
 * One store, two successive gateways: closing the game and opening it again is
 * exactly a new engine session over the same storage.
 */
function sessionOn(store: MemorySaveStore, name: TransportName): Session {
  const host = createEngineHost({ content, saves: store });
  if (name === 'direct') {
    const gateway = createDirectGateway({ host, defaultTimeoutMs: 5_000 });
    disposers.push(() => gateway.dispose());
    return { gateway, store };
  }
  const channel = createChannelGateway({ host, defaultTimeoutMs: 5_000 });
  disposers.push(() => channel.close());
  return { gateway: channel.gateway, store };
}

function newSession(name: TransportName): Session {
  return sessionOn(createMemorySaveStore(), name);
}

async function ask<TData>(
  gateway: ClientGateway,
  type: Parameters<ClientGateway['request']>[0],
  payload: Parameters<ClientGateway['request']>[1],
): Promise<TData> {
  const response = await gateway.request(type, payload);
  if (!isSuccess(response)) {
    throw new Error(`${String(type)} failed: ${JSON.stringify(response.error)}`);
  }
  return response.data as TData;
}

function create(gateway: ClientGateway): Promise<CommandResultData> {
  return ask(gateway, 'campaign.create', {
    displayName: 'Vela Trask',
    seed: SEED,
    createdAtRealMs: CREATED_AT,
  });
}

function hashOf(gateway: ClientGateway): Promise<StateHashData> {
  return ask(gateway, 'diagnostics.stateHash', EMPTY_PAYLOAD);
}

describe('campaign persistence', () => {
  it.each(TRANSPORTS)(
    'saves a new campaign the moment it is created over the %s gateway [MVP-AC-01, FUNC-3.4]',
    async (name) => {
      const { gateway } = newSession(name);

      const created = await create(gateway);
      // The engine answered the trigger itself, because `campaign.create`
      // supplied the wall clock a snapshot is stamped with.
      expect(created.autosaveRequested).toBe(false);

      const slot = await ask<SaveSlotData>(gateway, 'campaign.saves', EMPTY_PAYLOAD);
      expect(slot.saveCount).toBe(1);
      expect(slot.resumable?.campaignId).toBe(created.campaignId);
      expect(slot.resumable?.revision).toBe(1);
      expect(slot.resumable?.savedAtRealMs).toBe(CREATED_AT);
      expect(slot.resumable?.contentMatches).toBe(true);
      expect(slot.status.state).toBe('saved');
    },
  );

  it.each(TRANSPORTS)(
    'closes and reopens a campaign without losing progress over the %s gateway [MVP-AC-01]',
    async (name) => {
      const store = createMemorySaveStore();
      const first = sessionOn(store, name);

      await create(first.gateway);
      await ask(first.gateway, 'time.set', { paused: false, rate: 1 });
      await ask(first.gateway, 'time.advance', { elapsedRealMs: QUANTUM * 4 });
      const before = await hashOf(first.gateway);
      await ask(first.gateway, 'campaign.close', { savedAtRealMs: CREATED_AT + 60_000 });

      const closed = await ask<SessionData>(first.gateway, 'campaign.session', EMPTY_PAYLOAD);
      expect(closed.campaign).toBeNull();

      // A new engine session over the same storage: the game was reopened.
      const second = sessionOn(store, name);
      const resumed = await ask<CommandResultData>(
        second.gateway,
        'campaign.resume',
        EMPTY_PAYLOAD,
      );
      const after = await hashOf(second.gateway);

      expect(resumed.campaignId).toBe(before.campaignId);
      expect(after.stateHash).toBe(before.stateHash);
      expect(after.revision).toBe(before.revision);
      expect(after.simulationTimeMs).toBe(QUANTUM * 4);
    },
  );

  it('adds no simulation time while the campaign is closed [FUNC-22.12, MVP-AC-01]', async () => {
    const store = createMemorySaveStore();
    const first = sessionOn(store, 'direct');

    await create(first.gateway);
    await ask(first.gateway, 'time.set', { paused: false, rate: 1 });
    await ask(first.gateway, 'time.advance', { elapsedRealMs: QUANTUM * 3 });
    await ask(first.gateway, 'campaign.close', { savedAtRealMs: CREATED_AT + 1_000 });

    // Days of wall clock pass with the game closed.
    const second = sessionOn(store, 'direct');
    await ask(second.gateway, 'campaign.resume', EMPTY_PAYLOAD);
    const after = await hashOf(second.gateway);

    expect(after.simulationTimeMs).toBe(QUANTUM * 3);
  });

  it('adds no simulation time across a suspension [FUNC-22.12, TECH-9.1]', async () => {
    const { gateway } = newSession('direct');
    await create(gateway);
    await ask(gateway, 'time.set', { paused: false, rate: 1 });

    // The tab was suspended: the frame driver resets its baseline, so the
    // first frame back delivers no delta at all.
    const before = await hashOf(gateway);
    await ask(gateway, 'time.advance', { elapsedRealMs: 0 });
    const after = await hashOf(gateway);

    expect(after.simulationTimeMs).toBe(before.simulationTimeMs);
    expect(after.stateHash).toBe(before.stateHash);
  });

  it('caps one oversized real delta rather than replaying it [FUNC-22.12, TECH-9.1]', async () => {
    const { gateway } = newSession('direct');
    await create(gateway);
    await ask(gateway, 'time.set', { paused: false, rate: 1 });

    // A delta the size of a lunch break, as a sleeping tab would report.
    await ask(gateway, 'time.advance', { elapsedRealMs: 3_600_000 });
    const after = await hashOf(gateway);

    expect(after.simulationTimeMs).toBeLessThanOrEqual(
      content.rules.time.maxFrameDeltaMs,
    );
  });

  it('keeps the snapshot at the revision it was closed at [TECH-11.3]', async () => {
    const store = createMemorySaveStore();
    const first = sessionOn(store, 'direct');

    await create(first.gateway);
    await ask(first.gateway, 'time.set', { paused: false, rate: 1 });
    const before = await hashOf(first.gateway);
    await ask(first.gateway, 'campaign.close', { savedAtRealMs: CREATED_AT + 5_000 });

    const slot = await ask<SaveSlotData>(first.gateway, 'campaign.saves', EMPTY_PAYLOAD);
    expect(slot.resumable?.revision).toBe(before.revision);
    expect(slot.resumable?.savedAtRealMs).toBe(CREATED_AT + 5_000);
  });

  it('refuses to resume while a campaign is already open [FUNC-22.10]', async () => {
    const { gateway } = newSession('direct');
    await create(gateway);

    const refused = await gateway.request('campaign.resume', EMPTY_PAYLOAD);

    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error.messageKey).toBe(
      'error.ruleViolation.campaignAlreadyOpen',
    );
  });

  it('refuses to resume when nothing was ever saved [FUNC-22.10]', async () => {
    const { gateway } = newSession('direct');

    const refused = await gateway.request('campaign.resume', EMPTY_PAYLOAD);

    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error.messageKey).toBe(
      'error.ruleViolation.noResumableSave',
    );
  });

  it('discards every snapshot when the campaign is reset [FUNC-3.4]', async () => {
    const store = createMemorySaveStore();
    const first = sessionOn(store, 'direct');

    await create(first.gateway);
    await ask(first.gateway, 'campaign.reset', EMPTY_PAYLOAD);

    const slot = await ask<SaveSlotData>(first.gateway, 'campaign.saves', EMPTY_PAYLOAD);
    expect(slot.saveCount).toBe(0);
    expect(slot.resumable).toBeNull();
    expect(store.saveIds()).toEqual([]);

    const second = sessionOn(store, 'direct');
    const refused = await second.gateway.request('campaign.resume', EMPTY_PAYLOAD);
    expect(refused.ok).toBe(false);
  });

  it('rolls autosaves and keeps the newest resumable [FUNC-3.4, TECH-11.1]', async () => {
    const { gateway, store } = newSession('direct');
    await create(gateway);

    for (let save = 0; save < 8; save += 1) {
      await ask(gateway, 'time.set', { paused: save % 2 === 0, rate: 1 });
      await ask(gateway, 'campaign.save', {
        kind: 'auto',
        savedAtRealMs: CREATED_AT + save * 1_000,
      });
    }

    const slot = await ask<SaveSlotData>(gateway, 'campaign.saves', EMPTY_PAYLOAD);
    const current = await hashOf(gateway);

    expect(slot.saveCount).toBe(5);
    expect(store.saveIds()).toHaveLength(5);
    expect(slot.resumable?.revision).toBe(current.revision);
  });

  it('recovers from a damaged newest snapshot [TECH-11.1, TECH-11.4]', async () => {
    const store = createMemorySaveStore();
    const first = sessionOn(store, 'direct');

    await create(first.gateway);
    await ask(first.gateway, 'time.set', { paused: false, rate: 1 });
    await ask(first.gateway, 'campaign.save', { kind: 'auto', savedAtRealMs: CREATED_AT + 1 });

    const newest = store.saveIds().at(-1) as string;
    store.replace(newest, { format: 'galactic-soup/save', damaged: true });

    const second = sessionOn(store, 'direct');
    const resumed = await ask<CommandResultData>(
      second.gateway,
      'campaign.resume',
      EMPTY_PAYLOAD,
    );

    expect(resumed.revision).toBe(1);
  });

  it('refuses to save while no campaign is open [FUNC-22.10]', async () => {
    const { gateway } = newSession('direct');

    const refused = await gateway.request('campaign.save', {
      kind: 'manual',
      savedAtRealMs: CREATED_AT,
    });

    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error.messageKey).toBe('error.ruleViolation.noCampaignOpen');
  });

  it('answers a repeated save request once [TECH-7.2]', async () => {
    const { gateway, store } = newSession('direct');
    await create(gateway);

    const message = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'save-once',
      type: 'campaign.save',
      payload: { kind: 'manual', savedAtRealMs: CREATED_AT + 10 },
    };
    const first = await gateway.sendEnvelope(message, { correlationId: 'save-once' });
    const again = await gateway.sendEnvelope(message, { correlationId: 'save-once' });

    expect(first).toEqual(again);
    expect(store.saveIds().filter((id) => id.includes(':manual:'))).toHaveLength(1);
  });
});
