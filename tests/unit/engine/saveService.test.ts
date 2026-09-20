import { describe, expect, it } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import {
  campaignStateHash,
  createSaveService,
  SaveStoreError,
  type SaveService,
  type SaveStore,
} from '@engine';
import { PROTOCOL_VERSION } from '@protocol';

import { testCampaign } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * Save orchestration (Technical Specification 11.1, 11.3).
 *
 * The service decides when a snapshot exists, keeps writes in revision order,
 * coalesces redundant interval saves, and reports a failure without ever
 * making the campaign depend on storage.
 */

const content = shippedContent();

function serviceOn(store: SaveStore): SaveService {
  return createSaveService({
    store,
    content,
    engineVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
  });
}

function withStore(): { store: MemorySaveStore; service: SaveService } {
  const store = createMemorySaveStore();
  return { store, service: serviceOn(store) };
}

/**
 * A store whose first write is held open, so captures pile up behind it and
 * the queue's coalescing rule can be observed rather than raced.
 */
function holdingStore(): {
  store: SaveStore;
  written: number[];
  kinds: string[];
  release: () => void;
} {
  const base = createMemorySaveStore();
  const written: number[] = [];
  const kinds: string[] = [];
  let open: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });

  const store: SaveStore = {
    ...base,
    async write(request) {
      written.push(request.envelope.revision);
      kinds.push(request.envelope.kind);
      await gate;
      return base.write(request);
    },
  };

  return {
    store,
    written,
    kinds,
    release: () => {
      open?.();
    },
  };
}

describe('save service', () => {
  it('starts with nothing to resume [MVP-AC-01, TECH-11.1]', async () => {
    const { service } = withStore();
    const slot = await service.slot();

    expect(slot.saveCount).toBe(0);
    expect(slot.resumable).toBeNull();
    expect(slot.status.state).toBe('idle');
    expect(slot.status.backend).toBe('memory');
  });

  it('captures at the revision it was asked about and writes it [TECH-11.3]', async () => {
    const { service } = withStore();
    const campaign = { ...testCampaign(), revision: 7 };

    const pending = await service.save(campaign, 'auto', 1_700_000_000_000);
    expect(pending.state).toBe('pending');
    expect(pending.pendingWrites).toBeGreaterThan(0);

    await service.drain();
    const slot = await service.slot();

    expect(slot.status.state).toBe('saved');
    expect(slot.status.lastSavedRevision).toBe(7);
    expect(slot.status.lastSaveKind).toBe('auto');
    expect(slot.resumable?.revision).toBe(7);
    expect(slot.resumable?.contentMatches).toBe(true);
  });

  it('resumes the campaign it stored, unchanged [MVP-AC-01, TECH-9.5, TECH-11.4]', async () => {
    const { service } = withStore();
    const campaign = testCampaign();

    await service.save(campaign, 'auto', 1_700_000_000_000);
    await service.drain();

    const resumed = await service.resume();

    expect(resumed.ok).toBe(true);
    expect(resumed.ok && campaignStateHash(resumed.loaded.state)).toBe(
      campaignStateHash(campaign),
    );
  });

  it('coalesces interval saves queued behind a slower one [TECH-11.3]', async () => {
    const held = holdingStore();
    const service = serviceOn(held.store);

    // The first write is still in flight, so the two captures behind it are
    // redundant: only the newest of the kind is worth writing.
    await service.save({ ...testCampaign(), revision: 1 }, 'auto', 1);
    await service.save({ ...testCampaign(), revision: 2 }, 'auto', 2);
    await service.save({ ...testCampaign(), revision: 3 }, 'auto', 3);
    held.release();
    await service.drain();

    expect(held.written).toEqual([1, 3]);
  });

  it('never coalesces a manual save into an autosave [FUNC-3.4]', async () => {
    const held = holdingStore();
    const service = serviceOn(held.store);

    await service.save({ ...testCampaign(), revision: 1 }, 'auto', 1);
    await service.save({ ...testCampaign(), revision: 2 }, 'auto', 2);
    await service.save({ ...testCampaign(), revision: 2 }, 'manual', 3);
    held.release();
    await service.drain();

    expect(held.written).toEqual([1, 2, 2]);
    expect(held.kinds).toEqual(['auto', 'auto', 'manual']);
  });

  it('writes in revision order [TECH-11.3]', async () => {
    const written: number[] = [];
    const store = createMemorySaveStore({
      beforeWrite: (request) => {
        written.push(request.envelope.revision);
      },
    });
    const service = serviceOn(store);

    for (const revision of [1, 2, 3, 4]) {
      await service.save({ ...testCampaign(), revision }, 'auto', revision);
      await service.drain();
    }

    expect(written).toEqual([...written].sort((a, b) => a - b));
  });

  it('reports a quota failure and keeps the previous save [TECH-11.1]', async () => {
    let refuse = false;
    const store = createMemorySaveStore({
      beforeWrite: () => {
        if (refuse) {
          throw new SaveStoreError('quota', 'No space.', 'slot-1');
        }
      },
    });
    const service = serviceOn(store);

    await service.save({ ...testCampaign(), revision: 1 }, 'auto', 1);
    await service.drain();

    refuse = true;
    await service.save({ ...testCampaign(), revision: 2 }, 'auto', 2);
    await service.drain();

    const slot = await service.slot();
    expect(slot.status.state).toBe('failed');
    expect(slot.status.error?.code).toBe('QUOTA_ERROR');
    // The campaign is still resumable at the revision that did get written.
    const resumed = await service.resume();
    expect(resumed.ok && resumed.loaded.state.revision).toBe(1);
  });

  it('falls back to the previous snapshot when the newest is damaged [TECH-11.1, TECH-11.4]', async () => {
    const { store, service } = withStore();

    await service.save({ ...testCampaign(), revision: 1 }, 'auto', 1);
    await service.drain();
    await service.save({ ...testCampaign(), revision: 2 }, 'auto', 2);
    await service.drain();

    store.replace('slot-1:auto:2', { format: 'galactic-soup/save', nonsense: true });

    const resumed = await service.resume();

    expect(resumed.ok).toBe(true);
    expect(resumed.ok && resumed.loaded.state.revision).toBe(1);
  });

  it('falls back when the manifest names a snapshot that is gone [TECH-11.1]', async () => {
    const { store, service } = withStore();

    await service.save({ ...testCampaign(), revision: 1 }, 'auto', 1);
    await service.drain();
    await service.save({ ...testCampaign(), revision: 2 }, 'auto', 2);
    await service.drain();

    store.dropSnapshot('slot-1:auto:2');

    const resumed = await service.resume();

    expect(resumed.ok).toBe(true);
    expect(resumed.ok && resumed.loaded.state.revision).toBe(1);
  });

  it('says plainly when there is nothing to resume [FUNC-22.10]', async () => {
    const { service } = withStore();
    const resumed = await service.resume();

    expect(resumed.ok).toBe(false);
    expect(resumed.ok ? '' : resumed.error.messageKey).toBe('error.ruleViolation.noResumableSave');
  });

  it('refuses every damaged snapshot rather than guessing [TECH-11.4]', async () => {
    const { store, service } = withStore();
    await service.save(testCampaign(), 'auto', 1);
    await service.drain();
    store.replace('slot-1:auto:1', { format: 'galactic-soup/save' });

    const resumed = await service.resume();

    expect(resumed.ok).toBe(false);
    expect(resumed.ok ? '' : resumed.error.code).toBe('INTEGRITY_ERROR');
  });

  it('clears the slot and starts its sequence again [FUNC-3.4]', async () => {
    const { store, service } = withStore();
    await service.save(testCampaign(), 'auto', 1);
    await service.drain();

    await service.clear();

    expect(store.saveIds()).toEqual([]);
    const slot = await service.slot();
    expect(slot.saveCount).toBe(0);
    expect(slot.status.state).toBe('idle');
    expect(slot.status.lastSavedRevision).toBeNull();
  });

  it('warns when the browser is nearly out of space [TECH-11.1]', async () => {
    const store = createMemorySaveStore({
      persistence: false,
      storage: { persistent: false, usageBytes: 95, quotaBytes: 100 },
    });
    const slot = await serviceOn(store).slot();

    expect(slot.status.storage.lowSpace).toBe(true);
    expect(slot.status.storage.persistent).toBe(false);
  });

  it('does not warn when there is room [TECH-11.1]', async () => {
    const store = createMemorySaveStore({
      persistence: true,
      storage: { persistent: true, usageBytes: 5, quotaBytes: 100 },
    });
    const slot = await serviceOn(store).slot();

    expect(slot.status.storage.lowSpace).toBe(false);
  });

  it('continues without space figures when the browser will not answer [TECH-11.1]', async () => {
    const store: SaveStore = {
      ...createMemorySaveStore(),
      estimate: () => Promise.reject(new Error('no')),
      requestPersistence: () => Promise.reject(new Error('no')),
    };
    const slot = await serviceOn(store).slot();

    expect(slot.status.storage).toEqual({
      persistent: null,
      usageBytes: null,
      quotaBytes: null,
      lowSpace: false,
    });
  });
});
