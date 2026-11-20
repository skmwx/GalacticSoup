import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Setup shared by the browser journeys that start a campaign of their own
 * (Test Suite Optimization Plan phase 10).
 *
 * Every Playwright test runs in a fresh browser context, so its origin has no
 * save database: a new campaign needs one navigation, not a navigation to
 * delete the database and another to load the page again. Tests that exercise
 * storage itself - existing, damaged, incompatible or reset saves - keep their
 * own explicit setup.
 */

/**
 * The sixteen seed bytes the journeys fix, as the checkpoints and the golden
 * campaign do (`CHECKPOINT_SEED`), so a wreck holds the same loot every run.
 */
export const JOURNEY_SEED = 'bb22cc33dd44ee55ff6677889900aa11';

/**
 * Makes the client supply `seed` as the sixteen random bytes that become a new
 * campaign's seed. Nothing else about the game is changed. Call before the
 * first navigation.
 */
export async function fixSeed(page: Page, seed: string = JOURNEY_SEED): Promise<void> {
  await page.addInitScript((bytes: string) => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array && array.length === 16) {
        for (let index = 0; index < 16; index += 1) {
          array[index] = Number.parseInt(bytes.slice(index * 2, index * 2 + 2), 16);
        }
        return array;
      }
      return original(array as never) as T;
    }) as typeof crypto.getRandomValues;
  }, seed);
}

/**
 * Opens the game in the test's fresh context, with one navigation, and starts
 * a campaign for `pilot` at the home station.
 */
export async function freshCampaign(page: Page, pilot: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  // A fresh context: there is nothing to resume.
  await expect(page.getByRole('button', { name: 'Resume campaign' })).toHaveCount(0);
  await page.getByLabel('Pilot name').fill(pilot);
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
}

/**
 * Confirms an open transaction dialog once the engine has priced it: waits for
 * the calculation and an enabled Confirm, confirms, and waits for the dialog
 * to close.
 */
export async function confirmDialog(dialog: Locator): Promise<void> {
  await expect(dialog.getByText('Calculating…')).toBeHidden();
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
}
