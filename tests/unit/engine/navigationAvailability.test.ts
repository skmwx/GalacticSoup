import { describe, expect, it } from 'vitest';

import { NAVIGATION_REFUSALS } from '@engine/domain';
import { RULE_VIOLATION_REASONS } from '@protocol';

/**
 * The domain may not import the protocol, so the navigation refusal vocabulary
 * is declared twice: once for the predicates that decide availability and once
 * for the errors a refused command answers with. They must name the same
 * things, or a projected reason would have no message
 * (Technical Specification 4.1, 12.3).
 */
describe('navigation refusal vocabulary', () => {
  it.each(NAVIGATION_REFUSALS)(
    'has a protocol rule-violation reason for %s [TECH-12.3, TECH-5.4]',
    (refusal) => {
      expect(RULE_VIOLATION_REASONS).toContain(refusal);
    },
  );
});
