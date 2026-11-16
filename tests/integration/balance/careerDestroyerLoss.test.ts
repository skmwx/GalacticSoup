import { describe, expect, it } from 'vitest';

import { shippedContent } from '../../support/content.ts';
import { flyCareer, sortiesOf } from '../../support/balance/expectations.ts';

/**
 * A poor purchase, a lost destroyer and a rebuilt frigate (v0.2 Implementation
 * Plan phase 6; FeatureSpec02 4.2, 9; Functional Specification 9.12; V02-AC-12).
 *
 * The pilot buys a bare destroyer with the first credits that reach it, moves
 * the frigate's guns across and loses it at an advanced site. Basic insurance
 * pays; the stored frigate - stripped but flight-ready - is the active ship, so
 * no recovery grant is owed. One autocannon rebuilds it and the easy site pays
 * the way back to the multi-opponent site. The campaign never stalls.
 */

const content = shippedContent();

describe('career: losing a destroyer bought too early', () => {
  it('recovers through insurance, the stored frigate and the easy site, without a grant [V02-AC-12, FUNC-9.12, FUNC-22.1]', async () => {
    const runs = await flyCareer('v02-destroyer-loss', content);
    for (const run of runs) {
      const sorties = sortiesOf(run);
      const loss = sorties.find((entry) => entry.status === 'lost');
      expect(loss?.scenarioId).toBe('mistake.destroyer-folly.command-group');
      expect(loss?.hullId).toBe('hull.independent.destroyer');
      expect(loss?.insuranceCredits).toBeGreaterThan(0);
      // The stored frigate flies on; it is the pilot's own ship, not a grant.
      const after = sorties.slice(sorties.indexOf(loss!) + 1);
      expect(after[0]?.scenarioId).toBe('rebuild.pirate-scout');
      expect(after.every((entry) => entry.hullId === 'hull.independent.starter' && !entry.recoveryGrant)).toBe(true);
      expect(sorties.at(-1)?.scenarioId).toBe('patrol.intermediate');
      expect(sorties.at(-1)?.status).toBe('completed');
    }
  }, 1_800_000);
});
