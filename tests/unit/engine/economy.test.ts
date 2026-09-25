import { describe, expect, it } from 'vitest';

import { runCommand } from '@engine';
import {
  bulkQuote,
  draftOf,
  listingDefinition,
  resolveEconomyHour,
  unitQuote,
  type CampaignState,
} from '@engine';
import {
  insurancePreview,
  marketBuyPreview,
  previewTokenMatches,
  repairPreview,
  resupplyPreview,
} from '@engine/projections';

import { testCampaign, testSimulation } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';

const content = shippedContent();
const stationId = content.rules.economy.startingStationId;

describe('local market formulas', () => {
  it('calculates scarcity, spread and final whole-credit prices with a trace [FUNC-11.1, FUNC-19.6]', () => {
    const state = testCampaign();
    const definition = listingDefinition(content, stationId, 'module.turret.railgun.small');
    const listing = state.economy.stations[stationId]!.listings[definition.itemId]!;
    const quote = unitQuote(content, definition, listing, 'stationSells');

    expect(quote.scarcity).toBeCloseTo(0.25);
    expect(quote.effectiveSpread).toBe(0.08);
    expect(quote.midPriceCredits).toBe(17_200);
    expect(quote.unitPriceCredits).toBe(18_576);
    expect(quote.trace.operands.map((operand) => operand.key)).toContain('currentStock');
    expect(quote.trace.displayResult).toBe(quote.unitPriceCredits);
  });

  it('keeps fixed recovery goods non-scarce at unlimited stock [FUNC-11.2]', () => {
    const state = testCampaign();
    const definition = listingDefinition(content, stationId, 'ammo.projectile.small.fusion');
    const listing = state.economy.stations[stationId]!.listings[definition.itemId]!;

    expect(unitQuote(content, definition, listing, 'stationSells', 0).unitPriceCredits).toBe(
      unitQuote(content, definition, listing, 'stationSells', 1_000_000).unitPriceCredits,
    );
    expect(bulkQuote(content, definition, listing, 'stationSells', 10_000).remainingStock).toBeNull();
  });

  it('makes bulk totals exactly equal to literal sequential quotes across stock levels [TECH-10.4, TECH-15.1]', () => {
    const state = testCampaign();
    const definition = listingDefinition(content, stationId, 'item.commodity.coolant');
    const stored = state.economy.stations[stationId]!.listings[definition.itemId]!;

    for (const side of ['stationSells', 'stationBuys'] as const) {
      for (const stock of [1, 25, 100, 199, 300]) {
        for (const quantity of [1, 2, 7, 20]) {
          if (side === 'stationSells' && quantity > stock) continue;
          const listing = { ...stored, stock };
          let expected = 0;
          let virtualStock = stock;
          for (let unit = 0; unit < quantity; unit += 1) {
            expected += unitQuote(content, definition, listing, side, virtualStock).unitPriceCredits;
            virtualStock += side === 'stationSells' ? -1 : 1;
          }
          const bulk = bulkQuote(content, definition, listing, side, quantity);
          expect(bulk.totalCredits).toBe(expected);
          expect(bulk.remainingStock).toBe(virtualStock);
        }
      }
    }
  });

  it('accumulates fractional production at hourly scheduler boundaries [FUNC-11.2, TECH-9.2, TECH-10.4]', () => {
    const draft = draftOf(testCampaign());
    const itemId = 'module.turret.railgun.small';
    const before = draft.economy.stations[stationId]!.listings[itemId]!.stock;
    draft.time.simulationTimeMs = 5 * 3_600_000;
    const simulation = testSimulation(draft, content);

    resolveEconomyHour(simulation);

    const listing = draft.economy.stations[stationId]!.listings[itemId]!;
    expect(listing.stock).toBe(before + 1);
    expect(listing.lastProcessedHour).toBe(5);
    expect(listing.version).toBe(2);
    expect(simulation.invalidations).toContain('market');
    expect(draft.scheduler.entries.at(-1)?.dueAtMs).toBe(6 * 3_600_000);
  });
});

describe('station service previews and confirmations', () => {
  it('repairs every layer atomically using the authored price formula [FUNC-10, TECH-7.4]', () => {
    const draft = draftOf(testCampaign());
    const shipId = draft.assets.activeShipId!;
    const ship = draft.assets.ships[shipId]!;
    draft.assets.ships[shipId] = {
      ...ship,
      condition: { ...ship.condition, damage: { shield: 10, armor: 25, hull: 10 } },
    };
    draft.assets.version += 1;
    const preview = repairPreview(draft as CampaignState, content, { shipId });

    expect(preview.available).toBe(true);
    expect(preview.totalCredits).toBeGreaterThan(0);
    expect(preview.traces[0]?.formulaKey).toBe('repair.totalPrice');
    const beforeCredits = draft.assets.credits;
    const result = runCommand({ campaign: draft as CampaignState, content, type: 'repair.confirm',
      payload: { token: preview.token! } });

    expect(result.kind).toBe('committed');
    expect(result.kind === 'committed' && result.campaign!.assets.credits).toBe(beforeCredits - preview.totalCredits);
    expect(result.kind === 'committed' && result.campaign!.assets.ships[shipId]!.condition.damage)
      .toEqual({ shield: 0, armor: 0, hull: 0 });
  });

  it('tops up loaded magazines from owned local ammunition before buying [MVP-AC-02, FUNC-6.1, TECH-8.3]', () => {
    const draft = draftOf(testCampaign());
    const shipId = draft.assets.activeShipId!;
    const ship = draft.assets.ships[shipId]!;
    const charge = Object.values(draft.assets.stacks).find(
      (stack) => stack.inventoryId === ship.fittingInventoryId && stack.state.kind === 'charge',
    )!;
    draft.assets.stacks[charge.id] = {
      ...charge,
      quantity: 5,
      provenance: { grantedQuantity: 5, purchasedQuantity: 0, purchaseCostCredits: 0 },
    };
    draft.assets.version += 1;
    const preview = resupplyPreview(draft as CampaignState, content, { shipId });

    expect(preview.available).toBe(true);
    expect(preview.lines[0]?.roundsFromInventory).toBe(15);
    expect(preview.lines[0]?.roundsPurchased).toBe(0);
    const result = runCommand({ campaign: draft as CampaignState, content, type: 'resupply.confirm',
      payload: { token: preview.token! } });

    expect(result.kind).toBe('committed');
    const final = result.kind === 'committed' ? result.campaign! : draft;
    const loaded = Object.values(final.assets.stacks).find((stack) => stack.id === charge.id)!;
    expect(loaded.quantity).toBe(20);
    expect(loaded.provenance).toEqual({
      grantedQuantity: 20,
      purchasedQuantity: 0,
      purchaseCostCredits: 0,
    });
    expect(result.kind === 'committed' && result.autosaveRequested).toBe(false);
  });

  it('buys only the resupply shortfall and requests an autosave [MVP-AC-02, FUNC-11.3, TECH-10.4]', () => {
    const draft = draftOf(testCampaign());
    const shipId = draft.assets.activeShipId!;
    const ship = draft.assets.ships[shipId]!;
    for (const stack of Object.values(draft.assets.stacks)) {
      if (stack.definitionId === 'ammo.projectile.small.fusion' && stack.state.kind === 'plain') {
        delete draft.assets.stacks[stack.id];
      } else if (stack.inventoryId === ship.fittingInventoryId && stack.state.kind === 'charge') {
        draft.assets.stacks[stack.id] = {
          ...stack,
          quantity: 5,
          provenance: { grantedQuantity: 5, purchasedQuantity: 0, purchaseCostCredits: 0 },
        };
      }
    }
    draft.assets.version += 1;
    const preview = resupplyPreview(draft as CampaignState, content, { shipId });
    expect(preview.lines[0]?.roundsFromInventory).toBe(0);
    expect(preview.lines[0]?.roundsPurchased).toBe(15);

    const result = runCommand({ campaign: draft as CampaignState, content, type: 'resupply.confirm',
      payload: { token: preview.token! } });
    expect(result.kind).toBe('committed');
    expect(result.kind === 'committed' && result.autosaveRequested).toBe(true);
  });

  it('persists enhanced insurance as a one-ship purchase [FUNC-9.12, TECH-7.4, TECH-8.2]', () => {
    const campaign = testCampaign();
    const shipId = campaign.assets.activeShipId!;
    const preview = insurancePreview(campaign, content, { shipId });
    const result = runCommand({ campaign, content, type: 'insurance.confirm', payload: { token: preview.token! } });

    expect(preview.premiumCredits).toBe(1_800);
    expect(result.kind).toBe('committed');
    expect(result.kind === 'committed' && result.campaign!.assets.ships[shipId]!.insurance)
      .toEqual({ coverage: 'enhanced', premiumPaidCredits: 1_800 });
    expect(result.kind === 'committed' && result.autosaveRequested).toBe(false);
  });

  it('buys a hull as a new insured ship with its own inventories [MVP-AC-02, FUNC-9.12, FUNC-11.3]', () => {
    const campaign = testCampaign();
    const preview = marketBuyPreview(campaign, content, {
      stationId,
      itemId: 'hull.independent.starter',
      quantity: 1,
    });
    const result = runCommand({
      campaign,
      content,
      type: 'market.confirmBuy',
      payload: { token: preview.token! },
    });

    expect(preview.available).toBe(true);
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') return;
    const purchased = Object.values(result.campaign!.assets.ships)
      .find((ship) => ship.id !== campaign.assets.activeShipId!)!;
    expect(purchased.hullId).toBe('hull.independent.starter');
    expect(purchased.insurance).toEqual({ coverage: 'basic', premiumPaidCredits: 0 });
    expect(result.campaign!.assets.inventories[purchased.cargoInventoryId]?.location)
      .toEqual({ kind: 'cargo', shipId: purchased.id });
    expect(result.campaign!.assets.inventories[purchased.fittingInventoryId]?.location)
      .toEqual({ kind: 'fitting', shipId: purchased.id });
    expect(result.campaign!.assets.credits).toBe(campaign.assets.credits - preview.totalCredits);
    expect(result.autosaveRequested).toBe(true);
  });

  it('binds previews to relevant versions and values without using revision alone [FUNC-22.4, TECH-7.4]', () => {
    const campaign = testCampaign();
    const payload = { stationId, itemId: 'ammo.projectile.small.fusion', quantity: 2 };
    const original = marketBuyPreview(campaign, content, payload);
    const unrelatedRevision = marketBuyPreview({ ...campaign, revision: campaign.revision + 10 }, content, payload);
    expect(previewTokenMatches(original.token!, unrelatedRevision)).toBe(true);

    const changed = draftOf(campaign);
    changed.assets.version += 1;
    const replacement = marketBuyPreview(changed as CampaignState, content, payload);
    expect(previewTokenMatches(original.token!, replacement)).toBe(false);
  });
});
