import { describe, expect, it } from 'vitest';

import { shippedContent } from '../../support/content.ts';
import { flyCareer, sortiesOf } from '../../support/balance/expectations.ts';

/**
 * The second approach, paid for by the loop
 * (MVP Implementation Plan phase 17; MVP Scope 4.1, 4.3).
 *
 * After the same start, multi-opponent clears buy twin railguns and the
 * mastery site is taken from range. The long-range fit is a further
 * investment rather than a shortcut, and the loop reaches it.
 */

const content = shippedContent();

describe('career: the long-range approach', () => {
  it('buys the long-range fit from multi-opponent clears and clears the mastery site with it [MVP-AC-05, MVP-AC-07, MVP-AC-09, FUNC-8.4, FUNC-21]', async () => {
    const runs = await flyCareer('long-range', content);
    for (const run of runs) {
      expect(sortiesOf(run).filter((entry) => entry.scenarioId === 'base.lancer' && entry.status === 'completed')).toHaveLength(2);
    }
  }, 600_000);
});
