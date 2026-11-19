import { describe, expect, it } from 'vitest';

import { flyRun, runNamed, startOf } from '../support/properties/campaign.ts';

/**
 * A full-campaign property run from the golden combat save, fought to a loss
 * (see `campaignProperties.test.ts`; Technical Specification 15.1, 15.3).
 *
 * This is the run that loses a ship, so the destruction and recovery
 * transaction runs under every check (v0.2 phase 6). Before the runs were
 * spread over several files a loss was asserted of all six runs together;
 * this run was the one that met it (Test Suite Optimization Plan phase 1).
 */

const run = runNamed('the golden combat save, fought to a loss');

describe('full-campaign property runs', () => {
  it(`holds every invariant through a random campaign from ${run.name} [TECH-15.1, TECH-15.3, FUNC-22.2, FUNC-22.3, MVP-AC-06]`, () => {
    const summary = flyRun(run);
    // Ships were lost along the way, so the destruction and recovery
    // transaction ran under the same checks.
    expect(summary.final.recovery.losses).toBeGreaterThan(startOf(run.from).recovery.losses);
  }, 300_000);
});
