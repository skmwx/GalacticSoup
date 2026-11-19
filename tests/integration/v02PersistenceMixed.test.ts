import { describe, expect, it } from 'vitest';

import { flyBoth, MIXED_CRUISER, SITES, start } from '../support/persistence/reopen.ts';

/**
 * The Command Group reopened with a mixed turret-and-launcher cruiser (see
 * `v02Persistence.test.ts`; v0.2 Implementation Plan phase 7; Technical
 * Specification 9.5, 11.4).
 */

describe('reopening the ladder fights the release ships', () => {
  it('reopens the Command Group with a mixed turret-and-launcher cruiser: reserved rounds, reloads, kills and bounties paid once [V02-AC-13, V02-AC-06, V02-AC-10, FUNC-9.4, FUNC-9.11, TECH-11.4]', () => {
    const before = start({ fit: MIXED_CRUISER, siteId: SITES.commandGroup, orbitKm: 8, seconds: 0 }).assets.credits;
    const { coverage, final } = flyBoth({ fit: MIXED_CRUISER, siteId: SITES.commandGroup, orbitKm: 8, seconds: 180 });
    expect(coverage.playerProjectilesAtReopen).toBeGreaterThan(0);
    expect(coverage.mostSpeedEffectsAtReopen).toBeGreaterThan(0);
    expect(coverage.destroyedBeforeLastReopen).toBeGreaterThan(0);
    // Every bounty paid was paid once: the wallet grew by exactly the bounties of the destroyed opponents.
    const destroyed = final.encounter.active?.npcs.filter((npc) => npc.destroyedAtMs !== null) ?? [];
    const bounties = destroyed.reduce((total, npc) => total + npc.bountyCredits, 0);
    expect(final.assets.credits - before).toBe(bounties);
    expect(final.encounter.active?.bountyCreditsPaid).toBe(bounties);
    expect(coverage.reservedAtReopen).toBeGreaterThan(0);
  }, 240_000);
});
