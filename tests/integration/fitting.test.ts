import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import type {
  EngineResponse,
  RequestPayload,
  RequestType,
  ResponseData,
} from '@protocol';

import { shippedContent } from '../support/content';

/**
 * Fitting through the whole stack (Technical Specification 15.1).
 *
 * The same flow runs over the in-process host and over a structured-clone
 * message channel, then through a close and reopen, because the transport and
 * the store must not be able to change an outcome.
 */

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => {
    dispose();
  });
});

function session(kind: 'direct' | 'channel', store: MemorySaveStore): ClientGateway {
  const host = createEngineHost({ content: shippedContent(), saves: store });
  if (kind === 'direct') {
    const gateway = createDirectGateway({ host });
    disposers.push(() => {
      gateway.dispose();
    });
    return gateway;
  }
  const channel = createChannelGateway({ host });
  disposers.push(() => {
    channel.close();
  });
  return channel.gateway;
}

function data<T>(response: EngineResponse<T>): T {
  if (!response.ok) {
    throw new Error(JSON.stringify(response.error));
  }
  return response.data;
}

async function ask<T extends RequestType>(
  gateway: ClientGateway,
  type: T,
  payload: RequestPayload<T>,
): Promise<ResponseData<T>> {
  return data(await gateway.request(type, payload));
}

const create = (gateway: ClientGateway) =>
  ask(gateway, 'campaign.create', {
    displayName: 'Fitting Pilot',
    seed: '0123456789abcdef0123456789abcdef',
    createdAtRealMs: 100,
  });

/** The granted rounds are a tuning value, so the test reads them. */
const grantedRounds = shippedContent().rules.economy.startingItems.find(
  (item) => item.definitionId === 'ammo.projectile.small.fusion',
)?.quantity ?? 0;

describe.each(['direct', 'channel'] as const)('fitting through %s transport', (kind) => {
  it('prepares a fit, previews it, commits it and resumes it [MVP-AC-02, FUNC-8.4, FUNC-8.5, TECH-11.4]', async () => {
    const store = createMemorySaveStore();
    const gateway = session(kind, store);
    await create(gateway);

    const assets = await ask(gateway, 'assets.list', {});
    const shipId = assets.activeShipId;
    const before = await ask(gateway, 'ship.get', { shipId });
    expect(before.undockable).toBe(true);
    expect(before.weapons[0]?.loadedRounds).toBe(20);
    expect((await ask(gateway, 'fitting.draft', {})).draft).toBeNull();

    const begun = await ask(gateway, 'fitting.begin', { shipId });
    expect(begun.invalidations).toEqual(['fitting']);
    expect(begun.events.map((event) => event.kind)).toEqual(['fitting.draftOpened']);

    // Unloading the magazine and taking the booster offline is a change the
    // player can make from what they were given.
    await ask(gateway, 'fitting.set', {
      slotKind: 'weapon',
      slotIndex: 0,
      moduleId: 'module.turret.autocannon.small',
      online: true,
    });
    await ask(gateway, 'fitting.set', {
      slotKind: 'system',
      slotIndex: 0,
      moduleId: 'module.shield.booster.small',
      online: false,
    });

    const planned = await ask(gateway, 'fitting.draft', {});
    expect(planned.draft?.changed).toBe(true);
    expect(planned.draft?.committable).toBe(true);
    expect(planned.draft?.missing).toEqual([]);
    expect(planned.draft?.preview?.power.used).toBe(5);
    expect(planned.draft?.preview?.weapons[0]?.ammunitionId).toBeNull();
    // Nothing has moved yet: the ship still carries what it had.
    const unchanged = await ask(gateway, 'ship.get', { shipId });
    expect(unchanged.weapons[0]?.ammunitionId).toBe('ammo.projectile.small.fusion');
    expect(unchanged.power.used).toBe(10);

    const rejected = await gateway.request('fitting.set', {
      slotKind: 'weapon',
      slotIndex: 1,
      moduleId: 'module.shield.booster.small',
      online: true,
    });
    expect(!rejected.ok && rejected.error.messageKey).toBe('fitting.violation.slotKindMismatch');

    const committed = await ask(gateway, 'fitting.commit', {});
    expect(committed.invalidations).toEqual(['assets', 'fitting', 'inventory', 'ship']);
    expect(committed.events.map((event) => event.kind)).toEqual(['fitting.committed']);

    const after = await ask(gateway, 'ship.get', { shipId });
    expect(after.weapons[0]?.ammunitionId).toBeNull();
    expect(after.power.used).toBe(5);
    expect(after.warnings.map((warning) => warning.code)).toContain('noAmmunition');
    expect(after.undockable).toBe(true);
    expect((await ask(gateway, 'fitting.draft', {})).draft).toBeNull();

    // The rounds went back where they came from, undiminished.
    expect(assets.location.kind).toBe('station');
    if (assets.location.kind !== 'station') throw new Error('Campaign did not start docked.');
    const hangar = await ask(gateway, 'inventory.hangar', { stationId: assets.location.stationId });
    expect(
      hangar.stacks.find((stack) => stack.item.definitionId === 'ammo.projectile.small.fusion')
        ?.quantity,
    ).toBe(grantedRounds);

    const hash = await ask(gateway, 'diagnostics.stateHash', {});
    await ask(gateway, 'campaign.close', { savedAtRealMs: 999_999_999 });

    const reopened = session(kind, store);
    await ask(reopened, 'campaign.resume', {});
    expect(await ask(reopened, 'ship.get', { shipId })).toEqual(after);
    expect(await ask(reopened, 'diagnostics.stateHash', {})).toEqual(hash);
  });

  it('keeps an open draft across a close and reopen and can still revert it [FUNC-8.4, FUNC-3.4]', async () => {
    const store = createMemorySaveStore();
    const gateway = session(kind, store);
    await create(gateway);
    const { activeShipId: shipId } = await ask(gateway, 'assets.list', {});

    await ask(gateway, 'fitting.begin', { shipId });
    await ask(gateway, 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
    const planned = await ask(gateway, 'fitting.draft', {});
    await ask(gateway, 'campaign.save', { kind: 'manual', savedAtRealMs: 1 });
    await ask(gateway, 'campaign.close', { savedAtRealMs: 2 });

    const reopened = session(kind, store);
    await ask(reopened, 'campaign.resume', {});
    expect((await ask(reopened, 'fitting.draft', {})).draft?.slots).toEqual(planned.draft?.slots);

    await ask(reopened, 'fitting.revert', {});
    expect((await ask(reopened, 'fitting.draft', {})).draft).toBeNull();
    expect((await ask(reopened, 'ship.get', { shipId })).weapons).toHaveLength(1);
  });

  it('explains an unavailable fitting command rather than failing silently [FUNC-22.10]', async () => {
    const gateway = session(kind, createMemorySaveStore());

    const closed = await gateway.request('fitting.draft', {});
    expect(!closed.ok && closed.error.messageKey).toBe('error.ruleViolation.noCampaignOpen');

    await create(gateway);
    const { activeShipId: shipId } = await ask(gateway, 'assets.list', {});

    const noDraft = await gateway.request('fitting.commit', {});
    expect(!noDraft.ok && noDraft.error.messageKey).toBe('error.ruleViolation.fittingDraftClosed');

    await ask(gateway, 'fitting.begin', { shipId });
    await ask(gateway, 'fitting.set', {
      slotKind: 'weapon',
      slotIndex: 1,
      moduleId: 'module.turret.railgun.small',
      online: true,
    });

    const missing = await gateway.request('fitting.commit', {});
    expect(!missing.ok && missing.error.messageKey).toBe('error.ruleViolation.fittingItemsMissing');
    expect(!missing.ok && missing.error.params?.['definitionId']).toBe(
      'module.turret.railgun.small',
    );
    // The refusal changed nothing, so the draft is still there to correct.
    expect((await ask(gateway, 'fitting.draft', {})).draft?.committable).toBe(false);
    expect((await ask(gateway, 'ship.get', { shipId })).slots.filter((slot) => slot.module !== null))
      .toHaveLength(2);
  });

  it('compares two catalogue entries without touching the campaign [FUNC-19.6, TECH-7.3]', async () => {
    const gateway = session(kind, createMemorySaveStore());
    await create(gateway);
    const before = await ask(gateway, 'diagnostics.stateHash', {});

    const comparison = await ask(gateway, 'item.compare', {
      definitionId: 'module.turret.autocannon.small',
      againstDefinitionId: 'module.turret.railgun.small',
    });

    expect(comparison.comparable).toBe(true);
    expect(comparison.entries.some((entry) => entry.direction === 'better')).toBe(true);
    expect(comparison.entries.some((entry) => entry.direction === 'worse')).toBe(true);
    expect(await ask(gateway, 'diagnostics.stateHash', {})).toEqual(before);

    const unknown = await gateway.request('item.compare', {
      definitionId: 'module.turret.autocannon.small',
      againstDefinitionId: 'module.missing.thing',
    });
    expect(!unknown.ok && unknown.error.code).toBe('NOT_FOUND');
  });
});

it('replays the same fitting commands to identical hashes across both transports [TECH-9.5, TECH-15.1]', async () => {
  const hashes: unknown[] = [];

  for (const kind of ['direct', 'channel'] as const) {
    const gateway = session(kind, createMemorySaveStore());
    await create(gateway);
    const { activeShipId: shipId } = await ask(gateway, 'assets.list', {});

    await ask(gateway, 'fitting.begin', { shipId });
    await ask(gateway, 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
    await ask(gateway, 'fitting.set', {
      slotKind: 'system',
      slotIndex: 0,
      moduleId: 'module.shield.booster.small',
      online: false,
    });
    await ask(gateway, 'fitting.commit', {});
    await ask(gateway, 'time.set', { paused: false, rate: 1 });
    await ask(gateway, 'time.advance', { elapsedRealMs: 120 });

    hashes.push(await ask(gateway, 'diagnostics.stateHash', {}));
  }

  expect(hashes[0]).toEqual(hashes[1]);
});
