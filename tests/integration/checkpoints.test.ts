import { describe, expect, it } from 'vitest';

import { envelopeChecksum, type SaveEnvelope } from '@engine';

import {
  CHECKPOINT_NAMES,
  checkpointAt,
  CheckpointMismatch,
  prepareCheckpoint,
  verifyCheckpoint,
  type Checkpoint,
  type CheckpointName,
} from '../support/checkpoint/scenarios.ts';
import { shippedContent } from '../support/content.ts';

/**
 * The browser checkpoints (Test Suite Optimization Plan phases 3, 4, 7 and 8): each
 * one is reached through the protocol, is the same save every time it is made,
 * says what it promises, and is refused when its save no longer matches.
 */

const content = shippedContent();

/** One generation per checkpoint for the cases that only read it; the determinism case makes its own. */
const made = new Map<CheckpointName, Promise<Checkpoint>>();
function checkpoint(name: CheckpointName): Promise<Checkpoint> {
  let found = made.get(name);
  if (found === undefined) {
    found = prepareCheckpoint(name, content);
    made.set(name, found);
  }
  return found;
}

/** Simulated time is cheap but not free: the patrol sortie takes a few seconds to fly. */
const GENERATION_TIMEOUT_MS = 30_000;

/** Reseals an envelope after a change, so only the changed field differs. */
function resealed(envelope: SaveEnvelope, change: Partial<SaveEnvelope>): SaveEnvelope {
  const { checksum: _checksum, ...fields } = { ...envelope, ...change };
  return { ...fields, checksum: envelopeChecksum(fields) };
}

describe('browser checkpoints', () => {
  // The mastery checkpoint is the longest to make; its cases are in
  // checkpointsMastery.test.ts so they run beside these.
  for (const name of CHECKPOINT_NAMES.filter((entry) => entry !== 'base-cleared')) {
    it(`makes "${name}" the same save every time [TECH-11.4]`, async () => {
      const first = await checkpoint(name);
      const second = await prepareCheckpoint(name, content);
      expect(second.envelope.checksum).toBe(first.envelope.checksum);
      expect(second.facts).toEqual(first.facts);
      expect(first.facts.paused).toBe(true);
    }, GENERATION_TIMEOUT_MS);
  }

  it('arrives at the scout site with nothing ordered, locked or running', async () => {
    const arrived = checkpointAt(await checkpoint('scout-arrived'), 'site');
    expect(arrived.facts.siteId).toBe('site.borrell.verge');
    expect(arrived.facts.locks).toEqual([]);
    expect(arrived.facts.firingAt).toBeNull();
    expect(arrived.facts.boosterActive).toBe(false);
    // Where the warp put the ship, far from the 1 km orbit the commands cases order themselves.
    expect(arrived.facts.opponentRangeKm).toBeGreaterThan(5);
  });

  it('leaves the scout unlocked and unfired on in range, and in a running fight', async () => {
    const inRange = checkpointAt(await checkpoint('scout-in-range'), 'site');
    expect(inRange.facts.siteId).toBe('site.borrell.verge');
    expect(inRange.facts.opponentWithinLockRange).toBe(true);
    expect(inRange.facts.locks).toEqual([]);
    expect(inRange.facts.firingAt).toBeNull();

    const fight = checkpointAt(await checkpoint('scout-fight'), 'site');
    expect(fight.facts.siteId).toBe('site.borrell.verge');
    expect(fight.facts.locks).toEqual([{ targetId: fight.facts.opponentId, status: 'locked' }]);
    expect(fight.facts.firingAt).toBe(fight.facts.opponentId);
    expect(fight.facts.boosterActive).toBe(true);
  });

  it('pauses under a guided volley in flight, and under a web on the ship [V02-AC-06, V02-AC-07]', async () => {
    const guided = checkpointAt(await checkpoint('guided-incoming'), 'site');
    expect(guided.facts.siteId).toBe('site.borrell.signal-spire');
    expect(guided.facts.paused).toBe(true);
    expect(guided.facts.locks).toEqual([{ targetId: guided.facts.opponentId, status: 'locked' }]);
    expect(guided.facts.incomingProjectiles).toBeGreaterThan(0);

    const web = checkpointAt(await checkpoint('web-held'), 'site');
    expect(web.facts.siteId).toBe('site.borrell.tangle-drift');
    expect(web.facts.paused).toBe(true);
    expect(web.facts.incomingWebs).toBeGreaterThan(0);
  }, GENERATION_TIMEOUT_MS);

  it('docks after the patrol with its bounty paid and the salvage in the hold [MVP-AC-06]', async () => {
    const patrol = checkpointAt(await checkpoint('patrol-salvage'), 'station');
    const { facts } = patrol;
    expect(facts.stationId).toBe(content.rules.economy.startingStationId);
    expect(facts.lastOutcome).toMatchObject({
      encounterId: 'encounter.borrell.pirate-patrol',
      status: 'completed',
      npcsDestroyed: 3,
      npcsTotal: 3,
      bountyCreditsPaid: 13_000,
    });
    // The intermediate fit, bought with the starting credits.
    const fitted = facts.fit.map((slot) => slot.moduleId).filter((id) => id !== null);
    expect(fitted.filter((id) => id === 'module.turret.autocannon.small')).toHaveLength(2);
    // Salvage to sell and an earned module to fit, as the Patrol-to-Base case finds.
    expect(facts.hold.some((stack) => stack.kind === 'item')).toBe(true);
    expect(facts.hold.some((stack) => stack.definitionId === 'module.plating.armor.small')).toBe(true);
    expect(facts.fit.some((slot) => slot.moduleId === 'module.plating.armor.small')).toBe(false);
    expect(facts.credits).toBeGreaterThan(13_000);
  }, GENERATION_TIMEOUT_MS);

  it('docks after a loss with a recovery grant and the survivors in the wreck [MVP-AC-08, FUNC-9.12]', async () => {
    const { facts } = checkpointAt(await checkpoint('loss-granted'), 'station');
    expect(facts.stationId).toBe(content.rules.economy.startingStationId);
    expect(facts.activeShipId).not.toBeNull();
    expect(facts.lastOutcome).toMatchObject({ encounterId: 'encounter.borrell.pirate-base', status: 'lost' });
    expect(facts.loss).toMatchObject({
      hullName: 'Wayfarer',
      siteName: 'Outpost Cradle',
      encounterName: 'Pirate Base',
      recovery: 'granted',
      payoutCredits: 3_600,
      creditsAfter: 11_600,
      wreckPresent: true,
      wreckItemCount: 2,
    });
    expect(facts.credits).toBe(11_600);
    expect(facts.loss?.items).toEqual([
      { name: '200mm Autocannon', quantity: 1, origin: 'fitted', survived: false },
      { name: 'Fusion S', quantity: 20, origin: 'loaded', survived: false },
      { name: 'Small Shield Booster', quantity: 1, origin: 'fitted', survived: true },
      { name: 'Fusion S', quantity: expect.any(Number) as number, origin: 'cargo', survived: true },
    ]);
    // The spare gun waits in the hangar for the refit.
    expect(facts.hangar.some((stack) => stack.definitionId === 'module.turret.autocannon.small')).toBe(true);
  }, GENERATION_TIMEOUT_MS);

  it('docks after a loss without a ship when the payout buys one back [FUNC-9.12, FUNC-22.1]', async () => {
    const { facts } = checkpointAt(await checkpoint('loss-shipless'), 'station');
    expect(facts.activeShipId).toBeNull();
    expect(facts.fit).toEqual([]);
    expect(facts.hold).toEqual([]);
    expect(facts.lastOutcome).toMatchObject({ encounterId: 'encounter.borrell.pirate-base', status: 'lost' });
    expect(facts.loss).toMatchObject({ recovery: 'noShip', siteName: 'Outpost Cradle', encounterName: 'Pirate Base' });
    expect(facts.credits).toBe(facts.loss?.creditsAfter);
  }, GENERATION_TIMEOUT_MS);

  it('refuses a loss checkpoint whose report differs from the save', async () => {
    const lost = checkpointAt(await checkpoint('loss-shipless'), 'station');
    const loss = lost.facts.loss;
    if (loss === null) throw new Error('The shipless checkpoint has no loss.');
    await expect(verifyCheckpoint({ ...lost, facts: { ...lost.facts, loss: { ...loss, recovery: 'granted' } } }, content))
      .rejects.toThrow(/the resumed projection differs/);
  }, GENERATION_TIMEOUT_MS);

  it('refuses a save that no longer matches its content, checksum, format or projection', async () => {
    const inRange = await checkpoint('scout-in-range');
    const site = checkpointAt(inRange, 'site');
    const refused = async (changed: Checkpoint, reason: RegExp): Promise<void> => {
      const failure = await verifyCheckpoint(changed, content).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(CheckpointMismatch);
      expect((failure as Error).message).toMatch(reason);
    };

    await refused(
      { ...inRange, envelope: resealed(inRange.envelope, { contentHash: '0'.repeat(64) }) },
      /names content .* but it is used with/,
    );
    await refused(
      { ...inRange, envelope: { ...inRange.envelope, revision: inRange.envelope.revision + 1 } },
      /checksum/,
    );
    await refused(
      { ...inRange, envelope: resealed(inRange.envelope, { formatVersion: inRange.envelope.formatVersion - 1 }) },
      /the save is format/,
    );
    await refused(
      { ...site, facts: { ...site.facts, firingAt: site.facts.opponentId } },
      /the resumed projection differs/,
    );
    await expect(verifyCheckpoint(inRange, content)).resolves.toBeUndefined();
  });

  it('refuses a docked checkpoint whose wallet or fit differs from the save', async () => {
    const patrol = checkpointAt(await checkpoint('patrol-salvage'), 'station');
    await expect(verifyCheckpoint({ ...patrol, facts: { ...patrol.facts, credits: patrol.facts.credits + 1 } }, content))
      .rejects.toThrow(/the resumed projection differs/);
    const emptied = patrol.facts.fit.map((slot) => (slot.slotKind === 'weapon' ? { ...slot, moduleId: null } : slot));
    await expect(verifyCheckpoint({ ...patrol, facts: { ...patrol.facts, fit: emptied } }, content))
      .rejects.toThrow(/the resumed projection differs/);
  }, GENERATION_TIMEOUT_MS);
});
