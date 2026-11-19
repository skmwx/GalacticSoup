import { describe, expect, it } from 'vitest';

import { content, flyBoth, SITES } from '../support/persistence/reopen.ts';
import { referenceFixtureFit } from '../support/progression/ladder.ts';

/**
 * Range Check reopened under both sides' webs (see `v02Persistence.test.ts`;
 * v0.2 Implementation Plan phase 7; Technical Specification 9.5, 11.4).
 */

describe('reopening the ladder fights the release ships', () => {
  it('reopens Range Check under the player\'s and the binder\'s webs and matches the uninterrupted fight [V02-AC-13, V02-AC-07, FUNC-9.9, TECH-9.5, TECH-11.4]', () => {
    const { coverage } = flyBoth({
      fit: referenceFixtureFit('fit.destroyer.blaster-web', content),
      siteId: SITES.rangeCheck,
      orbitKm: 4,
      seconds: 150,
    });
    expect(coverage.mostSpeedEffectsAtReopen).toBeGreaterThanOrEqual(2);
    expect(coverage.destroyedBeforeLastReopen).toBeGreaterThan(0);
  }, 240_000);
});
