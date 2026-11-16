import { describe, expect, it } from 'vitest';

import { shippedContent } from '../../support/content.ts';
import { flyCareer, sortiesOf } from '../../support/balance/expectations.ts';

/**
 * Up the hull ladder from a new campaign (v0.2 Implementation Plan phase 6;
 * FeatureSpec02 9, 11; V02-AC-11).
 *
 * The pilot starts with the starting wallet and the starter ship, buys the
 * second autocannon, then the reference autocannon frigate, the blaster-and-web
 * destroyer and the railgun cruiser, each from what the loop paid, moving the
 * modules the next fit shares off the ship it leaves. The cruiser then clears
 * the Pirate Base, the advanced site that cost the destroyers the most in the
 * fit matrix. Every credit comes from bounties, loot and sales.
 */

const content = shippedContent();
const DESTROYER = 'hull.independent.destroyer';
const CRUISER = 'hull.independent.cruiser';

describe('career: up the hull ladder', () => {
  it('buys and flies both larger hulls through ordinary play [V02-AC-11, V02-AC-10, V02-AC-03, FUNC-9.11, FUNC-11.3]', async () => {
    const runs = await flyCareer('v02-hull-ladder', content);
    for (const run of runs) {
      const equips = run.entries.filter((entry) => entry.kind === 'equip');
      // Both upgrades were bought and flown, the destroyer before the cruiser.
      const destroyer = equips.find((entry) => entry.hullId === DESTROYER);
      const cruiser = equips.find((entry) => entry.hullId === CRUISER);
      expect(destroyer?.purchases.some((purchase) => purchase.definitionId === DESTROYER)).toBe(true);
      expect(cruiser?.purchases.some((purchase) => purchase.definitionId === CRUISER)).toBe(true);
      expect(cruiser!.afterSorties).toBeGreaterThan(destroyer!.afterSorties);
      const sorties = sortiesOf(run);
      expect(sorties.some((entry) => entry.hullId === DESTROYER && entry.status === 'completed')).toBe(true);
      // The cruiser clears the site the destroyers found hardest, twice.
      const base = sorties.filter((entry) => entry.hullId === CRUISER && entry.encounterId === 'encounter.borrell.pirate-base');
      expect(base.map((entry) => entry.status)).toEqual(['completed', 'completed']);
    }
  }, 1_800_000);
});
