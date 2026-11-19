import { describe, expect, it } from 'vitest';

import { campaignStateHash } from '@engine';

import { fly, flyRun, runNamed, type RunSummary } from '../support/properties/campaign.ts';

/**
 * Full-campaign property runs (MVP Implementation Plan phase 20; Technical
 * Specification 7.2, 9.4, 9.5, 11.4, 13, 15.1, 15.3).
 *
 * A random pilot plays the whole loop for thousands of steps; what is
 * asserted holds at every step of every run (`tests/support/properties/campaign.ts`).
 * The six runs are spread over `campaignProperties*.test.ts` so that they
 * proceed side by side (Test Suite Optimization Plan phase 1). This file
 * holds the first new campaign and the same campaign closed and reopened
 * along the way.
 */

const run = runNamed('a new campaign');

describe('full-campaign property runs', () => {
  let straight: RunSummary | undefined;

  it(`holds every invariant through a random campaign from ${run.name} [TECH-15.1, TECH-15.3, FUNC-22.2, FUNC-22.3, MVP-AC-06]`, () => {
    straight = flyRun(run);
  }, 300_000);

  it('reaches the same state when the campaign is closed and reopened along the way [TECH-9.5, TECH-11.4, FUNC-4.3, MVP-AC-01, V02-AC-01]', () => {
    const reloaded = fly(run.from, run.pilot, true);
    const uninterrupted = straight ?? fly(run.from, run.pilot, false);
    expect(campaignStateHash(reloaded.final)).toBe(campaignStateHash(uninterrupted.final));
    expect(reloaded.final.revision).toBe(uninterrupted.final.revision);
  }, 300_000);
});
