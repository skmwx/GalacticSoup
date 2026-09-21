import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import type { CommandResultData, RequestPayload, RequestType, ResponseData } from '@protocol';

import { shippedContent } from '../support/content';

const content = shippedContent();
const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

function gateway(kind: 'direct' | 'channel', store: MemorySaveStore): ClientGateway {
  const host = createEngineHost({ content, saves: store });
  if (kind === 'direct') {
    const direct = createDirectGateway({ host });
    disposers.push(() => direct.dispose());
    return direct;
  }
  const channel = createChannelGateway({ host });
  disposers.push(() => channel.close());
  return channel.gateway;
}

async function ask<T extends RequestType>(
  client: ClientGateway,
  type: T,
  payload: RequestPayload<T>,
): Promise<ResponseData<T>> {
  const response = await client.request(type, payload);
  if (!response.ok) throw new Error(`${type}: ${JSON.stringify(response.error)}`);
  return response.data;
}

async function create(client: ClientGateway): Promise<void> {
  await ask(client, 'campaign.create', {
    displayName: 'Navigator',
    seed: '11223344556677889900aabbccddeeff',
    createdAtRealMs: 100,
  });
}

async function advanceUntil(
  client: ClientGateway,
  predicate: () => Promise<boolean>,
  limit = 160,
): Promise<readonly CommandResultData[]> {
  const results: CommandResultData[] = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await ask(client, 'time.advance', { elapsedRealMs: 250 });
    results.push(result);
    if (await predicate()) return results;
  }
  throw new Error('Navigation state did not reach the expected condition.');
}

describe.each(['direct', 'channel'] as const)('phase 9 navigation through %s transport', (kind) => {
  it('selects, undocks, uses every order, warps, retreats and docks [MVP-AC-03, MVP-AC-08, FUNC-5.2, FUNC-5.3, FUNC-7.1, FUNC-7.2, FUNC-7.3, FUNC-7.4, TECH-10.1, TECH-15.1]', async () => {
    const client = gateway(kind, createMemorySaveStore());
    await create(client);

    const destinations = await ask(client, 'navigation.destinations', {});
    expect(destinations.destinations).toHaveLength(3);
    const scout = destinations.destinations.find((entry) => entry.tier === 1);
    expect(scout).toBeDefined();
    if (scout === undefined) throw new Error('No tier-one destination.');
    await ask(client, 'navigation.selectDestination', { encounterId: scout.encounterId });

    const undocked = await ask(client, 'ship.undock', {});
    expect(undocked.autosaveRequested).toBe(true);
    let site = await ask(client, 'navigation.site', {});
    expect(site.location.kind).toBe('site');
    expect(site.site?.objects.map((object) => object.kind)).toEqual(['ship', 'station']);
    const station = site.site?.objects.find((object) => object.kind === 'station');
    expect(station).toBeDefined();
    if (station === undefined) throw new Error('Station object did not instantiate.');

    await ask(client, 'movement.approach', { targetId: station.id, distanceKm: 1 });
    expect((await ask(client, 'navigation.site', {})).movementOrder?.kind).toBe('approach');
    await ask(client, 'movement.orbit', { targetId: station.id, distanceKm: 2 });
    expect((await ask(client, 'navigation.site', {})).movementOrder?.kind).toBe('orbit');
    await ask(client, 'movement.keepRange', { targetId: station.id, distanceKm: 2 });
    expect((await ask(client, 'navigation.site', {})).movementOrder?.kind).toBe('keepRange');
    await ask(client, 'movement.moveToPoint', { xKm: 4, yKm: 3 });
    expect((await ask(client, 'navigation.site', {})).movementOrder?.kind).toBe('moveToPoint');
    await ask(client, 'movement.stop', {});
    expect((await ask(client, 'navigation.site', {})).movementOrder?.kind).toBe('stop');

    await ask(client, 'navigation.warp', {
      destinationSiteId: scout.siteId,
      arrivalDistanceKm: 30,
    });
    await ask(client, 'time.set', { paused: false, rate: 1 });
    const outbound = await advanceUntil(client, async () => {
      const current = await ask(client, 'navigation.site', {});
      return current.location.kind === 'site' && current.location.siteId === scout.siteId;
    });
    expect(outbound.some((result) => result.autosaveRequested)).toBe(true);
    site = await ask(client, 'navigation.site', {});
    expect(site.site?.siteId).toBe(scout.siteId);
    expect(site.site?.objects).toHaveLength(1);

    await ask(client, 'navigation.retreat', {});
    const inbound = await advanceUntil(client, async () => {
      const current = await ask(client, 'navigation.site', {});
      return current.location.kind === 'site' && current.site?.objects.some((object) => object.kind === 'station') === true;
    });
    expect(inbound.some((result) => result.autosaveRequested)).toBe(true);
    site = await ask(client, 'navigation.site', {});
    const returnedStation = site.site?.objects.find((object) => object.kind === 'station');
    if (returnedStation === undefined) throw new Error('Return station did not instantiate.');
    await ask(client, 'navigation.dock', { stationId: returnedStation.id });
    const docking = await advanceUntil(client, async () => (await ask(client, 'navigation.site', {})).location.kind === 'station');
    expect(docking.some((result) => result.autosaveRequested)).toBe(true);
    expect((await ask(client, 'navigation.site', {})).site).toBeNull();
  });
});

describe('navigation state-machine preconditions and cancellation', () => {
  it('rejects invalid transitions and cancels prepared warp and dock boundaries [FUNC-7.1, FUNC-7.3, FUNC-7.4, FUNC-22.10, FUNC-22.11, TECH-9.2]', async () => {
    const client = gateway('direct', createMemorySaveStore());
    await create(client);
    const destination = (await ask(client, 'navigation.destinations', {})).destinations[0];
    if (destination === undefined) throw new Error('No destination.');

    const dockedWarp = await client.request('navigation.warp', {
      destinationSiteId: destination.siteId,
      arrivalDistanceKm: 0,
    });
    expect(!dockedWarp.ok && dockedWarp.error.messageKey).toBe('error.ruleViolation.warpUnavailable');
    const dockedDock = await client.request('navigation.dock', {
      stationId: content.rules.economy.startingStationId,
    });
    expect(!dockedDock.ok && dockedDock.error.messageKey).toBe('error.ruleViolation.dockUnavailable');

    await ask(client, 'navigation.selectDestination', { encounterId: destination.encounterId });
    await ask(client, 'ship.undock', {});
    const undocked = await ask(client, 'navigation.site', {});
    if (undocked.location.kind !== 'site') throw new Error('Ship did not undock into a site.');
    const station = undocked.site?.objects.find((object) => object.kind === 'station');
    if (station === undefined) throw new Error('Station object did not instantiate.');

    const current = await client.request('navigation.warp', {
      destinationSiteId: undocked.location.siteId,
      arrivalDistanceKm: 0,
    });
    expect(!current.ok && current.error.messageKey).toBe('error.ruleViolation.destinationCurrent');
    const badDistance = await client.request('navigation.warp', {
      destinationSiteId: destination.siteId,
      arrivalDistanceKm: 7,
    });
    expect(!badDistance.ok && badDistance.error.messageKey).toBe('error.ruleViolation.invalidArrivalDistance');
    const missingTarget = await client.request('movement.approach', {
      targetId: 'station.missing',
      distanceKm: 0,
    });
    expect(!missingTarget.ok && missingTarget.error.messageKey).toBe('error.ruleViolation.movementTargetUnavailable');

    await ask(client, 'navigation.warp', {
      destinationSiteId: destination.siteId,
      arrivalDistanceKm: 0,
    });
    await ask(client, 'time.set', { paused: false, rate: 1 });
    await advanceUntil(client, async () =>
      (await ask(client, 'navigation.site', {})).travelStatus?.phase === 'preparing');
    await ask(client, 'movement.stop', {});
    let site = await ask(client, 'navigation.site', {});
    expect(site.travelStatus).toBeNull();
    expect(site.lastCancellation).toMatchObject({ orderKind: 'warp', reason: 'replaced' });
    for (let index = 0; index < 16; index += 1) {
      await ask(client, 'time.advance', { elapsedRealMs: 250 });
    }
    expect((await ask(client, 'navigation.site', {})).location).toEqual(undocked.location);

    await ask(client, 'navigation.dock', { stationId: station.id });
    await advanceUntil(client, async () =>
      (await ask(client, 'navigation.site', {})).travelStatus?.phase === 'preparing');
    await ask(client, 'movement.moveToPoint', { xKm: 4, yKm: 4 });
    site = await ask(client, 'navigation.site', {});
    expect(site.travelStatus).toBeNull();
    expect(site.lastCancellation).toMatchObject({ orderKind: 'dock', reason: 'replaced' });
    for (let index = 0; index < 16; index += 1) {
      await ask(client, 'time.advance', { elapsedRealMs: 250 });
    }
    expect((await ask(client, 'navigation.site', {})).location.kind).toBe('site');
  });
});

describe('navigation persistence', () => {
  it('saves and resumes a stable warp state with the same projection [MVP-AC-03, FUNC-7.3, TECH-9.5, TECH-11.4]', async () => {
    const store = createMemorySaveStore();
    const first = gateway('direct', store);
    await create(first);
    const destination = (await ask(first, 'navigation.destinations', {})).destinations[0];
    if (destination === undefined) throw new Error('No destination.');
    await ask(first, 'navigation.selectDestination', { encounterId: destination.encounterId });
    await ask(first, 'ship.undock', {});
    await ask(first, 'navigation.warp', { destinationSiteId: destination.siteId, arrivalDistanceKm: 10 });
    await ask(first, 'time.set', { paused: false, rate: 1 });
    await advanceUntil(first, async () =>
      (await ask(first, 'navigation.site', {})).location.kind === 'warp');
    await ask(first, 'time.set', { paused: true, rate: 1 });
    const before = await ask(first, 'navigation.site', {});
    expect(before.travelStatus?.kind).toBe('warp');
    expect(before.travelStatus?.phase).toBe('transit');
    expect(before.location.kind).toBe('warp');
    await ask(first, 'campaign.save', { kind: 'manual', savedAtRealMs: 200 });
    await ask(first, 'campaign.close', { savedAtRealMs: 201 });

    const second = gateway('direct', store);
    await ask(second, 'campaign.resume', {});
    expect(await ask(second, 'navigation.site', {})).toEqual(before);
  });
});

it('replays navigation and spatial integration to identical hashes across transports [TECH-9.3, TECH-9.5, TECH-15.1]', async () => {
  const hashes: unknown[] = [];
  for (const kind of ['direct', 'channel'] as const) {
    const client = gateway(kind, createMemorySaveStore());
    await create(client);
    const destination = (await ask(client, 'navigation.destinations', {})).destinations[0];
    if (destination === undefined) throw new Error('No destination.');
    await ask(client, 'navigation.selectDestination', { encounterId: destination.encounterId });
    await ask(client, 'ship.undock', {});
    await ask(client, 'movement.moveToPoint', { xKm: 6, yKm: -3 });
    await ask(client, 'time.set', { paused: false, rate: 1 });
    for (let index = 0; index < 8; index += 1) {
      await ask(client, 'time.advance', { elapsedRealMs: 250 });
    }
    await ask(client, 'navigation.warp', {
      destinationSiteId: destination.siteId,
      arrivalDistanceKm: 30,
    });
    for (let index = 0; index < 160; index += 1) {
      await ask(client, 'time.advance', { elapsedRealMs: 250 });
    }
    hashes.push(await ask(client, 'diagnostics.stateHash', {}));
  }
  expect(hashes[0]).toEqual(hashes[1]);
});

describe('projected command availability', () => {
  /** The availability entry the projection carries for one command. */
  function entry(
    commands: readonly { command: string; available: boolean; unavailableReason: string | null }[],
    command: string,
  ): { available: boolean; unavailableReason: string | null } {
    const found = commands.find((candidate) => candidate.command === command);
    if (found === undefined) throw new Error(`No projected availability for ${command}.`);
    return { available: found.available, unavailableReason: found.unavailableReason };
  }

  it('offers exactly the orders the commands accept, docked and undocked [TECH-12.3, FUNC-7.1, FUNC-22.10, MVP-AC-03]', async () => {
    const client = gateway('direct', createMemorySaveStore());
    await create(client);

    // Docked: the ship may leave and may choose where to go, and nothing else.
    let site = await ask(client, 'navigation.site', {});
    expect(entry(site.commands, 'ship.undock').available).toBe(true);
    expect(entry(site.commands, 'movement.stop')).toEqual({
      available: false,
      unavailableReason: 'error.ruleViolation.movementUnavailable',
    });
    expect(entry(site.commands, 'navigation.retreat')).toEqual({
      available: false,
      unavailableReason: 'error.ruleViolation.retreatUnavailable',
    });
    expect(site.rangePresetsKm).toEqual(content.rules.navigation.rangePresetsKm);
    expect(site.arrivalDistancesKm).toEqual(content.rules.navigation.arrivalDistancesKm);

    const docked = await ask(client, 'navigation.destinations', {});
    const target = docked.destinations.find((candidate) => candidate.tier === 1);
    if (target === undefined) throw new Error('No tier-one destination.');
    expect(entry(target.commands, 'navigation.selectDestination').available).toBe(true);
    expect(entry(target.commands, 'navigation.warp')).toEqual({
      available: false,
      unavailableReason: 'error.ruleViolation.warpUnavailable',
    });

    await ask(client, 'navigation.selectDestination', { encounterId: target.encounterId });
    await ask(client, 'ship.undock', {});

    // Undocked at the station site: orders apply, the station may be docked
    // with, and there is nothing to retreat from.
    site = await ask(client, 'navigation.site', {});
    expect(entry(site.commands, 'ship.undock')).toEqual({
      available: false,
      unavailableReason: 'error.ruleViolation.undockUnavailable',
    });
    expect(entry(site.commands, 'movement.moveToPoint').available).toBe(true);
    expect(entry(site.commands, 'navigation.retreat').available).toBe(false);

    const station = site.site?.objects.find((object) => object.kind === 'station');
    const player = site.site?.objects.find((object) => object.player);
    if (station === undefined || player === undefined) throw new Error('Site did not instantiate.');
    expect(entry(station.commands, 'movement.approach').available).toBe(true);
    expect(entry(station.commands, 'navigation.dock').available).toBe(true);
    expect(entry(player.commands, 'movement.orbit')).toEqual({
      available: false,
      unavailableReason: 'error.ruleViolation.movementTargetUnavailable',
    });
    expect(entry(player.commands, 'navigation.dock').available).toBe(false);

    const undocked = await ask(client, 'navigation.destinations', {});
    const reachable = undocked.destinations.find((candidate) => candidate.siteId === target.siteId);
    expect(entry(reachable?.commands ?? [], 'navigation.warp').available).toBe(true);
    expect(entry(reachable?.commands ?? [], 'navigation.selectDestination')).toEqual({
      available: false,
      unavailableReason: 'error.ruleViolation.destinationSelectionUnavailable',
    });
  });

  it('refuses a projected-unavailable command with the reason it projected [TECH-12.3, FUNC-22.10]', async () => {
    const client = gateway('direct', createMemorySaveStore());
    await create(client);

    // Docked, so every flight order is refused; each refusal must match the
    // reason the command bar was told to show.
    const site = await ask(client, 'navigation.site', {});
    const stop = entry(site.commands, 'movement.stop');
    const refusedStop = await client.request('movement.stop', {});
    expect(!refusedStop.ok && refusedStop.error.messageKey).toBe(stop.unavailableReason);

    const retreat = entry(site.commands, 'navigation.retreat');
    const refusedRetreat = await client.request('navigation.retreat', {});
    expect(!refusedRetreat.ok && refusedRetreat.error.messageKey).toBe(retreat.unavailableReason);

    const destinations = await ask(client, 'navigation.destinations', {});
    const destination = destinations.destinations[0];
    if (destination === undefined) throw new Error('No destination.');
    const warp = entry(destination.commands, 'navigation.warp');
    const refusedWarp = await client.request('navigation.warp', {
      destinationSiteId: destination.siteId,
      arrivalDistanceKm: 0,
    });
    expect(!refusedWarp.ok && refusedWarp.error.messageKey).toBe(warp.unavailableReason);
  });

  it('offers retreat once the ship is in an encounter site [MVP-AC-08, FUNC-9.11]', async () => {
    const client = gateway('direct', createMemorySaveStore());
    await create(client);
    const destinations = await ask(client, 'navigation.destinations', {});
    const destination = destinations.destinations[0];
    if (destination === undefined) throw new Error('No destination.');
    await ask(client, 'navigation.selectDestination', { encounterId: destination.encounterId });
    await ask(client, 'ship.undock', {});
    await ask(client, 'navigation.warp', {
      destinationSiteId: destination.siteId,
      arrivalDistanceKm: 30,
    });
    await ask(client, 'time.set', { paused: false, rate: 1 });
    await advanceUntil(client, async () => {
      const current = await ask(client, 'navigation.site', {});
      return current.location.kind === 'site' && current.location.siteId === destination.siteId;
    });

    const site = await ask(client, 'navigation.site', {});
    expect(entry(site.commands, 'navigation.retreat').available).toBe(true);
    expect(site.site?.objects.every((object) => object.player)).toBe(true);
  });
});
