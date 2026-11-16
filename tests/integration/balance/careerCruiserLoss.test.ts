import { describe, expect, it } from 'vitest';

import { shippedContent } from '../../support/content.ts';
import { flyCareer, sortiesOf } from '../../support/balance/expectations.ts';

/**
 * Losing the cruiser (v0.2 Implementation Plan phase 6; FeatureSpec02 4.2, 9;
 * Functional Specification 9.12; V02-AC-12).
 *
 * The hull-ladder plan up to the railgun cruiser, then a mistake that costs
 * it. Basic insurance pays a share of the hull and no cruiser is granted; the
 * stored destroyer becomes the active ship, buys back what the cruiser took
 * off it, and the developed band keeps paying.
 */

const content = shippedContent();

describe('career: losing the cruiser', () => {
  it('flies the stored destroyer on, profitably, after the cruiser is lost [V02-AC-12, FUNC-9.12]', async () => {
    const runs = await flyCareer('v02-cruiser-loss', content);
    for (const run of runs) {
      const sorties = sortiesOf(run);
      const loss = sorties.find((entry) => entry.status === 'lost');
      expect(loss?.hullId).toBe('hull.independent.cruiser');
      expect(loss?.insuranceCredits).toBeGreaterThan(0);
      const after = sorties.slice(sorties.indexOf(loss!) + 1);
      expect(after.length).toBe(3);
      for (const entry of after) {
        expect(entry.hullId).toBe('hull.independent.destroyer');
        expect(entry.recoveryGrant).toBe(false);
        expect(entry.status).toBe('completed');
        expect(entry.creditsAfter).toBeGreaterThan(entry.creditsBefore);
      }
    }
  }, 1_800_000);
});
