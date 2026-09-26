import { describe, expect, it } from 'vitest';

import { shippedContent } from '../../support/content.ts';
import { flyCareer, sortiesOf } from '../../support/balance/expectations.ts';

/**
 * Recovering from a loss (MVP Implementation Plan phase 17; MVP Scope 4.3,
 * objective 5; Functional Specification 9.12).
 *
 * A pilot takes the intermediate fit to the mastery site too early and loses
 * it. Insurance pays, the recovery service hands over a restricted starter
 * ship, and replaying the easiest site buys the intermediate fit back within
 * the career's sortie budget. The campaign never becomes unplayable.
 */

const content = shippedContent();

describe('career: losing the ship and coming back', () => {
  it('recovers from a loss at the mastery site through insurance, the recovery grant and the easiest site [MVP-AC-08, MVP-AC-09, FUNC-9.12, FUNC-22.1]', async () => {
    const runs = await flyCareer('loss-recovery', content);
    for (const run of runs) {
      const sorties = sortiesOf(run);
      const loss = sorties.find((entry) => entry.status === 'lost');
      expect(loss?.scenarioId).toBe('base.intermediate-brawl');
      // Basic insurance paid on the lost hull.
      expect(loss?.insuranceCredits).toBeGreaterThan(0);
      // The pilot flew on in the ship the recovery service supplied.
      const next = sorties[sorties.indexOf(loss as never) + 1];
      expect(next?.scenarioId).toBe('scout.starter');
      expect(next?.recoveryGrant).toBe(true);
      expect(sorties.at(-1)?.scenarioId).toBe('patrol.intermediate');
      expect(sorties.at(-1)?.status).toBe('completed');
    }
  }, 600_000);
});
