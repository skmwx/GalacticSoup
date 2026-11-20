import { describe, expect, it } from 'vitest';

import { checkpointAt, prepareCheckpoint, type Checkpoint } from '../support/checkpoint/scenarios.ts';
import { shippedContent } from '../support/content.ts';

/**
 * The mastery browser checkpoint (Test Suite Optimization Plan phase 6): the
 * patrol checkpoint continued through the protocol - salvage sold, the mastery
 * fit bought and fitted with the earned plating, the Pirate Base flown and
 * cleared - is the same save every time and says what the interface must show.
 * It is the longest checkpoint to make, so it has a file of its own and runs
 * beside `checkpoints.test.ts`.
 */

const content = shippedContent();

/**
 * About 9 s a generation on an idle machine; two or three times that beside
 * the rest of the fast integration selection.
 */
const GENERATION_TIMEOUT_MS = 90_000;

let made: Promise<Checkpoint> | undefined;
function baseCleared(): Promise<Checkpoint> {
  made ??= prepareCheckpoint('base-cleared', content);
  return made;
}

describe('the mastery browser checkpoint', () => {
  it('makes "base-cleared" the same save every time [TECH-11.4]', async () => {
    const first = await baseCleared();
    const second = await prepareCheckpoint('base-cleared', content);
    expect(second.envelope.checksum).toBe(first.envelope.checksum);
    expect(second.facts).toEqual(first.facts);
    expect(first.facts.paused).toBe(true);
  }, GENERATION_TIMEOUT_MS);

  it('docks after the mastery site with the mastery fit, the base chosen and each site completed once [MVP-AC-07, MVP-AC-09]', async () => {
    const { facts } = checkpointAt(await baseCleared(), 'station');
    expect(facts.lastOutcome).toMatchObject({
      encounterId: 'encounter.borrell.pirate-base',
      status: 'completed',
      npcsDestroyed: 4,
      npcsTotal: 4,
      bountyCreditsPaid: 26_000,
    });
    // The mastery fit, with the plating the patrol's wreck held.
    const fitted = facts.fit.map((slot) => slot.moduleId);
    for (const module of ['module.propulsion.afterburner.small', 'module.plating.armor.small', 'module.capacitor.battery.small']) {
      expect(fitted).toContain(module);
    }
    expect(facts.hold.some((stack) => stack.kind === 'item')).toBe(false);
    expect(facts.selectedDestination).toEqual({ encounterId: 'encounter.borrell.pirate-base', name: 'Pirate Base' });
    expect([...facts.completions].sort((left, right) => left.encounterId.localeCompare(right.encounterId))).toEqual([
      { encounterId: 'encounter.borrell.pirate-base', name: 'Pirate Base', count: 1 },
      { encounterId: 'encounter.borrell.pirate-patrol', name: 'Pirate Patrol', count: 1 },
    ]);
  }, GENERATION_TIMEOUT_MS);
});
