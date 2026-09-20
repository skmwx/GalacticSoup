import { describe, expect, it } from 'vitest';
import { inventoryService, maximumThatFits, usedVolume, stacksIn, validateCampaign,
  creditWallet, debitWallet, InventoryError, entityIdOf, type CampaignDraft } from '@engine/domain';
import { canonicalJson, type DefinitionId } from '@shared';
import { testDraft } from '../../support/campaign';
import { shippedContent } from '../../support/content';

const content = shippedContent();
const ammo = 'ammo.projectile.small.fusion' as DefinitionId;
function setup() {
  const draft = testDraft();
  const hangar = Object.values(draft.assets.inventories).find((i) => i.location.kind === 'hangar')!.id;
  const cargo = draft.assets.ships[draft.assets.activeShipId]!.cargoInventoryId;
  const service = inventoryService(draft, content);
  const stack = stacksIn(draft.assets, hangar).find((s) => s.definitionId === ammo)!.id;
  return { draft, hangar, cargo, service, stack };
}
function totals(draft: CampaignDraft) {
  const totals: Record<string, number[]> = {};
  for (const stack of Object.values(draft.assets.stacks)) {
    const values = totals[stack.definitionId] ??= [0, 0, 0, 0];
    [stack.quantity, stack.provenance.grantedQuantity, stack.provenance.purchasedQuantity, stack.provenance.purchaseCostCredits]
      .forEach((n, i) => { values[i] = values[i]! + n; });
  }
  return totals;
}
describe('physical inventories', () => {
  it('changes cargo capacity atomically without discarding reserved or stored units [FUNC-6.2, FUNC-22.2, TECH-8.3]', () => {
    const { draft, service, stack, cargo } = setup();
    service.transfer(stack, cargo, 20);
    service.reserve(stack, 5, draft.assets.activeShipId);
    const before = canonicalJson(draft);
    expect(() => service.setCapacity(cargo, 39)).toThrow('insufficientCapacity');
    expect(canonicalJson(draft)).toBe(before);
    service.setCapacity(cargo, 40);
    expect(maximumThatFits(draft.assets, content, cargo, ammo)).toBe(0);
    expect(validateCampaign(draft, content)).toEqual([]);
  });
  it('starts with a wallet, one unfitted ship, unlimited hangar and empty cargo [FUNC-3.1, TECH-8.2, MVP-AC-02]', () => {
    const { draft, hangar, cargo } = setup();
    expect(draft.assets.credits).toBe(20000);
    expect(Object.values(draft.assets.ships)).toHaveLength(1);
    expect(stacksIn(draft.assets, hangar).map((s) => s.quantity).sort((a, b) => a - b)).toEqual([1, 1, 20]);
    expect(stacksIn(draft.assets, cargo)).toEqual([]);
    expect(draft.assets.inventories[hangar]!.capacity).toEqual({ kind: 'unlimited' });
    expect(validateCampaign(draft, content)).toEqual([]);
  });
  it('accepts exactly the quantity that fits in integer volume, and rejects one more atomically [FUNC-4.1, FUNC-6.2, FUNC-22.2]', () => {
    const { draft, service, cargo, hangar } = setup();
    const fit = maximumThatFits(draft.assets, content, cargo, ammo);
    const id = service.add(hangar, ammo, fit + 1, { grantedQuantity: fit + 1, purchasedQuantity: 0, purchaseCostCredits: 0 });
    const before = canonicalJson(draft);
    expect(() => service.transfer(id, cargo, fit + 1)).toThrow('insufficientCapacity');
    expect(canonicalJson(draft)).toBe(before);
    service.transfer(id, cargo, fit);
    expect(maximumThatFits(draft.assets, content, cargo, ammo)).toBe(0);
    expect(usedVolume(draft.assets, content, cargo)).toBe(135000);
    expect(validateCampaign(draft, content)).toEqual([]);
  });
  it('splits rational purchased provenance deterministically and merges it without losing cost [TECH-8.3, FUNC-6.2]', () => {
    const { draft, service, hangar, stack } = setup();
    service.add(hangar, ammo, 3, { grantedQuantity: 0, purchasedQuantity: 3, purchaseCostCredits: 10 });
    const before = totals(draft);
    const split = service.split(stack, 8);
    expect(draft.assets.stacks[split]!.provenance).toEqual({ grantedQuantity: 7, purchasedQuantity: 1, purchaseCostCredits: 3 });
    service.merge(split, stack);
    expect(totals(draft)).toEqual(before);
    expect(draft.assets.stacks[stack]!.quantity).toBe(23);
  });
  it('moves reservations into private locations and keeps their cargo capacity occupied [TECH-8.3, FUNC-22.3]', () => {
    const { draft, service, cargo, stack } = setup();
    service.transfer(stack, cargo, 20);
    const before = totals(draft);
    const reserve = service.reserve(stack, 7, draft.assets.activeShipId);
    expect(stacksIn(draft.assets, cargo)[0]!.quantity).toBe(13);
    expect(stacksIn(draft.assets, reserve)[0]!.quantity).toBe(7);
    expect(usedVolume(draft.assets, content, cargo)).toBe(40);
    expect(maximumThatFits(draft.assets, content, cargo, ammo)).toBe(67480);
    const snapshot = canonicalJson(draft);
    expect(() => service.reserve(stack, 14, draft.assets.activeShipId)).toThrow('insufficientItems');
    expect(() => service.release(reserve, entityIdOf(draft.campaignId, 999))).toThrow('invalidReservation');
    expect(canonicalJson(draft)).toBe(snapshot);
    service.release(reserve, draft.assets.activeShipId);
    expect(totals(draft)).toEqual(before);
    expect(draft.assets.inventories[reserve]).toBeUndefined();
    expect(validateCampaign(draft, content)).toEqual([]);
  });
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid quantities (%s) without any mutation [FUNC-22.2, TECH-8.3]', (quantity) => {
    const { draft, service, cargo, stack } = setup();
    const before = canonicalJson(draft);
    expect(() => service.transfer(stack, cargo, quantity)).toThrow(InventoryError);
    expect(() => service.split(stack, quantity)).toThrow(InventoryError);
    expect(canonicalJson(draft)).toBe(before);
  });
  it('rejects incompatible merges, same-location transfers and overflow atomically [FUNC-6.2, TECH-8.3]', () => {
    const { draft, service, hangar, stack } = setup();
    const module = stacksIn(draft.assets, hangar).find((s) => s.definitionId !== ammo)!;
    const before = canonicalJson(draft);
    expect(() => service.merge(stack, module.id)).toThrow('incompatibleStacks');
    expect(() => service.merge(stack, stack)).toThrow('incompatibleStacks');
    expect(() => service.transfer(stack, hangar, 1)).toThrow('sameInventory');
    expect(() => service.add(hangar, ammo, Number.MAX_SAFE_INTEGER, {
      grantedQuantity: Number.MAX_SAFE_INTEGER, purchasedQuantity: 0, purchaseCostCredits: 0,
    })).toThrow('insufficientCapacity');
    expect(canonicalJson(draft)).toBe(before);
  });
  it('conserves every unit and acquisition credit across generated operation sequences [TECH-15.1, TECH-8.3, FUNC-6.1, FUNC-6.2, FUNC-22.2, FUNC-22.3, MVP-AC-06]', () => {
    // Deterministic property corpus: independent seeds, mixed legal/illegal operations,
    // assertions after every operation. No ambient randomness or additional dependency.
    for (let seed = 1; seed <= 80; seed++) {
      const { draft, service, cargo, hangar } = setup();
      service.add(hangar, ammo, seed * 3, { grantedQuantity: 0, purchasedQuantity: seed * 3, purchaseCostCredits: seed * 17 });
      const expected = totals(draft);
      let random = seed;
      const draw = (max: number) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % max; };
      for (let i = 0; i < 40; i++) {
        const all = Object.values(draft.assets.stacks).filter((s) => s.definitionId === ammo);
        const stack = all[draw(all.length)]!;
        const before = canonicalJson(draft);
        try {
          switch (draw(4)) {
            case 0: service.split(stack.id, draw(stack.quantity + 2)); break;
            case 1: service.transfer(stack.id, draw(2) ? cargo : hangar, draw(stack.quantity + 2)); break;
            case 2: service.merge(stack.id, all[draw(all.length)]!.id); break;
            case 3: {
              const reserved = service.reserve(stack.id, draw(stack.quantity + 2), draft.assets.activeShipId);
              service.release(reserved, draft.assets.activeShipId);
              break;
            }
          }
        } catch (error) {
          expect(error).toBeInstanceOf(InventoryError);
          expect(canonicalJson(draft)).toBe(before);
        }
        expect(totals(draft)).toEqual(expected);
        expect(validateCampaign(draft, content)).toEqual([]);
        expect(new Set(Object.values(draft.assets.stacks).map((s) => s.id)).size).toBe(Object.keys(draft.assets.stacks).length);
      }
    }
  });
});
describe('wallet', () => {
  it('keeps credits whole and non-negative under generated debits and credits [FUNC-4.1, FUNC-6.1, FUNC-22.2, TECH-15.1]', () => {
    const { draft } = setup();
    let expected = draft.assets.credits;
    for (let amount = 0; amount < 1000; amount += 7) {
      creditWallet(draft, amount); expected += amount;
      debitWallet(draft, Math.min(amount + 1, expected)); expected = Math.max(0, expected - amount - 1);
      const before = canonicalJson(draft);
      expect(() => debitWallet(draft, expected + 1)).toThrow('insufficientCredits');
      expect(canonicalJson(draft)).toBe(before);
      expect(draft.assets.credits).toBe(expected);
    }
    for (const amount of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
      const before = canonicalJson(draft);
      expect(() => creditWallet(draft, amount)).toThrow(InventoryError);
      expect(canonicalJson(draft)).toBe(before);
    }
  });
});
