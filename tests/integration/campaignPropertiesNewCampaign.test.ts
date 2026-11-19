import { describe, it } from 'vitest';

import { flyRun, runNamed } from '../support/properties/campaign.ts';

/**
 * A full-campaign property run from a second new campaign (see
 * `campaignProperties.test.ts`; Technical Specification 15.1, 15.3).
 */

const run = runNamed('another new campaign');

describe('full-campaign property runs', () => {
  it(`holds every invariant through a random campaign from ${run.name} [TECH-15.1, TECH-15.3, FUNC-22.2, FUNC-22.3, MVP-AC-06]`, () => {
    flyRun(run);
  }, 300_000);
});
