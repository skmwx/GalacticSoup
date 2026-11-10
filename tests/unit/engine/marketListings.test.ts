import { describe, expect, it } from 'vitest';

import { stacksIn, starterReferenceValue, type CampaignState } from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import { marketBuyPreview, marketListingsProjection, marketSellPreview } from '@engine/projections';
import type { MarketListingsData, MarketSuitabilityData } from '@protocol';

import { TEST_SEED } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';
import {
  ANNEX,
  ANNEX_SITE_ID,
  AUTOCANNON,
  FUSION,
  HARBOUR,
  buy,
  command,
  destroyPlayer,
  inSite,
  newCampaign,
  stateOf,
  twoStationContent,
  withCredits,
} from '../../support/loss.ts';

/**
 * The market view's suitability and sell side (UIR1-03).
 *
 * A module says which slot it occupies and a charge which weapons load it,
 * judged by the fitting rules against the committed fit. The sell side lists
 * only plain stacks held locally - this station's hangar and the active
 * ship's hold - and says why one cannot be sold.
 */

const content = shippedContent();
const RAILGUN = 'module.turret.railgun.small';
const PLATING = 'module.plating.armor.small';
const IRON = 'ammo.hybrid.small.iron';

function listings(state: CampaignState, source: ContentRepository = content, stationId = HARBOUR): MarketListingsData {
  return marketListingsProjection(state, source, stationId);
}

function suitability(view: MarketListingsData, definitionId: string): MarketSuitabilityData | null {
  const listing = view.listings.find((entry) => entry.item.definitionId === definitionId);
  if (listing === undefined) throw new Error(`${definitionId} is not listed.`);
  return listing.suitability;
}

function refitWeapon(state: CampaignState, moduleId: string | null, ammunitionId?: string): CampaignState {
  const shipId = state.assets.activeShipId!;
  let next = command(state, 'fitting.begin', { shipId }).state;
  next = moduleId === null
    ? command(next, 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 }).state
    : command(next, 'fitting.set', {
        slotKind: 'weapon', slotIndex: 0, moduleId, online: true,
        ...(ammunitionId === undefined ? {} : { ammunitionId }),
      }).state;
  return command(next, 'fitting.commit', {}).state;
}

describe('market suitability', () => {
  it('names the slot and hardpoint a module occupies [FUNC-8.3, FUNC-19.5]', () => {
    const view = listings(newCampaign());
    expect(suitability(view, AUTOCANNON)).toEqual({ kind: 'module', slot: 'weapon', hardpoint: 'turret' });
    expect(suitability(view, PLATING)).toEqual({ kind: 'module', slot: 'engineering', hardpoint: null });
    expect(suitability(view, 'hull.independent.starter')).toBeNull();
  });

  it('names the weapons a charge suits and matches it against the committed fit [FUNC-8.4, FUNC-19.5]', () => {
    let state = withCredits(newCampaign(), 100_000);
    let view = listings(state);
    // The starter fit carries an autocannon: projectile rounds match, hybrid do not.
    expect(suitability(view, FUSION)).toEqual({
      kind: 'ammunition',
      weapons: [{ definitionId: AUTOCANNON, nameKey: content.module(AUTOCANNON)?.nameKey, fitted: true }],
      currentFit: 'compatible',
    });
    expect(suitability(view, IRON)).toMatchObject({
      kind: 'ammunition',
      weapons: [{ definitionId: RAILGUN, fitted: false }],
      currentFit: 'incompatible',
    });

    // A draft is not the fit: nothing moves until it is applied.
    state = buy(state, RAILGUN, 1).state;
    state = buy(state, IRON, 25).state;
    const drafted = command(
      command(state, 'fitting.begin', { shipId: state.assets.activeShipId }).state,
      'fitting.set',
      { slotKind: 'weapon', slotIndex: 0, moduleId: RAILGUN, online: true, ammunitionId: IRON },
    ).state;
    expect(suitability(listings(drafted), IRON)).toMatchObject({ currentFit: 'incompatible' });

    // Applying the railgun turns the match around.
    state = refitWeapon(state, RAILGUN, IRON);
    view = listings(state);
    expect(suitability(view, IRON)).toMatchObject({
      currentFit: 'compatible', weapons: [{ definitionId: RAILGUN, fitted: true }],
    });
    expect(suitability(view, FUSION)).toMatchObject({
      currentFit: 'incompatible', weapons: [{ definitionId: AUTOCANNON, fitted: false }],
    });

    // With no weapon fitted, no charge matches.
    state = refitWeapon(state, null);
    expect(suitability(listings(state), FUSION)).toMatchObject({ currentFit: 'noWeapons' });
  });

  it('says so when the pilot has no ship [FUNC-9.12]', () => {
    const fixture = inSite(withCredits(newCampaign(), starterReferenceValue(content)));
    destroyPlayer(fixture);
    const state = stateOf(fixture);
    expect(state.assets.activeShipId).toBeNull();
    expect(suitability(listings(state), FUSION)).toMatchObject({ kind: 'ammunition', currentFit: 'noShip' });
  });
});

describe('the sell side', () => {
  it('lists plain stacks in this hangar and the active hold, never fitted modules or loaded charges [FUNC-6.1, FUNC-11.3]', () => {
    let state = withCredits(newCampaign(), 100_000);
    const shipId = state.assets.activeShipId!;
    const cargoId = state.assets.ships[shipId]!.cargoInventoryId;
    const fittingId = state.assets.ships[shipId]!.fittingInventoryId;
    const held = (current: CampaignState): number => listings(current).owned
      .filter((stack) => stack.source === 'hangar' && stack.item.definitionId === FUSION)
      .reduce((total, stack) => total + stack.quantity, 0);
    const spare = held(state);
    // The same item in both places, as two distinguishable stacks.
    state = buy(state, FUSION, 30).state;
    state = buyInto(state, FUSION, 12, cargoId);

    const view = listings(state);
    const fusion = view.owned.filter((stack) => stack.item.definitionId === FUSION);
    expect(fusion.map(({ source, quantity }) => ({ source, quantity }))).toEqual([
      { source: 'hangar', quantity: spare + 30 },
      { source: 'cargo', quantity: 12 },
    ]);
    expect(new Set(fusion.map((stack) => stack.stackId)).size).toBe(2);
    expect(fusion.every((stack) => stack.sellable && stack.unavailableReason === null)).toBe(true);
    expect(fusion[0]!.unitSalePriceCredits).toBe(
      view.listings.find((listing) => listing.item.definitionId === FUSION)!.stationBuyPriceCredits,
    );
    expect(fusion[0]!.suitability).toMatchObject({ kind: 'ammunition', currentFit: 'compatible' });

    // The fitted autocannon and its magazine are not for sale.
    const fitted = new Set<string>(stacksIn(state.assets, fittingId).map((stack) => stack.id));
    expect(fitted.size).toBeGreaterThan(0);
    expect(view.owned.some((stack) => fitted.has(stack.stackId))).toBe(false);

    // Each listed stack sells from where it is.
    for (const stack of fusion) {
      const preview = marketSellPreview(state, content, { stationId: HARBOUR, stackId: stack.stackId, quantity: 1 });
      expect(preview.available).toBe(true);
      const before = state.assets.credits;
      state = command(state, 'market.confirmSell', { token: preview.token }).state;
      expect(state.assets.credits).toBe(before + preview.totalCredits);
    }
    expect(listings(state).owned.filter((stack) => stack.item.definitionId === FUSION).map((stack) => stack.quantity))
      .toEqual([spare + 29, 11]);
  });

  it('omits goods held at another station, and lists nothing while undocked [FUNC-6.1]', () => {
    const source = twoStationContent();
    let state = command(withCredits(newCampaign(TEST_SEED, source), 100_000), 'time.set', { paused: false, rate: 1 }, source).state;
    state = buy(state, FUSION, 30, source).state;
    expect(listings(state, source).owned.some((stack) => stack.source === 'hangar')).toBe(true);

    state = command(state, 'ship.undock', {}, source).state;
    expect(listings(state, source).owned).toEqual([]);

    state = command(state, 'navigation.warp', { destinationSiteId: ANNEX_SITE_ID, arrivalDistanceKm: 0 }, source).state;
    state = until(state, (current) => current.assets.location.kind === 'site' &&
      current.assets.location.siteId === ANNEX_SITE_ID, source);
    state = command(state, 'navigation.dock', { stationId: ANNEX }, source).state;
    state = until(state, (current) => current.assets.location.kind === 'station', source);

    const annex = listings(state, source, ANNEX);
    // The harbour's thirty rounds stay at the harbour.
    expect(annex.owned.filter((stack) => stack.source === 'hangar')).toEqual([]);
    expect(annex.owned.every((stack) => stack.source === 'cargo')).toBe(true);
  });

  it('keeps recovery-grant goods listed, unavailable, with the reason [FUNC-9.12]', () => {
    const fixture = inSite(withCredits(newCampaign(), 0));
    destroyPlayer(fixture);
    let state = stateOf(fixture);
    expect(state.assets.activeShipId).not.toBeNull();
    // Strip the granted autocannon into the hangar.
    state = refitWeapon(state, null);

    const granted = listings(state).owned.find((stack) => stack.item.definitionId === AUTOCANNON);
    expect(granted).toMatchObject({
      source: 'hangar',
      recoveryGrant: true,
      sellable: false,
      unavailableReason: 'market.unavailable.recoveryGrant',
    });
    // The sale preview gives the same answer.
    expect(marketSellPreview(state, content, { stationId: HARBOUR, stackId: granted!.stackId, quantity: 1 }).unavailableReason)
      .toBe('market.unavailable.recoveryGrant');
  });
});

function buyInto(state: CampaignState, itemId: string, quantity: number, destinationInventoryId: string): CampaignState {
  const preview = marketBuyPreview(state, content, { stationId: HARBOUR, itemId, quantity, destinationInventoryId });
  if (!preview.available) throw new Error(String(preview.unavailableReason));
  return command(state, 'market.confirmBuy', { token: preview.token }).state;
}

function until(
  state: CampaignState,
  done: (current: CampaignState) => boolean,
  source: ContentRepository,
  limitMs = 120_000,
): CampaignState {
  let current = state;
  for (let elapsed = 0; elapsed < limitMs && !done(current); elapsed += 250) {
    current = command(current, 'time.advance', { elapsedRealMs: 250 }, source).state;
  }
  if (!done(current)) throw new Error('The campaign never reached the expected state.');
  return current;
}
