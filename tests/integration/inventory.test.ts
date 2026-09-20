import { afterEach, describe, expect, it } from 'vitest';
import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import { PROTOCOL_VERSION, type AssetsData, type EngineResponse, type RequestType, type RequestPayload, type ResponseData } from '@protocol';
import { shippedContent } from '../support/content';

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); });
function session(kind: 'direct' | 'channel', store: MemorySaveStore) {
  const host = createEngineHost({ content: shippedContent(), saves: store });
  if (kind === 'direct') {
    const gateway = createDirectGateway({ host });
    disposers.push(() => gateway.dispose()); return gateway;
  }
  const channel = createChannelGateway({ host });
  disposers.push(() => channel.close()); return channel.gateway;
}
function data<T>(response: EngineResponse<T>): T {
  if (!response.ok) throw new Error(JSON.stringify(response.error));
  return response.data;
}
async function ask<T extends RequestType>(g: ClientGateway, type: T, payload: RequestPayload<T>): Promise<ResponseData<T>> {
  return data(await g.request(type, payload));
}
const create = (g: ClientGateway) => ask(g, 'campaign.create', {
  displayName: 'Asset Pilot', seed: '0123456789abcdef0123456789abcdef', createdAtRealMs: 100,
});
function ids(assets: AssetsData) {
  const hangar = assets.inventories.find((i) => i.location.kind === 'hangar')!;
  const cargo = assets.inventories.find((i) => i.location.kind === 'cargo')!;
  return { hangar, cargo, ammo: hangar.stacks.find((s) => s.item.kind === 'ammunition')! };
}
describe.each(['direct', 'channel'] as const)('inventory through %s transport', (kind) => {
  it('prepares, inspects, moves and resumes exactly the same owned assets [MVP-AC-02, MVP-AC-06, FUNC-6.1, FUNC-6.2, TECH-11.4]', async () => {
    const store = createMemorySaveStore();
    const gateway = session(kind, store);
    await create(gateway);
    const assets = await ask(gateway, 'assets.list', {});
    const { hangar, cargo, ammo } = ids(assets);
    expect(await ask(gateway, 'wallet.get', {})).toEqual({ revision: 1, credits: 20000 });
    expect(await ask(gateway, 'inventory.hangar', { stationId: assets.location.stationId })).toEqual(hangar);
    expect(await ask(gateway, 'inventory.cargo', { shipId: assets.activeShipId })).toEqual(cargo);
    expect((await ask(gateway, 'item.inspect', { stackId: ammo.id })).stack).toEqual(ammo);
    expect((await ask(gateway, 'inventory.maximum', { stackId: ammo.id, destinationInventoryId: cargo.id })).maximumQuantity).toBe(40);
    const result = await ask(gateway, 'inventory.transfer', { stackId: ammo.id, destinationInventoryId: cargo.id, quantity: 12 });
    expect(result.invalidations).toEqual(['assets', 'inventory']);
    expect(result.events[0]!.kind).toBe('inventory.changed');
    const moved = await ask(gateway, 'assets.list', {});
    expect(moved.inventories.find((i) => i.id === cargo.id)!.stacks[0]!.quantity).toBe(12);
    expect(moved.inventories.find((i) => i.id === hangar.id)!.stacks.find((s) => s.id === ammo.id)!.quantity).toBe(28);
    const hash = await ask(gateway, 'diagnostics.stateHash', {});
    await ask(gateway, 'campaign.close', { savedAtRealMs: 999999999 });
    const reopened = session(kind, store);
    await ask(reopened, 'campaign.resume', {});
    expect(await ask(reopened, 'assets.list', {})).toEqual(moved);
    expect(await ask(reopened, 'diagnostics.stateHash', {})).toEqual(hash);
  });
  it('keeps queries read-only, rejects stale/failed commands atomically and deduplicates transfers [TECH-7.2, TECH-7.3, FUNC-22.2, FUNC-22.3]', async () => {
    const gateway = session(kind, createMemorySaveStore());
    await create(gateway);
    const { cargo, ammo } = ids(await ask(gateway, 'assets.list', {}));
    const hash = await ask(gateway, 'diagnostics.stateHash', {});
    await ask(gateway, 'item.inspect', { stackId: ammo.id });
    await ask(gateway, 'inventory.maximum', { stackId: ammo.id, destinationInventoryId: cargo.id });
    const payload = { stackId: ammo.id, destinationInventoryId: cargo.id, quantity: 7 };
    const stale = await gateway.sendEnvelope({ protocolVersion: PROTOCOL_VERSION, requestId: 'stale-transfer',
      type: 'inventory.transfer', expectedRevision: 0, payload });
    expect(!stale.ok && stale.error.code).toBe('STALE_REVISION');
    const missing = await gateway.request('inventory.transfer', { ...payload, quantity: 41 });
    expect(!missing.ok && missing.error.messageKey).toBe('error.ruleViolation.insufficientItems');
    expect(await ask(gateway, 'diagnostics.stateHash', {})).toEqual(hash);
    const envelope = { protocolVersion: PROTOCOL_VERSION, requestId: 'one-transfer', type: 'inventory.transfer', expectedRevision: 1, payload };
    const first = await gateway.sendEnvelope(envelope);
    expect(first.ok).toBe(true);
    const after = await ask(gateway, 'diagnostics.stateHash', {});
    expect(await gateway.sendEnvelope(envelope)).toEqual(first);
    expect(await ask(gateway, 'diagnostics.stateHash', {})).toEqual(after);
  });
  it('exposes split/merge commands and explains unavailable inventory access [FUNC-6.2, FUNC-22.10, TECH-7.1]', async () => {
    const gateway = session(kind, createMemorySaveStore());
    const closed = await gateway.request('assets.list', {});
    expect(!closed.ok && closed.error.messageKey).toBe('error.ruleViolation.noCampaignOpen');
    await create(gateway);
    const assets = await ask(gateway, 'assets.list', {});
    const { ammo } = ids(assets);
    const split = await ask(gateway, 'inventory.split', { stackId: ammo.id, quantity: 5 });
    const splitId = split.events[0]!.params!['stackId'] as string;
    await ask(gateway, 'inventory.merge', { sourceStackId: splitId, targetStackId: ammo.id });
    const final = await ask(gateway, 'assets.list', {});
    expect({ ...final, revision: 1, inventories: final.inventories.map((i) => ({ ...i, revision: 1 })) }).toEqual(assets);
    const unavailable = await gateway.request('inventory.hangar', { stationId: 'station.missing' });
    expect(!unavailable.ok && unavailable.error.code).toBe('NOT_FOUND');
  });
});
it('replays inventory and time commands to identical hashes across both transports [TECH-9.5, TECH-15.1]', async () => {
  const hashes: unknown[] = [];
  for (const kind of ['direct', 'channel'] as const) {
    const gateway = session(kind, createMemorySaveStore());
    await create(gateway);
    const { ammo, cargo, hangar } = ids(await ask(gateway, 'assets.list', {}));
    await ask(gateway, 'time.set', { paused: false, rate: 1 });
    await ask(gateway, 'time.advance', { elapsedRealMs: 120 });
    const result = await ask(gateway, 'inventory.transfer', { stackId: ammo.id, destinationInventoryId: cargo.id, quantity: 7 });
    await ask(gateway, 'inventory.transfer', { stackId: result.events[0]!.params!['stackId'] as string, destinationInventoryId: hangar.id, quantity: 3 });
    await ask(gateway, 'time.advance', { elapsedRealMs: 75 });
    hashes.push(await ask(gateway, 'diagnostics.stateHash', {}));
  }
  expect(hashes[0]).toEqual(hashes[1]);
});
