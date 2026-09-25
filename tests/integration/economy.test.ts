import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import {
  PROTOCOL_VERSION,
  type EngineResponse,
  type MarketTransactionPreviewData,
  type RequestPayload,
  type RequestType,
  type ResponseData,
} from '@protocol';

import { shippedContent } from '../support/content.ts';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function session(kind: 'direct' | 'channel', store: MemorySaveStore): ClientGateway {
  const host = createEngineHost({ content: shippedContent(), saves: store });
  if (kind === 'direct') {
    const gateway = createDirectGateway({ host });
    disposers.push(() => gateway.dispose());
    return gateway;
  }
  const channel = createChannelGateway({ host });
  disposers.push(() => channel.close());
  return channel.gateway;
}

function data<T>(response: EngineResponse<T>): T {
  if (!response.ok) throw new Error(JSON.stringify(response.error));
  return response.data;
}

async function ask<T extends RequestType>(
  gateway: ClientGateway,
  type: T,
  payload: RequestPayload<T>,
): Promise<ResponseData<T>> {
  return data(await gateway.request(type, payload));
}

async function create(gateway: ClientGateway): Promise<void> {
  await ask(gateway, 'campaign.create', {
    displayName: 'Market Pilot',
    seed: '0123456789abcdef0123456789abcdef',
    createdAtRealMs: 100,
  });
}

describe.each(['direct', 'channel'] as const)('station economy through %s transport', (kind) => {
  it('buys, deduplicates, rejects stale confirmation, sells and resumes the same economy [MVP-AC-02, MVP-AC-06, FUNC-11.1, FUNC-11.3, TECH-7.4, TECH-11.4]', async () => {
    const store = createMemorySaveStore();
    const gateway = session(kind, store);
    await create(gateway);
    const stationId = 'station.borrell.harbour';

    const services = await ask(gateway, 'station.services', { stationId });
    expect(services.services.every((service) => service.available)).toBe(true);
    const beforeListings = await ask(gateway, 'market.listings', { stationId });
    const itemId = 'ammo.projectile.small.phased';
    const beforeListing = beforeListings.listings.find((listing) => listing.item.definitionId === itemId)!;
    const walletBefore = await ask(gateway, 'wallet.get', {});

    const preview = await ask(gateway, 'market.previewBuy', { stationId, itemId, quantity: 5 });
    expect(preview.available).toBe(true);
    expect(preview.token?.relevantVersions).toHaveProperty(`listing:${stationId}:${itemId}`);
    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: `buy-${kind}`,
      type: 'market.confirmBuy' as const,
      expectedRevision: 1,
      payload: { token: preview.token! },
    };
    const first = await gateway.sendEnvelope(envelope);
    expect(first.ok).toBe(true);
    expect(first.ok && (first.data as { autosaveRequested: boolean }).autosaveRequested).toBe(true);
    expect(await gateway.sendEnvelope(envelope)).toEqual(first);

    const walletAfterBuy = await ask(gateway, 'wallet.get', {});
    expect(walletAfterBuy.credits).toBe(walletBefore.credits - preview.totalCredits);
    const afterBuyListings = await ask(gateway, 'market.listings', { stationId });
    expect(afterBuyListings.listings.find((listing) => listing.item.definitionId === itemId)?.stock)
      .toBe((beforeListing.stock as number) - 5);

    const staleCandidate = await ask(gateway, 'market.previewBuy', { stationId, itemId, quantity: 2 });
    const assets = await ask(gateway, 'assets.list', {});
    const hangar = assets.inventories.find((inventory) => inventory.location.kind === 'hangar')!;
    const splittable = hangar.stacks.find((stack) => stack.quantity > 1)!;
    await ask(gateway, 'inventory.split', { stackId: splittable.id, quantity: 1 });
    const stale = await gateway.request('market.confirmBuy', { token: staleCandidate.token! });
    expect(stale.ok).toBe(false);
    expect(!stale.ok && stale.error.code).toBe('STALE_PREVIEW');
    expect(!stale.ok && stale.error.replacementPreview?.action).toBe('market.buy');
    expect(!stale.ok && stale.error.replacementPreview?.token).not.toBeNull();

    const owned = await ask(gateway, 'assets.list', {});
    const purchasedStacks = owned.inventories
      .find((inventory) => inventory.location.kind === 'hangar')!
      .stacks.filter((stack) => stack.item.definitionId === itemId);
    expect(purchasedStacks.reduce((sum, stack) => sum + stack.provenance.grantedQuantity, 0)).toBe(0);
    expect(purchasedStacks.reduce((sum, stack) => sum + stack.provenance.purchasedQuantity, 0)).toBe(5);
    expect(purchasedStacks.reduce((sum, stack) => sum + stack.provenance.purchaseCostCredits, 0)).toBe(preview.totalCredits);
    const purchased = purchasedStacks.find((stack) => stack.quantity >= 2)!;
    expect(purchased.provenance).toEqual({
      grantedQuantity: 0,
      purchasedQuantity: purchased.quantity,
      purchaseCostCredits: preview.totalCredits - 15,
    });

    const sell = await ask(gateway, 'market.previewSell', { stationId, stackId: purchased.id, quantity: 2 });
    const sellResult = await ask(gateway, 'market.confirmSell', { token: sell.token! });
    expect(sellResult.autosaveRequested).toBe(true);
    const walletAfterSell = await ask(gateway, 'wallet.get', {});
    expect(walletAfterSell.credits).toBe(walletAfterBuy.credits + sell.totalCredits);

    const shipId = (await ask(gateway, 'assets.list', {})).activeShipId!;
    const insurance = await ask(gateway, 'insurance.preview', { shipId });
    await ask(gateway, 'insurance.confirm', { token: insurance.token! });
    const insuranceBeforeSave = await ask(gateway, 'insurance.preview', { shipId });
    expect(insuranceBeforeSave.currentCoverage).toBe('enhanced');

    const quoteBeforeSave = await ask(gateway, 'market.listings', { stationId });
    const assetsBeforeSave = await ask(gateway, 'assets.list', {});
    await ask(gateway, 'campaign.save', { kind: 'manual', savedAtRealMs: 500 });
    await ask(gateway, 'campaign.close', { savedAtRealMs: 501 });
    const reopened = session(kind, store);
    await ask(reopened, 'campaign.resume', {});
    expect(await ask(reopened, 'market.listings', { stationId })).toEqual(quoteBeforeSave);
    expect(await ask(reopened, 'assets.list', {})).toEqual(assetsBeforeSave);
    expect(await ask(reopened, 'insurance.preview', { shipId })).toEqual(insuranceBeforeSave);
  });

  it('returns an unavailable capacity preview without mutating credits or stock [FUNC-22.2, FUNC-22.10]', async () => {
    const gateway = session(kind, createMemorySaveStore());
    await create(gateway);
    const assets = await ask(gateway, 'assets.list', {});
    const cargo = assets.inventories.find((inventory) => inventory.location.kind === 'cargo')!;
    expect(assets.location.kind).toBe('station');
    if (assets.location.kind !== 'station') throw new Error('Campaign did not start docked.');
    const stationId = assets.location.stationId;
    const before = await ask(gateway, 'diagnostics.stateHash', {});
    const preview: MarketTransactionPreviewData = await ask(gateway, 'market.previewBuy', {
      stationId,
      itemId: 'module.turret.autocannon.small',
      quantity: 30_000,
      destinationInventoryId: cargo.id,
    });

    expect(preview.available).toBe(false);
    expect(preview.unavailableReason).toBe('market.unavailable.insufficientCapacity');
    expect(preview.token).toBeNull();
    expect(await ask(gateway, 'diagnostics.stateHash', {})).toEqual(before);
  });
});
