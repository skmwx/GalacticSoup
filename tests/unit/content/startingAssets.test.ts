import { describe, expect, it } from 'vitest';
import { createCampaign, validateCampaign } from '@engine';
import { compilePack, editDocument, fixtureRepository, minimalPack } from '../../support/contentFixtures';

describe('starting asset content', () => {
  it('creates only the wallet, hull and items selected by validated content [FUNC-3.1, TECH-6.1, TECH-8.2]', () => {
    const pack = editDocument(minimalPack(), 'rules/economy.json', (document) => {
      const values = document['values'] as Record<string, unknown>;
      values['startingCredits'] = 1234;
      values['startingItems'] = [{ definitionId: 'ammo.test.charge', quantity: 123 }];
    });
    const content = fixtureRepository(pack);
    const campaign = { ...createCampaign({ displayName: 'Content Pilot', seed: '0123456789abcdef0123456789abcdef', createdAtRealMs: 1, initialRate: 1 }, content), revision: 1 };
    expect(campaign.assets.credits).toBe(1234);
    expect(Object.values(campaign.assets.stacks).map((s) => [s.definitionId, s.quantity])).toEqual([['ammo.test.charge', 123]]);
    expect(campaign.assets.ships[campaign.assets.activeShipId]!.hullId).toBe('hull.test.starter');
    expect(validateCampaign(campaign, content)).toEqual([]);
  });
  it.each([
    ['startingCredits', -1], ['startingCredits', 0.5], ['startingCredits', Number.MAX_SAFE_INTEGER + 1],
    ['startingStationId', 'station.missing'], ['starterHullId', 'hull.missing'],
    ['startingItems', [{ definitionId: 'item.missing', quantity: 1 }]],
    ['startingItems', [{ definitionId: 'ammo.test.charge', quantity: 0 }]],
    ['startingItems', [{ definitionId: 'ammo.test.charge', quantity: Number.MAX_SAFE_INTEGER }]],
    ['startingItems', [{ definitionId: 'ammo.test.charge', quantity: 1 }, { definitionId: 'ammo.test.charge', quantity: 2 }]],
  ])('rejects invalid %s before campaign creation [TECH-6.2, FUNC-3.1]', (field, value) => {
    const pack = editDocument(minimalPack(), 'rules/economy.json', (document) => {
      (document['values'] as Record<string, unknown>)[field as string] = value;
    });
    const result = compilePack(pack);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.file.endsWith('rules/economy.json') && i.path.includes(field as string))).toBe(true);
  });
});
