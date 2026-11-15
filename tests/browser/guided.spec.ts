import { expect, test, type Locator, type Page } from '@playwright/test';

import { openGameMenu } from '../support/cockpit.ts';
import { dockHome, warpHome, warpTo } from '../support/destinations.ts';
import { applyFit, chooseAmmunition, chooseModule } from '../support/fitting.ts';
import { undock } from '../support/undock.ts';

/**
 * The guided vertical slice (v0.2 Implementation Plan phase 3, item 6;
 * FeatureSpec02 6.2): buy a launcher and guided rounds at the station, fit
 * them beside the starter's autocannon, fly to the Missile Picket, trade
 * guided volleys with the missile boat, close and reopen while rounds are in
 * flight, and come home.
 */

const PILOT = 'Guided Pilot';
const SEED = 'cc33dd44ee55ff6677889900aa11bb22';

async function fixSeed(page: Page): Promise<void> {
  await page.addInitScript((seed: string) => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array && array.length === 16) {
        for (let index = 0; index < 16; index += 1) {
          array[index] = Number.parseInt(seed.slice(index * 2, index * 2 + 2), 16);
        }
        return array;
      }
      return original(array as never) as T;
    }) as typeof crypto.getRandomValues;
  }, SEED);
}

async function freshCampaign(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('galactic-soup');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  await page.getByLabel('Pilot name').fill(PILOT);
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
}

function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

async function ensureRunning(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: /^Resume/ });
  if (await resume.isVisible()) await resume.click();
  await expect(page.getByText(/Running at 1x/)).toBeVisible();
}

async function buy(page: Page, name: string, quantity: number, toHold: boolean): Promise<void> {
  await page.getByRole('button', { name: `Buy ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm purchase' });
  await dialog.getByLabel('Quantity').fill(String(quantity));
  if (toHold) await dialog.getByLabel('Deliver to').selectOption({ label: 'Ship cargo hold' });
  await expect(dialog.getByText('Calculating…')).toBeHidden();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('the guided vertical slice', () => {
  test.beforeEach(async ({ page }) => {
    await fixSeed(page);
    await freshCampaign(page);
  });

  test('buys and fits a launcher, trades guided volleys with the missile boat, reopens in flight and returns [V02-AC-06, V02-AC-13, FUNC-9.6, FUNC-19.3]', async ({
    page,
  }) => {
    test.setTimeout(8 * 60_000);

    // The market says what a launcher and its rounds are for.
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    const table = page.getByRole('table', { name: /items quoted here/ });
    const slugRow = table.getByRole('rowheader', { name: 'Slug Warhead S' }).locator('xpath=..');
    await expect(slugRow.getByText('Loads into Small guided weapons')).toBeVisible();
    await buy(page, 'Guided Launcher S', 1, false);
    await buy(page, 'Slug Warhead S', 40, true);

    // Fit it beside the autocannon: each weapon keeps its own charge.
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await chooseModule(page, 'Weapon 2', 'module.launcher.guided.small');
    await chooseAmmunition(page, 'Weapon 2', 'ammo.guided.small.kinetic');
    await applyFit(page);

    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await undock(page);
    await warpTo(page, 'Missile Picket', 10);
    await ensureRunning(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Signal Spire' })).toBeVisible({ timeout: 60_000 });

    // Lock the missile boat and fire the launcher.
    await region(page, 'In this site').getByRole('button', { name: /Pirate Lancer/ }).click();
    const lock = region(page, 'Navigation').getByRole('button', { name: /^Lock target/ });
    await expect(lock).toBeEnabled({ timeout: 60_000 });
    await lock.click();
    await expect(region(page, 'In this site').getByText('Locked', { exact: true })).toBeVisible({ timeout: 30_000 });

    const weapons = region(page, 'Weapons');
    const launcher = weapons.locator('[data-weapon="weapon:1"]');
    await launcher.getByRole('button', { name: /weapon 2, details/ }).click();
    await expect(launcher.locator('[data-application]')).toBeVisible();
    await expect(launcher.getByText(/against a stationary target/)).toBeVisible();
    await weapons.getByRole('button', { name: /^Fire weapon 2/ }).click();

    // Its projectile flies in the tactical view; the boat's come the other way.
    await expect(page.locator('[data-projectile="outgoing"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-projectile="incoming"]').first()).toBeVisible({ timeout: 60_000 });

    // Close and reopen with rounds in flight: the projectiles come back.
    await openGameMenu(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Signal Spire' })).toBeVisible();
    await expect(page.locator('[data-effect="projectile"]').first()).toBeVisible({ timeout: 30_000 });
    await ensureRunning(page);
    await expect(region(page, 'Weapons').locator('[data-weapon="weapon:1"]')).toBeVisible();

    // Warp out under fire, and dock.
    await warpHome(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({ timeout: 60_000 });
    await dockHome(page);
    await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
  });
});
