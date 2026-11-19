import { describe, expect, it } from 'vitest';

import { flyRun, runNamed, WHOLE_LOOP_COMMANDS, type RunSummary } from '../support/properties/campaign.ts';

/**
 * A full-campaign property run from the golden wreck save (see
 * `campaignProperties.test.ts`; Technical Specification 15.1, 15.3).
 *
 * This run starts beside wrecks that hold loot, then goes on through the
 * station, travel and fights, so it is the one that answers for the whole
 * loop: every family of command commits in it. Before the runs were spread
 * over several files that was asserted of all six runs together; the wreck
 * run alone met it then as well (Test Suite Optimization Plan phase 1).
 */

const run = runNamed('the golden wreck save');

describe('full-campaign property runs', () => {
  let summary: RunSummary | undefined;

  it(`holds every invariant through a random campaign from ${run.name} [TECH-15.1, TECH-15.3, FUNC-22.2, FUNC-22.3, MVP-AC-06]`, () => {
    summary = flyRun(run);
  }, 300_000);

  it('exercised the whole loop, not a corner of it [TECH-15.1]', () => {
    if (summary === undefined) throw new Error('The wreck run did not finish.');
    // Every family of command committed at least once.
    for (const type of WHOLE_LOOP_COMMANDS) expect([...summary.types], type).toContain(type);
    expect(summary.visited.has('station')).toBe(true);
    expect(summary.visited.has('warp')).toBe(true);
    expect([...summary.visited].filter((place) => place.startsWith('site.')).length).toBeGreaterThanOrEqual(3);
    expect(summary.refusals.size).toBeGreaterThan(15);
  });
});
