import { describe, expect, it } from 'vitest';

import { createIndexedDbSaveStore } from '@adapters/persistence';
import {
  captureSnapshot,
  createSaveService,
  DEFAULT_SAVE_RETENTION,
  SaveStoreError,
  type SaveEnvelope,
  type SaveKind,
  type SlotManifest,
} from '@engine';

import { testCampaign } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';
import { createFakeIndexedDb, type FakeIndexedDb } from '../../support/fakeIndexedDb.ts';

/**
 * The IndexedDB save store (MVP Implementation Plan phase 20; Functional
 * Specification 3.4; Technical Specification 11.1).
 *
 * This is the adapter the shipped build saves through. The browser suite
 * drives it against a real database for the cases a browser can be put in; a
 * write that runs out of space or is cut short cannot be produced there on
 * request, so those are driven here through an injected factory that fails the
 * write it is told to. What is checked is what the adapter promises: one
 * transaction per save, nothing changed when it fails, and the failure named.
 */

const content = shippedContent();
const SLOT = 'slot-1';

function envelope(sequence: number, kind: SaveKind = 'auto'): SaveEnvelope {
  return captureSnapshot({
    campaign: { ...testCampaign(), revision: sequence },
    content,
    engineVersion: '1.0.0',
    protocolVersion: 1,
    slotId: SLOT,
    kind,
    sequence,
    savedAtRealMs: 1_700_000_000_000 + sequence,
  });
}

function storeOver(database: FakeIndexedDb) {
  return createIndexedDbSaveStore({ factory: database.factory, storageManager: null });
}

/** Everything the database holds for the slot, for a before-and-after comparison. */
function contents(database: FakeIndexedDb): { manifests: unknown; snapshots: string[] } {
  return {
    manifests: database.records('manifests'),
    snapshots: Object.keys(database.records('snapshots')).sort(),
  };
}

describe('IndexedDB save store', () => {
  it('stores a snapshot and its manifest entry, and reads both back [TECH-11.1, TECH-11.2]', async () => {
    const database = createFakeIndexedDb();
    const store = storeOver(database);
    const saved = envelope(1);

    const manifest = await store.write({ envelope: saved, retention: DEFAULT_SAVE_RETENTION });

    expect(manifest.saves.map((save) => save.saveId)).toEqual([saved.saveId]);
    expect(await store.readManifest(SLOT)).toEqual(manifest);
    expect(await store.readSave(SLOT, saved.saveId)).toEqual(saved);
    expect(store.backend).toBe('indexeddb');
  });

  it('answers nothing for an unknown slot or a snapshot of another slot [TECH-11.1]', async () => {
    const database = createFakeIndexedDb();
    const store = storeOver(database);
    const saved = envelope(1);
    await store.write({ envelope: saved, retention: DEFAULT_SAVE_RETENTION });

    expect(await store.readManifest('slot-9')).toBeNull();
    expect(await store.readSave(SLOT, 'slot-1:auto:99')).toBeNull();
    expect(await store.readSave('slot-9', saved.saveId)).toBeNull();
  });

  it('rotates five autosaves and one manual save, one transaction per save [FUNC-3.4, TECH-11.1]', async () => {
    const database = createFakeIndexedDb();
    const store = storeOver(database);

    let manifest: SlotManifest | null = null;
    for (let sequence = 1; sequence <= 7; sequence += 1) {
      manifest = await store.write({ envelope: envelope(sequence), retention: DEFAULT_SAVE_RETENTION });
    }
    for (const sequence of [8, 9]) {
      manifest = await store.write({ envelope: envelope(sequence, 'manual'), retention: DEFAULT_SAVE_RETENTION });
    }

    // The snapshot, the manifest and the removals of one save travel together.
    expect(database.writeTransactions).toBe(9);
    expect(Object.keys(database.records('snapshots')).sort()).toEqual([
      'slot-1:auto:3', 'slot-1:auto:4', 'slot-1:auto:5', 'slot-1:auto:6', 'slot-1:auto:7', 'slot-1:manual:9',
    ]);
    expect(manifest?.saves.map((save) => save.saveId)).toEqual([
      'slot-1:manual:9', 'slot-1:auto:7', 'slot-1:auto:6', 'slot-1:auto:5', 'slot-1:auto:4', 'slot-1:auto:3',
    ]);
    expect(database.records('manifests')[SLOT]).toEqual(manifest);
  });

  it.each([
    ['the snapshot', 'snapshots'],
    ['the manifest', 'manifests'],
    ['the diagnostic record', 'diagnostics'],
  ])('leaves every stored save untouched when the browser runs out of space writing %s [TECH-11.1, TECH-11.3]', async (_label, failingStore) => {
    const database = createFakeIndexedDb();
    const store = storeOver(database);
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      await store.write({ envelope: envelope(sequence), retention: DEFAULT_SAVE_RETENTION });
    }
    const before = contents(database);

    // The sixth autosave would also remove the first; none of it may happen.
    database.failNextWrite({ store: failingStore, errorName: 'QuotaExceededError' });
    const failure = await store
      .write({ envelope: envelope(6), retention: DEFAULT_SAVE_RETENTION })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(SaveStoreError);
    expect((failure as SaveStoreError).reason).toBe('quota');
    expect((failure as SaveStoreError).slotId).toBe(SLOT);
    expect(contents(database)).toEqual(before);
    // The store is still usable once there is room.
    const manifest = await store.write({ envelope: envelope(6), retention: DEFAULT_SAVE_RETENTION });
    expect(manifest.saves[0]?.saveId).toBe('slot-1:auto:6');
    expect(Object.keys(database.records('snapshots'))).not.toContain('slot-1:auto:1');
  });

  it('reports an interrupted write as a failed write, with nothing changed [TECH-11.1]', async () => {
    const database = createFakeIndexedDb();
    const store = storeOver(database);
    await store.write({ envelope: envelope(1), retention: DEFAULT_SAVE_RETENTION });
    const before = contents(database);

    database.failNextWrite({ store: 'manifests', errorName: 'AbortError' });
    const failure = await store
      .write({ envelope: envelope(2), retention: DEFAULT_SAVE_RETENTION })
      .then(() => null, (error: unknown) => error);

    expect((failure as SaveStoreError).reason).toBe('writeFailed');
    expect(contents(database)).toEqual(before);
  });

  it('removes the manifest, the snapshots and the diagnostic record of a cleared slot [FUNC-3.4]', async () => {
    const database = createFakeIndexedDb();
    const store = storeOver(database);
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await store.write({ envelope: envelope(sequence), retention: DEFAULT_SAVE_RETENTION });
    }

    await store.clearSlot(SLOT);

    expect(database.records('manifests')).toEqual({});
    expect(database.records('snapshots')).toEqual({});
    expect(database.records('diagnostics')).toEqual({});
    expect(await store.readManifest(SLOT)).toBeNull();
  });

  it('says so when the browser will not open a database [TECH-11.1, TECH-5.4]', async () => {
    const database = createFakeIndexedDb();
    database.disable();
    const store = storeOver(database);

    const failure = await store.readManifest(SLOT).then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(SaveStoreError);
    expect((failure as SaveStoreError).reason).toBe('unavailable');
  });

  it('reports what the browser says about space, or nothing when it will not say [TECH-11.1]', async () => {
    const database = createFakeIndexedDb();
    const silent = storeOver(database);
    expect(await silent.estimate()).toEqual({ persistent: null, usageBytes: null, quotaBytes: null });
    expect(await silent.requestPersistence()).toBeNull();

    const manager = {
      estimate: () => Promise.resolve({ usage: 900, quota: 1_000 }),
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(true),
    } as unknown as StorageManager;
    const informed = createIndexedDbSaveStore({ factory: database.factory, storageManager: manager });
    expect(await informed.estimate()).toEqual({ persistent: null, usageBytes: 900, quotaBytes: 1_000 });
    expect(await informed.requestPersistence()).toBe(true);
  });
});

describe('saving through the IndexedDB store', () => {
  it('reports a quota failure in the save status and still resumes the previous save [TECH-11.1, TECH-11.3, MVP-AC-01]', async () => {
    const database = createFakeIndexedDb();
    const service = createSaveService({
      store: storeOver(database),
      content,
      engineVersion: '1.0.0',
      protocolVersion: 1,
    });
    const first = { ...testCampaign(), revision: 1 };
    await service.save(first, 'auto', 1);
    await service.drain();
    expect(service.status().state).toBe('saved');

    database.failNextWrite({ store: 'snapshots', errorName: 'QuotaExceededError' });
    await service.save({ ...testCampaign(), revision: 2 }, 'auto', 2);
    await service.drain();

    expect(service.status().state).toBe('failed');
    expect(service.status().error?.messageKey).toBe('error.saveWrite.quota');
    expect(service.status().lastSavedRevision).toBe(1);

    const resumed = await service.resume();
    expect(resumed.ok && resumed.loaded.state.revision).toBe(1);
  });
});
