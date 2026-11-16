import { describe, expect, it } from 'vitest';

import { shippedContent } from '../../support/content.ts';
import { flyCareer, sortiesOf } from '../../support/balance/expectations.ts';

/**
 * The dependable path: the hull ladder without a single module drop
 * (v0.2 Implementation Plan phase 6; FeatureSpec02 7.2, 9; V02-AC-10).
 *
 * The same plan as the hull-ladder career, but every module drop stays in the
 * wrecks: income is bounties, salvage and rounds alone, and every module is
 * bought at the station. Reaching the cruiser this way shows that no required
 * build depends on a lucky drop.
 */

const content = shippedContent();

describe('career: the hull ladder without module drops', () => {
  it('reaches the cruiser on bounties, salvage and the market alone [V02-AC-10, V02-AC-11, FUNC-11.3]', async () => {
    const runs = await flyCareer('v02-no-module-drops', content);
    for (const run of runs) {
      const sorties = sortiesOf(run);
      // Nothing kept or sold was a module: every module in the plan was bought.
      for (const entry of sorties) {
        expect(Object.keys(entry.lootKept).filter((definitionId) => definitionId.startsWith('module.'))).toEqual([]);
      }
      const equips = run.entries.filter((entry) => entry.kind === 'equip');
      expect(equips.some((entry) => entry.hullId === 'hull.independent.cruiser')).toBe(true);
      expect(sorties.filter((entry) => entry.hullId === 'hull.independent.cruiser' && entry.status === 'completed')).toHaveLength(2);
    }
  }, 1_800_000);
});
