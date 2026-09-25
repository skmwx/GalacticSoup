import { describe, it } from 'vitest';

import { shippedContent } from '../support/content.ts';
import { expectScenario } from '../support/progression/expectations.ts';

/**
 * The phase 16 exit gate, headless: the mastery site
 * (MVP Implementation Plan phase 16; MVP Scope 4.1-4.3, 9.1).
 *
 * The mastery fit - twin phased autocannons, afterburner, booster, plating and
 * capacitor battery - clears the Pirate Base in every sortie by holding 10 km
 * from gunners that outrun an unboosted hull. The long-range approach, twin
 * railguns with a passive tank, clears it in most sorties as well, so the
 * catalog offers two ways to master the loop rather than one ordered upgrade
 * path. See `progression.test.ts` for the earlier steps.
 */

const content = shippedContent();

describe('the mastery site', () => {
  it('clears the mastery site with the mastery fit, repeatedly [MVP-AC-05, MVP-AC-07, MVP-AC-09, FUNC-9.10, FUNC-18]', async () => {
    await expectScenario('base.mastery', content);
  }, 300_000);

  it('clears the mastery site with the long-range approach as well [MVP-AC-05, MVP-AC-07, FUNC-8.4, FUNC-21]', async () => {
    await expectScenario('base.lancer', content);
  }, 300_000);
});
