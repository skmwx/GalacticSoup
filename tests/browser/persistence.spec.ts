import { expect, test, type Page } from '@playwright/test';

import { DEFAULT_SAVE_RETENTION, SAVE_FORMAT_VERSION } from '@engine';

/**
 * Save integrity in a real browser (MVP Implementation Plan phase 20;
 * Functional Specification 3.4; Technical Specification 11.1, 11.4).
 *
 * The headless suites prove rotation, damage, version and quota handling
 * against the in-memory store. The shipped build stores through IndexedDB in
 * the dedicated worker, so the same cases are driven here through the real
 * one: the page reads and damages the database the way a failed disk or
 * another build would have left it, and the game is then asked to carry on.
 *
 * A browser cannot be made to run out of space on request - the DevTools quota
 * override is ignored for a test context - so a write that fails for lack of
 * room is driven through the same adapter with an injected factory, in
 * `tests/unit/persistence/indexedDbSaveStore.test.ts`.
 */

const PILOT = 'Vela Trask';
const DATABASE = 'galactic-soup';

interface StoredSave {
  readonly saveId: string;
  readonly kind: string;
  readonly sequence: number;
  readonly revision: number;
  readonly formatVersion: number;
  readonly checksum: string;
}

interface StoredSlot {
  /** Snapshot records in the store, by sequence. */
  readonly snapshots: readonly StoredSave[];
  /** Save ids the manifest names, newest first. */
  readonly listed: readonly string[];
}

async function clearSaves(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async (name) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => { resolve(); };
        request.onerror = () => { resolve(); };
        request.onblocked = () => { resolve(); };
      }),
    DATABASE,
  );
}

async function startCampaign(page: Page): Promise<void> {
  await page.getByLabel('Pilot name').fill(PILOT);
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
  await expect(page.getByText('Saved at revision 1.')).toBeVisible();
}

/** What the database holds, read through a connection of the page's own. */
async function storedSlot(page: Page): Promise<StoredSlot> {
  return page.evaluate(
    async (name) =>
      new Promise<StoredSlot>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => { reject(open.error ?? new Error('The database did not open.')); };
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction(['snapshots', 'manifests'], 'readonly');
          const snapshots = transaction.objectStore('snapshots').getAll();
          const manifests = transaction.objectStore('manifests').getAll();
          transaction.oncomplete = () => {
            database.close();
            const documents = (snapshots.result as { document: StoredSave }[]).map((record) => record.document);
            const manifest = (manifests.result as { saves: { saveId: string }[] }[])[0];
            resolve({
              snapshots: documents
                .map(({ saveId, kind, sequence, revision, formatVersion, checksum }) =>
                  ({ saveId, kind, sequence, revision, formatVersion, checksum }))
                .sort((left, right) => left.sequence - right.sequence),
              listed: manifest?.saves.map((save) => save.saveId) ?? [],
            });
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error('The database could not be read.'));
          };
        };
      }),
    DATABASE,
  );
}

/** Rewrites stored snapshots in place, as damage or another build would. */
async function damage(page: Page, saveIds: readonly string[], change: 'credits' | 'newerFormat'): Promise<void> {
  await page.evaluate(
    async ({ name, ids, kind }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => { reject(open.error ?? new Error('The database did not open.')); };
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('snapshots', 'readwrite');
          const store = transaction.objectStore('snapshots');
          for (const saveId of ids) {
            const read = store.get(saveId);
            read.onsuccess = () => {
              const record = read.result as {
                document: { formatVersion: number; state: { assets: { credits: number } } };
              };
              if (kind === 'newerFormat') record.document.formatVersion = 99;
              else record.document.state.assets.credits += 1_000_000;
              store.put(record);
            };
          }
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error('The snapshot could not be rewritten.'));
          };
        };
      }),
    { name: DATABASE, ids: [...saveIds], kind: change },
  );
}

async function closeAndResume(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Close campaign/ }).click();
  await page.getByRole('button', { name: 'Resume campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
}

test.describe('save integrity in the browser', () => {
  test.beforeEach(async ({ page }) => {
    await clearSaves(page);
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  });

  test('keeps five rolling autosaves and one manual save, each written whole [FUNC-3.4, TECH-11.1]', async ({ page }) => {
    await startCampaign(page);

    // Creating wrote the first autosave; every close writes another.
    for (let round = 0; round < DEFAULT_SAVE_RETENTION.autosaves + 1; round += 1) {
      await closeAndResume(page);
    }
    for (let round = 0; round < 2; round += 1) {
      const before = (await storedSlot(page)).snapshots.at(-1)?.sequence ?? 0;
      await page.getByRole('button', { name: /Save now/ }).click();
      await expect.poll(async () => (await storedSlot(page)).snapshots.at(-1)?.sequence ?? 0).toBeGreaterThan(before);
    }

    const slot = await storedSlot(page);
    const autosaves = slot.snapshots.filter((save) => save.kind === 'auto');
    const manual = slot.snapshots.filter((save) => save.kind === 'manual');
    expect(autosaves).toHaveLength(DEFAULT_SAVE_RETENTION.autosaves);
    expect(manual).toHaveLength(DEFAULT_SAVE_RETENTION.manual);
    // The oldest autosaves were the ones dropped, and the newest manual save replaced the first.
    expect(autosaves.map((save) => save.sequence)).toEqual([3, 4, 5, 6, 7]);
    expect(manual[0]?.sequence).toBe(9);
    // The manifest names exactly the snapshots that exist: no orphan, no dangling entry.
    expect([...slot.listed].sort()).toEqual(slot.snapshots.map((save) => save.saveId).sort());
    expect(slot.listed[0]).toBe(manual[0]?.saveId);
    expect(slot.snapshots.every((save) => save.formatVersion === SAVE_FORMAT_VERSION)).toBe(true);
  });

  test('falls back to the last valid snapshot when the newest is damaged, and leaves the damaged one alone [TECH-11.1, TECH-11.4, MVP-AC-01]', async ({ page }) => {
    await startCampaign(page);
    // Let the clock run so the second snapshot is a later state than the first.
    await page.getByRole('button', { name: /Resume/ }).click();
    await expect(page.getByText('0s', { exact: true })).toBeHidden({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Pause/ }).click();
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();

    const before = await storedSlot(page);
    expect(before.snapshots).toHaveLength(2);
    const [first, newest] = before.snapshots;
    if (first === undefined || newest === undefined) throw new Error('Two snapshots were expected.');
    expect(newest.revision).toBeGreaterThan(first.revision);

    await damage(page, [newest.saveId], 'credits');
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();

    // The campaign that opens is the first snapshot: no simulation time has passed in it.
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
    await expect(page.getByText('0s', { exact: true })).toBeVisible();
    await expect(page.getByText('20,000', { exact: false }).first()).toBeVisible();

    // Nothing was repaired or removed on the way.
    const after = await storedSlot(page);
    expect(after.snapshots.map((save) => save.saveId)).toEqual(before.snapshots.map((save) => save.saveId));
    expect(after.snapshots.map((save) => save.checksum)).toEqual(before.snapshots.map((save) => save.checksum));
  });

  test('refuses a save written by a newer format, says why, and does not touch it [TECH-11.4, FUNC-22.10]', async ({ page }) => {
    await startCampaign(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();

    const before = await storedSlot(page);
    await damage(page, before.snapshots.map((save) => save.saveId), 'newerFormat');
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();

    await expect(page.getByRole('alert')).toContainText(
      `newer version of the game (save format 99; this build reads ${String(SAVE_FORMAT_VERSION)})`,
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toHaveCount(0);
    // A new campaign can still be started from here.
    await expect(page.getByLabel('Pilot name')).toBeVisible();

    const after = await storedSlot(page);
    expect(after.snapshots.map((save) => save.formatVersion)).toEqual(before.snapshots.map(() => 99));
    expect(after.listed).toEqual(before.listed);
  });
});
