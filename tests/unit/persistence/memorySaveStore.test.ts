import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import {
  captureSnapshot,
  DEFAULT_SAVE_RETENTION,
  SaveStoreError,
  type SaveEnvelope,
} from '@engine';

import { testCampaign } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * The save store contract (Technical Specification 11.1).
 *
 * The rule every store must keep is that a failed write changes nothing: the
 * previous manifest and every snapshot it names survive, so the player can
 * still resume what they had.
 */

const content = shippedContent();

function envelope(sequence: number): SaveEnvelope {
  return captureSnapshot({
    campaign: { ...testCampaign(), revision: sequence },
    content,
    engineVersion: '1.0.0',
    protocolVersion: 1,
    slotId: 'slot-1',
    kind: 'auto',
    sequence,
    savedAtRealMs: 1_700_000_000_000 + sequence,
  });
}

describe('memory save store', () => {
  it('reads back exactly what it was given [TECH-11.1]', async () => {
    const store = createMemorySaveStore();
    const written = envelope(1);

    await store.write({ envelope: written, retention: DEFAULT_SAVE_RETENTION });

    expect(await store.readSave('slot-1', written.saveId)).toEqual(written);
    expect((await store.readManifest('slot-1'))?.saves[0]?.saveId).toBe(written.saveId);
  });

  it('hands out copies rather than its own records [TECH-11.1]', async () => {
    const store = createMemorySaveStore();
    const written = envelope(1);
    await store.write({ envelope: written, retention: DEFAULT_SAVE_RETENTION });

    const first = (await store.readSave('slot-1', written.saveId)) as Record<string, unknown>;
    first['revision'] = 999;

    expect((await store.readSave('slot-1', written.saveId)) as SaveEnvelope).toEqual(written);
  });

  it('answers nothing for an unknown slot or save [TECH-11.1]', async () => {
    const store = createMemorySaveStore();
    await store.write({ envelope: envelope(1), retention: DEFAULT_SAVE_RETENTION });

    expect(await store.readManifest('slot-2')).toBeNull();
    expect(await store.readSave('slot-2', 'slot-1:auto:1')).toBeNull();
    expect(await store.readSave('slot-1', 'slot-1:auto:9')).toBeNull();
  });

  it('leaves the previous save intact when a write runs out of space [TECH-11.1]', async () => {
    let refuse = false;
    const store = createMemorySaveStore({
      beforeWrite: () => {
        if (refuse) {
          throw new SaveStoreError('quota', 'No space.', 'slot-1');
        }
      },
    });

    const first = envelope(1);
    await store.write({ envelope: first, retention: DEFAULT_SAVE_RETENTION });
    const manifestBefore = await store.readManifest('slot-1');

    refuse = true;
    await expect(
      store.write({ envelope: envelope(2), retention: DEFAULT_SAVE_RETENTION }),
    ).rejects.toBeInstanceOf(SaveStoreError);

    expect(await store.readManifest('slot-1')).toEqual(manifestBefore);
    expect(await store.readSave('slot-1', first.saveId)).toEqual(first);
    expect(store.saveIds()).toEqual([first.saveId]);
  });

  it('rotates in one step, never between a manifest and its snapshots [TECH-11.1]', async () => {
    const store = createMemorySaveStore();
    for (const sequence of [1, 2, 3, 4, 5, 6]) {
      await store.write({ envelope: envelope(sequence), retention: DEFAULT_SAVE_RETENTION });
    }

    const manifest = await store.readManifest('slot-1');
    const named = manifest?.saves.map((save) => save.saveId) ?? [];

    expect(named).toHaveLength(5);
    expect([...store.saveIds()].sort()).toEqual([...named].sort());
  });

  it('forgets everything in a cleared slot [FUNC-3.4]', async () => {
    const store = createMemorySaveStore();
    await store.write({ envelope: envelope(1), retention: DEFAULT_SAVE_RETENTION });

    await store.clearSlot('slot-1');

    expect(await store.readManifest('slot-1')).toBeNull();
    expect(store.saveIds()).toEqual([]);
  });

  it('reports what the browser said about space [TECH-11.1]', async () => {
    const store = createMemorySaveStore({
      persistence: true,
      storage: { persistent: true, usageBytes: 10, quotaBytes: 100 },
    });

    expect(await store.requestPersistence()).toBe(true);
    expect(await store.estimate()).toEqual({ persistent: true, usageBytes: 10, quotaBytes: 100 });
  });
});
