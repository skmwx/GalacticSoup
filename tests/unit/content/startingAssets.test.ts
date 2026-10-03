import { describe, expect, it } from 'vitest';
import { createCampaign, validateCampaign } from '@engine';
import { compilePack, editDocument, fixtureRepository, minimalPack } from '../../support/contentFixtures';

describe('starting asset content', () => {
  it('creates only the wallet, hull and items selected by validated content [FUNC-3.1, TECH-6.1, TECH-8.2]', () => {
    const pack = editDocument(minimalPack(), 'rules/economy.json', (document) => {
      const values = document['values'] as Record<string, unknown>;
      values['startingCredits'] = 1234;
      values['startingItems'] = [{ definitionId: 'ammo.test.charge', quantity: 123 }];
      values['startingFit'] = [];
    });
    const content = fixtureRepository(pack);
    const campaign = { ...createCampaign({ displayName: 'Content Pilot', seed: '0123456789abcdef0123456789abcdef', createdAtRealMs: 1, initialRate: 1 }, content), revision: 1 };
    expect(campaign.assets.credits).toBe(1234);
    expect(Object.values(campaign.assets.stacks).map((s) => [s.definitionId, s.quantity])).toEqual([['ammo.test.charge', 123]]);
    expect(campaign.assets.ships[campaign.assets.activeShipId!]!.hullId).toBe('hull.test.starter');
    expect(validateCampaign(campaign, content)).toEqual([]);
  });
  it('puts a granted item in the hold when content says so, and in the hangar otherwise [FUNC-3.1, FUNC-9.4, TECH-8.2]', () => {
    const pack = editDocument(minimalPack(), 'rules/economy.json', (document) => {
      const values = document['values'] as Record<string, unknown>;
      values['startingItems'] = [
        { definitionId: 'ammo.test.charge', quantity: 50, location: 'cargo' },
        { definitionId: 'item.test.salvage', quantity: 3, location: 'hangar' },
        { definitionId: 'module.test.turret', quantity: 1 },
      ];
      values['startingFit'] = [];
    });
    const content = fixtureRepository(pack);
    const campaign = { ...createCampaign({ displayName: 'Content Pilot', seed: '0123456789abcdef0123456789abcdef', createdAtRealMs: 1, initialRate: 1 }, content), revision: 1 };
    const ship = campaign.assets.ships[campaign.assets.activeShipId!]!;
    const where = (definitionId: string) =>
      campaign.assets.inventories[Object.values(campaign.assets.stacks).find((s) => s.definitionId === definitionId)!.inventoryId]!.location.kind;
    expect(Object.values(campaign.assets.stacks).find((s) => s.definitionId === 'ammo.test.charge')?.inventoryId).toBe(ship.cargoInventoryId);
    expect(where('ammo.test.charge')).toBe('cargo');
    expect(where('item.test.salvage')).toBe('hangar');
    expect(where('module.test.turret')).toBe('hangar');
    expect(validateCampaign(campaign, content)).toEqual([]);
  });
  it('rejects starting cargo the starter hull could not carry, and an unknown location [TECH-6.2, FUNC-3.1, FUNC-22.2]', () => {
    // The fixture hull holds 100 cubic metres and a charge takes 0.002.
    const withCargo = (quantity: number, location: string) => compilePack(editDocument(minimalPack(), 'rules/economy.json', (document) => {
      const values = document['values'] as Record<string, unknown>;
      values['startingItems'] = [{ definitionId: 'ammo.test.charge', quantity, location }];
      values['startingFit'] = [];
    }));
    expect(withCargo(50_000, 'cargo').ok).toBe(true);
    const overfull = withCargo(50_001, 'cargo');
    expect(overfull.ok).toBe(false);
    expect(overfull.issues.map((i) => [i.reason, i.path])).toContainEqual(['invalidValue', 'values.startingItems']);
    // The same rounds are no trouble in the hangar, which has no limit.
    expect(withCargo(50_001, 'hangar').ok).toBe(true);
    expect(withCargo(1, 'wreck').ok).toBe(false);
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
