import { describe, expect, it } from 'vitest';

import { envelopeChecksum, type SaveEnvelope } from '@engine';

import {
  CHECKPOINT_NAMES,
  CheckpointMismatch,
  prepareCheckpoint,
  verifyCheckpoint,
  type Checkpoint,
} from '../support/checkpoint/scenarios.ts';
import { shippedContent } from '../support/content.ts';

/**
 * The browser checkpoints (Test Suite Optimization Plan phase 3): each one is
 * reached through the protocol, is the same save every time it is made, says
 * what it promises, and is refused when its save no longer matches.
 */

const content = shippedContent();

/** Reseals an envelope after a change, so only the changed field differs. */
function resealed(envelope: SaveEnvelope, change: Partial<SaveEnvelope>): SaveEnvelope {
  const { checksum: _checksum, ...fields } = { ...envelope, ...change };
  return { ...fields, checksum: envelopeChecksum(fields) };
}

describe('browser checkpoints', () => {
  for (const name of CHECKPOINT_NAMES) {
    it(`makes "${name}" the same save every time [TECH-11.4]`, async () => {
      const first = await prepareCheckpoint(name, content);
      const second = await prepareCheckpoint(name, content);
      expect(second.envelope.checksum).toBe(first.envelope.checksum);
      expect(second.facts).toEqual(first.facts);
      expect(first.facts.paused).toBe(true);
      expect(first.facts.siteId).toBe('site.borrell.verge');
      expect(first.facts.opponentWithinLockRange).toBe(true);
    });
  }

  it('leaves the scout unlocked and unfired on in range, and in a running fight', async () => {
    const inRange = await prepareCheckpoint('scout-in-range', content);
    expect(inRange.facts.locks).toEqual([]);
    expect(inRange.facts.firingAt).toBeNull();

    const fight = await prepareCheckpoint('scout-fight', content);
    expect(fight.facts.locks).toEqual([{ targetId: fight.facts.opponentId, status: 'locked' }]);
    expect(fight.facts.firingAt).toBe(fight.facts.opponentId);
    expect(fight.facts.boosterActive).toBe(true);
  });

  it('refuses a save that no longer matches its content, checksum, format or projection', async () => {
    const checkpoint = await prepareCheckpoint('scout-in-range', content);
    const refused = async (changed: Checkpoint, reason: RegExp): Promise<void> => {
      const failure = await verifyCheckpoint(changed, content).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(CheckpointMismatch);
      expect((failure as Error).message).toMatch(reason);
    };

    await refused(
      { ...checkpoint, envelope: resealed(checkpoint.envelope, { contentHash: '0'.repeat(64) }) },
      /names content .* but it is used with/,
    );
    await refused(
      { ...checkpoint, envelope: { ...checkpoint.envelope, revision: checkpoint.envelope.revision + 1 } },
      /checksum/,
    );
    await refused(
      { ...checkpoint, envelope: resealed(checkpoint.envelope, { formatVersion: checkpoint.envelope.formatVersion - 1 }) },
      /the save is format/,
    );
    await refused(
      { ...checkpoint, facts: { ...checkpoint.facts, firingAt: checkpoint.facts.opponentId } },
      /the resumed projection differs/,
    );
    await expect(verifyCheckpoint(checkpoint, content)).resolves.toBeUndefined();
  });
});
