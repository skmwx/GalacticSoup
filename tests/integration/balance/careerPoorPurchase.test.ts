import { describe, expect, it } from 'vitest';

import { shippedContent } from '../../support/content.ts';
import { flyCareer, sortiesOf } from '../../support/balance/expectations.ts';

/**
 * Recovering from a poor purchase (MVP Implementation Plan phase 17;
 * MVP Scope 4.3, objectives 2 and 5).
 *
 * The starting credits go on an armour tank the shield-tanked starter does not
 * use. Replaying the easiest site with the one autocannon pays for the second
 * one within the career's sortie budget, and the multi-opponent site follows.
 */

const content = shippedContent();

describe('career: a poor first purchase', () => {
  it('replays the easiest site back to the intermediate fit without prolonged grinding [MVP-AC-06, MVP-AC-07, MVP-AC-09, FUNC-11.3, FUNC-18]', async () => {
    const runs = await flyCareer('poor-purchase', content);
    for (const run of runs) {
      const folly = run.entries[0];
      // The purchase really did spend most of the starting credits.
      expect(folly?.kind === 'equip' ? folly.creditsAfter : Infinity).toBeLessThan(run.startingCredits * 0.15);
      expect(sortiesOf(run).at(-1)?.scenarioId).toBe('patrol.intermediate');
      expect(sortiesOf(run).at(-1)?.status).toBe('completed');
    }
  }, 600_000);
});
