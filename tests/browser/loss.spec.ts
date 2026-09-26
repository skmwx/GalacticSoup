import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Losing a ship and coming back from it, in a real browser
 * (MVP Implementation Plan phase 15; MVP-AC-08, FUNC-9.12).
 *
 * The run is the shipped build: the engine in its worker, saves in IndexedDB,
 * simulation time at 1x. A pilot spends most of their credits on a spare gun,
 * flies the starter ship to the hard site and lets it be destroyed. The loss
 * report explains what happened, the insurance pays, and - with too little
 * left to buy the starter ship back - the recovery service supplies a
 * restricted one. The page is then reloaded without closing the campaign, so only the
 * autosave taken at the destruction can bring the post-loss station back. The
 * pilot recovers what survived from the wreck, refits with the spare gun and
 * clears the easiest site again.
 *
 * The client supplies a campaign's seed, so the test fixes the sixteen random
 * bytes that become it. The survival rolls are therefore the same every run -
 * the fitted autocannon is lost and the shield booster survives - and nothing
 * else about the game is changed.
 */

const PILOT = 'Loss Pilot';
const SEED = 'bb22cc33dd44ee55ff6677889900aa11';

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
  if (await resume.isVisible()) {
    await resume.click();
  }
  await expect(page.getByText(/Running at 1x/)).toBeVisible();
}

async function ensurePaused(page: Page): Promise<void> {
  const pause = page.getByRole('button', { name: /^Pause/ });
  if (await pause.isVisible()) {
    await pause.click();
  }
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
}

/** Waits until the last save the frame reports has finished writing. */
async function saved(page: Page): Promise<void> {
  const status = page.getByRole('status', { name: 'Campaign save status' });
  await expect(status).toHaveText(/^Saved at revision [\d,]+\.$/, { timeout: 30_000 });
}

async function buy(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await page.getByRole('button', { name: `Buy ${item}` }).click();
  const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
  await expect(purchase.getByText('Calculating…')).toBeHidden();
  await purchase.getByRole('button', { name: 'Confirm' }).click();
  await expect(purchase).toBeHidden();
}

async function warp(page: Page, arriveAtKm: string, site: string): Promise<void> {
  await page.getByLabel('Arrive at').selectOption(arriveAtKm);
  await page.getByRole('button', { name: /^Warp/ }).click();
  await ensureRunning(page);
  await expect(page.getByRole('heading', { level: 2, name: site })).toBeVisible({ timeout: 60_000 });
}

async function returnAndDock(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Retreat/ }).click();
  await ensureRunning(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: /^Dock/ }).click();
  await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
  await ensurePaused(page);
}

test.describe('losing a ship', () => {
  test.beforeEach(async ({ page }) => {
    await fixSeed(page);
    await freshCampaign(page);
  });

  test('is destroyed, reloads, recovers and clears the easiest site again [MVP-AC-08, FUNC-9.12, FUNC-5.4, FUNC-3.4, FUNC-22.1, MVP-AC-01]', async ({
    page,
  }) => {
    // Three sorties at 1x: the loss, the wreck and the easiest site.
    test.setTimeout(15 * 60_000);

    // A spare gun leaves 8,000 ISK: after the payout, still far below the value
    // of a starter ship with its original fit.
    await buy(page, '200mm Autocannon');
    await expect(page.getByText('8,000 ISK', { exact: true })).toBeVisible();

    // Fly the starter ship to the hard site and do nothing there.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Pirate Base' }).click();
    await expect(page.getByText('Destination: Pirate Base')).toBeVisible();
    await page.getByRole('button', { name: /^Undock/ }).click();
    await expect(page.getByLabel('Destination')).toHaveValue('site.borrell.outpost-cradle');
    await warp(page, '10', 'Outpost Cradle');

    // The destruction is one transaction: the station comes back with the report.
    const report = region(page, 'Ship lost');
    await expect(report).toBeVisible({ timeout: 4 * 60_000 });
    await ensurePaused(page);
    await expect(
      report.getByText(/^Your Wayfarer was destroyed at Outpost Cradle fighting Pirate Base/),
    ).toBeVisible();
    await expect(report.getByRole('rowheader', { name: 'Pirate Gunner' }).first()).toBeVisible();
    await expect(
      report.getByRole('list', { name: 'Lost items' }).getByText('1 x 200mm Autocannon (fitted)'),
    ).toBeVisible();
    await expect(
      report.getByRole('list', { name: 'Lost items' }).getByText('20 x Fusion S (loaded ammunition)'),
    ).toBeVisible();
    await expect(
      report.getByRole('list', { name: 'Surviving items' }).getByText('1 x Small Shield Booster (fitted)'),
    ).toBeVisible();
    await expect(
      report.getByText("Basic insurance paid 3,600 ISK: 30% of the hull's 12,000 ISK reference value."),
    ).toBeVisible();
    await expect(report.getByText(/the recovery service supplied a replacement Wayfarer/)).toBeVisible();
    await expect(page.getByText('11,600 ISK', { exact: true })).toBeVisible();

    // Reload without closing: only the autosave taken at the destruction can
    // bring this station back.
    await saved(page);
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(region(page, 'Ship lost')).toBeVisible();
    await expect(page.getByText('11,600 ISK', { exact: true })).toBeVisible();
    await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible();

    // The replacement is a recovery grant: flown freely, never sold or insured.
    await page.getByRole('button', { name: 'Ship', exact: true }).click();
    await expect(page.getByText('Recovery grant').first()).toBeVisible();

    // Recover the wreck through the ordinary destination flow, without a map.
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await region(page, 'Ship lost').getByRole('button', { name: /^Choose your wreck as the destination/ }).click();
    await expect(
      region(page, 'Ship lost').getByRole('button', { name: /^Your wreck is the destination/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByText('Destination: your wreck at Outpost Cradle')).toBeVisible();
    await page.getByRole('button', { name: /^Undock/ }).click();
    await expect(page.getByLabel('Destination')).toHaveValue(/^bookmark:/);
    await warp(page, '0', 'Outpost Cradle');
    await ensurePaused(page);

    // The warp arrived beside the wreck: take what survived while paused.
    await region(page, 'In this site').getByRole('button', { name: /Wreck/ }).click();
    const wreck = region(page, 'Wreck');
    const takeAll = wreck.getByRole('button', { name: /^Take all/ });
    await expect(takeAll).toBeEnabled({ timeout: 30_000 });
    await takeAll.click();
    await expect(wreck.getByText('The wreck is empty.')).toBeVisible();
    await returnAndDock(page);

    // Refit with the spare gun and carry the spare rounds.
    await page.getByRole('button', { name: 'Hangar', exact: true }).click();
    await expect(
      page.getByRole('table', { name: 'Ship cargo hold' }).getByRole('rowheader', { name: 'Small Shield Booster' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await page.getByRole('button', { name: 'Change fit' }).click();
    await page.getByLabel('Module in Weapon 2').selectOption({ value: 'module.turret.autocannon.small' });
    await page.getByLabel('Ammunition in Weapon 2').selectOption({ value: 'ammo.projectile.small.fusion' });
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
    await expect(page.getByRole('cell', { name: '200mm Autocannon' })).toHaveCount(2);

    await page.getByRole('button', { name: 'Hangar', exact: true }).click();
    const fusion = page.getByRole('table', { name: 'Station hangar' }).getByRole('row', { name: /Fusion S/ });
    await fusion.getByRole('button', { name: 'Move to hold' }).click();
    await expect(
      page.getByRole('table', { name: 'Ship cargo hold' }).getByRole('rowheader', { name: 'Fusion S' }),
    ).toBeVisible();

    // The easiest site, again, with the recovered ship.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
    await expect(page.getByText('Destination: Pirate Scout')).toBeVisible();
    await page.getByRole('button', { name: /^Undock/ }).click();
    await expect(page.getByLabel('Destination')).toHaveValue('site.borrell.verge');
    await warp(page, '10', 'Verge Belt');

    await region(page, 'In this site').getByRole('button', { name: /Pirate Scout/ }).click();
    await page.getByLabel('Range').selectOption('1');
    await page.getByRole('button', { name: /^Orbit/ }).click();
    const lock = region(page, 'Selected').getByRole('button', { name: /^Lock target/ });
    await expect(lock).toBeEnabled({ timeout: 60_000 });
    await lock.click();
    await expect(region(page, 'Locks').getByText('Locked', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const weapons = region(page, 'Weapons');
    await weapons.getByRole('button', { name: /^Fire\s?E$/ }).click();
    await expect(weapons.getByText(/^Firing at Pirate Scout/)).toHaveCount(2);
    await region(page, 'Modules')
      .getByRole('button', { name: /^Activate Small Shield Booster/ })
      .click();
    await expect(region(page, 'Encounter').getByText(/^Site cleared: 3,000 ISK paid/)).toBeVisible({
      timeout: 6 * 60_000,
    });
    await returnAndDock(page);

    const sortie = region(page, 'Last sortie');
    await expect(
      sortie.getByText('Pirate Scout cleared: 1 of 1 opponents destroyed, 3,000 ISK in bounties.'),
    ).toBeVisible();
    // The loss report stays reachable once a later sortie has resolved.
    await expect(region(page, 'Last ship lost')).toBeVisible();
  });
});
