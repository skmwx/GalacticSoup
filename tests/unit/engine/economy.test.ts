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

import type { StationId } from '@shared';

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
  it.each(['repair', 'purchase'] as const)('confirms a %s after one second of natural regeneration [FUNC-10, TECH-7.4]', (action) => {
    const draft = draftOf(testCampaign());
    const shipId = draft.assets.activeShipId!;
    const ship = draft.assets.ships[shipId]!;
    // An older save can resume docked with partially depleted pools.
    ship.condition.damage = { shield: 100, armor: 10, hull: 5 };
    ship.condition.capacitorCharge = 15;
    draft.time.paused = false;
    let state = draft as CampaignState;
    const preview = action === 'repair'
      ? repairPreview(state, content, { shipId })
      : marketBuyPreview(state, content, { stationId, itemId: 'ammo.projectile.small.fusion', quantity: 1 });
    expect(preview.token).not.toBeNull();
    const versionBefore = state.assets.version;
    for (let step = 0; step < 4; step += 1) {
      const advanced = runCommand({ campaign: state, content, type: 'time.advance', payload: { elapsedRealMs: 250 } });
      expect(advanced.kind).toBe('committed');
      if (advanced.kind !== 'committed' || advanced.campaign === null) throw new Error('Time did not advance.');
      state = advanced.campaign;
    }
    expect(state.assets.ships[shipId]!.condition.damage.shield).toBeLessThan(100);
    expect(state.assets.ships[shipId]!.condition.capacitorCharge).toBeGreaterThan(15);
    expect(state.assets.version).toBe(versionBefore);
    const result = runCommand({ campaign: state, content,
      type: action === 'repair' ? 'repair.confirm' : 'market.confirmBuy', payload: { token: preview.token! } });
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error('Confirmation failed.');
    expect(result.campaign!.assets.credits).toBe(state.assets.credits - preview.totalCredits);
  });

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

  it('recharges the capacitor with the free shield repair [FUNC-10, FUNC-9.8, TECH-7.4]', () => {
    const draft = draftOf(testCampaign());
    const shipId = draft.assets.activeShipId!;
    const ship = draft.assets.ships[shipId]!;
    const capacity = ship.condition.capacitorCharge;
    draft.assets.ships[shipId] = {
      ...ship,
      condition: { damage: { shield: 40, armor: 0, hull: 0 }, capacitorCharge: 15 },
    };
    draft.assets.version += 1;
    const preview = repairPreview(draft as CampaignState, content, { shipId });

    // Shield and capacitor cost nothing; the confirmation still states it.
    expect(preview.available).toBe(true);
    expect(preview.totalCredits).toBe(0);
    expect(preview.walletDeltaCredits).toBe(0);
    expect(preview).toMatchObject({ capacitorCharge: 15, capacitorCapacity: capacity });
    const result = runCommand({ campaign: draft as CampaignState, content, type: 'repair.confirm',
      payload: { token: preview.token! } });

    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') return;
    expect(result.campaign!.assets.credits).toBe(draft.assets.credits);
    expect(result.campaign!.assets.ships[shipId]!.condition).toEqual({
      damage: { shield: 0, armor: 0, hull: 0 },
      capacitorCharge: capacity,
    });
  });

  it('offers the repair for a drained capacitor alone, and for nothing at all refuses [FUNC-10, FUNC-22.10]', () => {
    const start = testCampaign();
    const shipId = start.assets.activeShipId!;
    // A new ship is whole and charged: there is nothing to restore.
    const whole = repairPreview(start, content, { shipId });
    expect(whole.available).toBe(false);
    expect(whole.unavailableReason).toBe('repair.unavailable.nothingToRestore');
    expect(whole.token).toBeNull();

    const draft = draftOf(start);
    draft.assets.ships[shipId]!.condition.capacitorCharge = 0;
    draft.assets.version += 1;
    const drained = repairPreview(draft as CampaignState, content, { shipId });
    expect(drained.available).toBe(true);
    expect(drained.totalCredits).toBe(0);

    const result = runCommand({ campaign: draft as CampaignState, content, type: 'repair.confirm',
      payload: { token: drained.token! } });
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') return;
    expect(result.campaign!.assets.ships[shipId]!.condition.capacitorCharge).toBe(whole.capacitorCapacity);
    expect(result.data.events.map((event) => event.kind)).toContain('repair.completed');
    // Done once, it has nothing left to do.
    expect(repairPreview(result.campaign!, content, { shipId }).available).toBe(false);
  });

  it('repairs armour only, hull only, or both, pricing each scope with one rounding [FUNC-10, TECH-7.4]', () => {
    const draft = draftOf(testCampaign());
    const shipId = draft.assets.activeShipId!;
    const ship = draft.assets.ships[shipId]!;
    draft.assets.ships[shipId] = {
      ...ship,
      condition: { damage: { shield: 10, armor: 25, hull: 10 }, capacitorCharge: 1 },
    };
    draft.assets.version += 1;
    const state = draft as CampaignState;
    const rules = content.rules.economy;
    const hull = content.requireHull(ship.hullId);
    const station = content.requireStation(stationId as StationId);
    const armor = repairPreview(state, content, { shipId, scope: 'armor' });
    const hullOnly = repairPreview(state, content, { shipId, scope: 'hull' });
    const all = repairPreview(state, content, { shipId, scope: 'all' });
    const unscoped = repairPreview(state, content, { shipId });

    const factor = hull.referenceValueCredits * station.serviceModifier;
    expect(armor.scope).toBe('armor');
    expect(armor.totalCredits).toBe(Math.ceil(factor * rules.repairArmorFraction * armor.missingArmorFraction));
    expect(hullOnly.totalCredits).toBe(Math.ceil(factor * rules.repairHullFraction * hullOnly.missingHullFraction));
    expect(all.totalCredits).toBe(Math.ceil(factor * (
      rules.repairArmorFraction * all.missingArmorFraction + rules.repairHullFraction * all.missingHullFraction)));
    expect(armor.totalCredits).toBeGreaterThan(0);
    expect(hullOnly.totalCredits).toBeGreaterThan(0);
    // An omitted scope is the whole repair, priced the same way.
    expect(unscoped.scope).toBe('all');
    expect(unscoped.totalCredits).toBe(all.totalCredits);
    // Each trace names only the layers it prices.
    expect(armor.traces[0]?.formulaKey).toBe('repair.armorPrice');
    expect(armor.traces[0]?.operands.map((operand) => operand.key)).not.toContain('missingHullFraction');
    expect(hullOnly.traces[0]?.formulaKey).toBe('repair.hullPrice');
    expect(hullOnly.traces[0]?.operands.map((operand) => operand.key)).not.toContain('missingArmorFraction');

    const capacity = armor.capacitorCapacity;
    const confirm = (preview: typeof armor) =>
      runCommand({ campaign: state, content, type: 'repair.confirm', payload: { token: preview.token! } });

    const armorResult = confirm(armor);
    expect(armorResult.kind).toBe('committed');
    if (armorResult.kind !== 'committed') return;
    expect(armorResult.campaign!.assets.credits).toBe(draft.assets.credits - armor.totalCredits);
    // Armour only: the hull stays damaged; shield and capacitor come free.
    expect(armorResult.campaign!.assets.ships[shipId]!.condition).toEqual({
      damage: { shield: 0, armor: 0, hull: 10 }, capacitorCharge: capacity,
    });

    const hullResult = confirm(hullOnly);
    expect(hullResult.kind).toBe('committed');
    if (hullResult.kind !== 'committed') return;
    expect(hullResult.campaign!.assets.credits).toBe(draft.assets.credits - hullOnly.totalCredits);
    expect(hullResult.campaign!.assets.ships[shipId]!.condition).toEqual({
      damage: { shield: 0, armor: 25, hull: 0 }, capacitorCharge: capacity,
    });

    const allResult = confirm(all);
    expect(allResult.kind).toBe('committed');
    if (allResult.kind !== 'committed') return;
    expect(allResult.campaign!.assets.credits).toBe(draft.assets.credits - all.totalCredits);
    expect(allResult.campaign!.assets.ships[shipId]!.condition).toEqual({
      damage: { shield: 0, armor: 0, hull: 0 }, capacitorCharge: capacity,
    });

    // After an armour repair the hull price is unchanged, and the armour
    // scope has nothing left to repair.
    const after = armorResult.campaign!;
    expect(repairPreview(after, content, { shipId, scope: 'hull' }).totalCredits).toBe(hullOnly.totalCredits);
    const nothing = repairPreview(after, content, { shipId, scope: 'armor' });
    expect(nothing.available).toBe(false);
    expect(nothing.unavailableReason).toBe('repair.unavailable.noArmorDamage');
    expect(nothing.token).toBeNull();
  });

  it('refuses a stale or unaffordable scoped repair and never charges twice [FUNC-10, TECH-7.4]', () => {
    const draft = draftOf(testCampaign());
    const shipId = draft.assets.activeShipId!;
    const ship = draft.assets.ships[shipId]!;
    draft.assets.ships[shipId] = {
      ...ship,
      condition: { ...ship.condition, damage: { shield: 0, armor: 30, hull: 20 } },
    };
    draft.assets.version += 1;
    const state = draft as CampaignState;
    const armor = repairPreview(state, content, { shipId, scope: 'armor' });

    // More armour damage after the preview: the old price is refused with the
    // replacement, and nothing is charged.
    const worse = draftOf(state);
    const worn = worse.assets.ships[shipId]!;
    worse.assets.ships[shipId] = {
      ...worn,
      condition: { ...worn.condition, damage: { shield: 0, armor: 60, hull: 20 } },
    };
    worse.assets.version += 1;
    const stale = runCommand({ campaign: worse as CampaignState, content, type: 'repair.confirm',
      payload: { token: armor.token! } });
    expect(stale.kind).toBe('failed');
    if (stale.kind !== 'failed') return;
    expect(stale.error.code).toBe('STALE_PREVIEW');
    const replacement = stale.error.replacementPreview;
    expect(replacement?.action).toBe('repair');
    expect(replacement?.totalCredits).toBeGreaterThan(armor.totalCredits);

    // A confirmed repair cannot be confirmed again with the same token.
    const once = runCommand({ campaign: state, content, type: 'repair.confirm', payload: { token: armor.token! } });
    expect(once.kind).toBe('committed');
    if (once.kind !== 'committed') return;
    const twice = runCommand({ campaign: once.campaign!, content, type: 'repair.confirm',
      payload: { token: armor.token! } });
    expect(twice.kind).toBe('failed');

    // A scope the wallet cannot meet is unavailable and says why.
    const poor = draftOf(state);
    poor.assets.credits = 0;
    poor.assets.version += 1;
    const hull = repairPreview(poor as CampaignState, content, { shipId, scope: 'hull' });
    expect(hull.available).toBe(false);
    expect(hull.unavailableReason).toBe('market.unavailable.insufficientCredits');
    expect(hull.totalCredits).toBeGreaterThan(0);
  });

  it('offers only the whole repair when the shield and capacitor alone need restoring [FUNC-10]', () => {
    const draft = draftOf(testCampaign());
    const shipId = draft.assets.activeShipId!;
    const ship = draft.assets.ships[shipId]!;
    draft.assets.ships[shipId] = {
      ...ship,
      condition: { damage: { shield: 40, armor: 0, hull: 0 }, capacitorCharge: 3 },
    };
    draft.assets.version += 1;
    const state = draft as CampaignState;

    expect(repairPreview(state, content, { shipId, scope: 'armor' }).unavailableReason)
      .toBe('repair.unavailable.noArmorDamage');
    expect(repairPreview(state, content, { shipId, scope: 'hull' }).unavailableReason)
      .toBe('repair.unavailable.noHullDamage');
    const all = repairPreview(state, content, { shipId, scope: 'all' });
    expect(all.available).toBe(true);
    expect(all.totalCredits).toBe(0);
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
