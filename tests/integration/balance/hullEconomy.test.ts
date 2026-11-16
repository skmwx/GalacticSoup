import { describe, expect, it } from 'vitest';

import { marketBuyPreview } from '@engine/projections';

import { shippedContent } from '../../support/content.ts';
import { newCampaign } from '../../support/loss.ts';
import { assembleFit } from '../../support/progression/assemble.ts';
import { referenceFixtureFit } from '../../support/progression/ladder.ts';
import { MATRIX, matrixFits } from '../../support/balance/matrix.ts';

/**
 * What a larger hull costs to own and to lose (v0.2 Implementation Plan
 * phase 6; FeatureSpec02 4.1, 9, 11).
 *
 * The matrix measures what each hull does in a fight; this file holds the
 * other half of the bargain. Every step up the hull ladder costs more to field
 * and more to lose, so a cruiser is an investment with a downside rather than
 * a free upgrade; and no insurance choice turns a deliberate loss into profit
 * (Functional Specification 9.12).
 */

const content = shippedContent();
const seed = MATRIX.seeds[0] ?? '';
const station = content.rules.economy.startingStationId;
const economy = content.rules.economy;
const HULLS = ['hull.independent.starter', 'hull.independent.destroyer', 'hull.independent.cruiser'];

function packages(hullId: string): number[] {
  return matrixFits()
    .map((fitId) => referenceFixtureFit(fitId, content))
    .filter((fit) => (fit.hullId ?? economy.starterHullId) === hullId)
    .map((fit) => assembleFit(fit, seed, content).costCredits);
}

describe('the cost of a larger hull', () => {
  it('fields each larger hull for more than every package below it [V02-AC-11, V02-AC-12]', () => {
    const [frigate, destroyer, cruiser] = HULLS.map(packages);
    expect(frigate).toHaveLength(2);
    expect(destroyer).toHaveLength(2);
    expect(cruiser).toHaveLength(2);
    expect(Math.min(...destroyer!)).toBeGreaterThan(Math.max(...frigate!));
    expect(Math.min(...cruiser!)).toBeGreaterThan(Math.max(...destroyer!));
  });

  it('loses more with each larger hull after basic insurance, and enhanced cover never makes a loss pay [V02-AC-12, FUNC-9.12]', () => {
    const state = newCampaign(seed, content);
    let previousExposure = 0;
    for (const hullId of HULLS) {
      const price = marketBuyPreview(state, content, { stationId: station, itemId: hullId, quantity: 1 }).totalCredits;
      const reference = content.requireHull(hullId as never).referenceValueCredits;
      const basic = Math.floor(reference * economy.basicInsurancePayoutFraction);
      const enhanced = Math.floor(reference * economy.enhancedInsurancePayoutFraction);
      const premium = Math.ceil(reference * economy.enhancedInsurancePremiumFraction);
      // Replacing the hull after a loss costs more for each larger hull...
      const exposure = Math.abs(price) - basic;
      expect(exposure, hullId).toBeGreaterThan(previousExposure);
      previousExposure = exposure;
      // ...and the best cover, net of its premium, never buys the hull back.
      expect(enhanced - premium, hullId).toBeLessThan(Math.abs(price));
    }
  });
});
