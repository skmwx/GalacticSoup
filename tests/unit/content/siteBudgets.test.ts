import { describe, expect, it } from 'vitest';

import { compilePack, editDocument, shippedPack } from '../../support/contentFixtures.ts';
import { SITE_SOFT_BUDGETS } from '../../../scripts/lib/content/budgets.mjs';

/**
 * Per-site soft budgets (Technical Specification 13).
 *
 * A budget is a notice rather than a rule: content past one still compiles,
 * and the build names the encounter so a performance fixture of that size can
 * be added.
 */

const ENCOUNTERS = 'encounters/templates/borrell.json';

describe('per-site soft budgets', () => {
  it('finds every shipped encounter inside its budgets [TECH-13]', () => {
    const result = compilePack(shippedPack(), { floor: true });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('warns, without failing, when an encounter outgrows a budget [TECH-13, TECH-6.2]', () => {
    const crowded = editDocument(shippedPack(), ENCOUNTERS, (document) => {
      const base = (document['definitions'] as { id: string; spawns: { count: number }[] }[])
        .find((definition) => definition.id === 'encounter.borrell.pirate-base');
      const first = base?.spawns[0];
      if (first === undefined) throw new Error('The mastery encounter has no spawn.');
      first.count = SITE_SOFT_BUDGETS.ships + 2;
    });

    const result = compilePack(crowded, { floor: true });

    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const warning of result.warnings) {
      expect(warning.file.endsWith(ENCOUNTERS)).toBe(true);
      expect(warning.detail).toContain('encounter.borrell.pirate-base');
      expect(warning.detail).toContain('soft budget');
    }
    expect(result.warnings.some((warning) => warning.detail.includes(' ships,'))).toBe(true);
    expect(result.warnings.some((warning) => warning.detail.includes(' scheduledBoundaries,'))).toBe(true);
  });
});
