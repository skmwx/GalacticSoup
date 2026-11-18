import { expect, type Page } from '@playwright/test';

import { envelopeChecksum, type SaveEnvelope } from '@engine';

import { openGameMenu } from './cockpit.ts';

/**
 * Browser campaign helpers for flows that need a v0.2 hull without earning it
 * (v0.2 Implementation Plan phases 5 and 7).
 *
 * Earning the credits through ordinary play is the career runs' evidence; a
 * browser flow that exercises the hangar, a destroyer or a cruiser tops up the
 * wallet once by rewriting the stored save and sealing it again, then resumes
 * it through the shipped interface.
 */

export const DATABASE = 'galactic-soup';

/** Clears every save, then starts a campaign for `pilot` at the station. */
export async function freshCampaign(page: Page, pilot: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async (name) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
    DATABASE,
  );
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  await page.getByLabel('Pilot name').fill(pilot);
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
  await expect(page.getByText('Saved at revision 1.')).toBeVisible();
}

/** Closes the campaign, adds credits to its latest save and seals it again, then resumes. */
export async function fund(page: Page, credits: number): Promise<void> {
  await openGameMenu(page);
  await page.getByRole('button', { name: /Close campaign/ }).click();
  const latest = await page.evaluate(
    async (name) =>
      new Promise<{ key: string; document: SaveEnvelope }>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => { reject(open.error ?? new Error('The database did not open.')); };
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('snapshots', 'readonly');
          const all = transaction.objectStore('snapshots').getAll();
          transaction.oncomplete = () => {
            database.close();
            const records = all.result as { document: SaveEnvelope }[];
            const newest = records.reduce((most, record) =>
              (record.document.sequence > most.document.sequence ? record : most));
            resolve({ key: newest.document.saveId, document: newest.document });
          };
        };
      }),
    DATABASE,
  );
  const state = latest.document.state as unknown as { assets: { credits: number } };
  state.assets.credits += credits;
  const { checksum: _stale, ...fields } = latest.document;
  void _stale;
  const resealed = { ...fields, checksum: envelopeChecksum(fields) };
  await page.evaluate(
    async ({ name, saveId, document }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => { reject(open.error ?? new Error('The database did not open.')); };
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('snapshots', 'readwrite');
          const store = transaction.objectStore('snapshots');
          const read = store.get(saveId);
          read.onsuccess = () => {
            store.put({ ...(read.result as object), document });
          };
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('The save was not rewritten.')); };
        };
      }),
    { name: DATABASE, saveId: latest.key, document: resealed },
  );
  await page.reload();
  await page.getByRole('button', { name: 'Resume campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
}

/** Buys `quantity` of the market row named `name`, into the hangar or the active ship's hold. */
export async function buy(page: Page, name: string, quantity: number, toHold = false): Promise<void> {
  await page.getByRole('button', { name: `Buy ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm purchase' });
  await dialog.getByLabel('Quantity').fill(String(quantity));
  if (toHold) await dialog.getByLabel('Deliver to').selectOption({ label: 'Ship cargo hold' });
  await expect(dialog.getByText('Calculating…')).toBeHidden();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toBeHidden();
}
