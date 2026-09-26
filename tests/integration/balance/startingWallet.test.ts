import { describe, expect, it } from 'vitest';

import { marketBuyPreview } from '@engine/projections';

import { CAREERS } from '../../support/balance/career.ts';
import { shippedContent } from '../../support/content.ts';
import { newCampaign } from '../../support/loss.ts';
import { assembleFit } from '../../support/progression/assemble.ts';
import { fixtureFit, PROGRESSION } from '../../support/progression/fixtures.ts';

/**
 * What the starting wallet buys (MVP Implementation Plan phase 17; MVP Scope
 * 4.3, objective 2).
 *
 * The starting credits must permit a meaningful choice but not every desired
 * upgrade. Every module the starting station sells can be bought on its own,
 * so any direction is open; no two of the modules that change how the ship
 * fights - a weapon or propulsion - can be bought together, so choosing one
 * gives up the others; and the fits that master the loop stay out of reach
 * until it has paid for them.
 */

const content = shippedContent();
const STATION = content.rules.economy.startingStationId;
const seed = PROGRESSION.scenarios[0]?.seeds[0] ?? '';

describe('the starting wallet', () => {
  it('buys any one direction but not every upgrade, and neither mastery fit [MVP-AC-02, MVP-AC-07, FUNC-3.1, FUNC-11.3]', () => {
    const starting = content.rules.economy.startingCredits;
    const cost = (fitId: string): number => assembleFit(fixtureFit(fitId), seed, content).costCredits;
    const wallet = CAREERS.startingWallet;

    for (const fitId of wallet.affordable) {
      expect(cost(fitId), fitId).toBeGreaterThan(0);
      expect(cost(fitId), fitId).toBeLessThanOrEqual(starting);
    }
    for (const fitId of wallet.unaffordable) expect(cost(fitId), fitId).toBeGreaterThan(starting);
    // The affordable directions exclude one another.
    for (const [index, first] of wallet.affordable.entries()) {
      for (const second of wallet.affordable.slice(index + 1)) {
        expect(cost(first) + cost(second), `${first} with ${second}`).toBeGreaterThan(starting);
      }
    }

    // Every module on sale is within reach on its own...
    const state = newCampaign(seed, content);
    const quote = (itemId: string): number =>
      marketBuyPreview(state, content, { stationId: STATION, itemId, quantity: 1 }).totalCredits;
    const modules = content.listings(STATION)
      .filter((listing) => content.module(listing.itemId) !== undefined)
      .map((listing) => content.requireModule(listing.itemId as never));
    expect(modules.length).toBeGreaterThan(4);
    for (const module of modules) expect(quote(module.id), module.id).toBeLessThanOrEqual(starting);
    // ...but no two of the modules that change how the ship fights together.
    const major = modules.filter((module) => module.category === 'turret' || module.category === 'propulsion');
    expect(major.length).toBeGreaterThan(2);
    for (const [index, first] of major.entries()) {
      for (const second of major.slice(index + 1)) {
        expect(quote(first.id) + quote(second.id), `${first.id} with ${second.id}`).toBeGreaterThan(starting);
      }
    }
  });
});
