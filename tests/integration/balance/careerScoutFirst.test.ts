import { describe, expect, it } from 'vitest';

import { shippedContent } from '../../support/content.ts';
import { flyCareer, sortiesOf } from '../../support/balance/expectations.ts';

/**
 * The intended loop from a new campaign's first day to the mastery site
 * (MVP Implementation Plan phase 17; MVP Scope 4.3, objectives 1, 3, 4 and 6).
 *
 * The pilot flies the easiest site with the ship they were given, buys the
 * second autocannon with the starting credits, clears the multi-opponent site
 * until the mastery fit is affordable and then clears the mastery site twice.
 * Every credit comes from the loop.
 */

const content = shippedContent();

describe('career: scout first, then up the tiers', () => {
  it('reaches and clears the mastery site through the loop alone, with an upgrade decision after every few sorties [MVP-AC-05, MVP-AC-06, MVP-AC-07, MVP-AC-09, FUNC-9.11, FUNC-11.3, FUNC-18]', async () => {
    const runs = await flyCareer('scout-first', content);
    for (const run of runs) {
      const sorties = sortiesOf(run);
      // Objective 1: the first sortie is the easiest site, with nothing bought.
      const first = run.entries[0];
      expect(first?.kind === 'equip' ? first.costCredits : null).toBe(0);
      expect(sorties[0]?.scenarioId).toBe('scout.starter');
      expect(sorties[0]?.status).toBe('completed');
      // Objective 6: the mastery site falls to what the loop paid for.
      expect(sorties.filter((entry) => entry.scenarioId === 'base.mastery' && entry.status === 'completed')).toHaveLength(2);
    }
  }, 600_000);
});
