import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The first end-to-end vertical slice in a real browser
 * (MVP Implementation Plan phase 14; MVP-AC-02, MVP-AC-03, MVP-AC-04,
 * MVP-AC-06, MVP-AC-09).
 *
 * The loop runs against the shipped build: the engine in its worker, saves in
 * IndexedDB, simulation time at 1x. A player prepares at the station, flies to
 * the easiest site, fights it with the ordinary commands, loots the wreck,
 * comes home, turns the rewards into a better fit and wins again with it. The
 * campaign is saved and reopened once in the middle of the fight and once
 * after the rewards were converted.
 *
 * The client supplies a campaign's seed, so the test fixes the sixteen random
 * bytes that become it. That makes the wreck's contents the same every run;
 * nothing else about the game is changed.
 */

const PILOT = 'Slice Pilot';
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

function scoutEntry(page: Page): Locator {
  return region(page, 'In this site').getByRole('button', { name: /Pirate Scout/ });
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

async function reopen(page: Page, heading: string): Promise<void> {
  await page.getByRole('button', { name: /Close campaign/ }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
}

/** Carries the spare rounds, chooses the scout site and undocks. */
async function prepareAndUndock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hangar', exact: true }).click();
  const hangar = page.getByRole('table', { name: 'Station hangar' });
  const fusion = hangar.getByRole('row', { name: /Fusion S/ });
  if (await fusion.count() > 0) {
    await fusion.getByRole('button', { name: 'Move to hold' }).click();
    await expect(
      page.getByRole('table', { name: 'Ship cargo hold' }).getByRole('rowheader', { name: 'Fusion S' }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Departure', exact: true }).click();
  const choose = page.getByRole('button', { name: 'Choose Pirate Scout' });
  if ((await choose.count()) > 0 && (await choose.isEnabled())) {
    await choose.click();
  }
  await expect(page.getByText('Destination: Pirate Scout')).toBeVisible();
  await page.getByRole('button', { name: /^Undock/ }).click();
  await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
}

async function flyToScout(page: Page): Promise<void> {
  // The destination chosen at the station is already the warp destination.
  await expect(page.getByLabel('Destination')).toHaveValue('site.borrell.verge');
  await page.getByLabel('Arrive at').selectOption('10');
  await page.getByRole('button', { name: /^Warp/ }).click();
  await ensureRunning(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Verge Belt' })).toBeVisible({
    timeout: 60_000,
  });
}

/** Orbits the scout, locks it, opens fire and runs the shield booster. */
async function engageScout(page: Page): Promise<void> {
  await scoutEntry(page).click();
  await page.getByLabel('Range').selectOption('1');
  await page.getByRole('button', { name: /^Orbit/ }).click();

  const lock = region(page, 'Selected').getByRole('button', { name: /^Lock target/ });
  await expect(lock).toBeEnabled({ timeout: 60_000 });
  await lock.click();
  await expect(region(page, 'Locks').getByText('Locked', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const weapons = region(page, 'Weapons');
  await expect(weapons.getByText('Aimed at Pirate Scout')).toBeVisible();
  await weapons.getByRole('button', { name: /^Fire\s?E$/ }).click();
  await expect(weapons.getByText(/^Firing at Pirate Scout/).first()).toBeVisible();
  await region(page, 'Modules')
    .getByRole('button', { name: /^Activate Small Shield Booster/ })
    .click();
  await expect(
    region(page, 'Modules').getByRole('button', { name: /^Deactivate Small Shield Booster/ }),
  ).toBeVisible();
}

async function waitForClearedSite(page: Page): Promise<void> {
  await expect(region(page, 'Encounter').getByText(/^Site cleared: 3,000 ISK paid/)).toBeVisible({
    timeout: 6 * 60_000,
  });
}

/** Opens the scout's wreck, flies into reach if needed and takes everything. */
async function lootWreck(page: Page): Promise<void> {
  await region(page, 'In this site').getByRole('button', { name: /Wreck/ }).click();
  const wreck = region(page, 'Wreck');
  const takeAll = wreck.getByRole('button', { name: /^Take all/ });
  if (!(await takeAll.isVisible())) {
    await wreck.getByRole('button', { name: /^Approach to open/ }).click();
  }
  await expect(takeAll).toBeEnabled({ timeout: 60_000 });
  await takeAll.click();
  await expect(wreck.getByText('The wreck is empty.')).toBeVisible();
}

async function returnAndDock(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Retreat/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: /^Dock/ }).click();
  await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
  await ensurePaused(page);
}

test.describe('the first vertical slice', () => {
  test.beforeEach(async ({ page }) => {
    await fixSeed(page);
    await freshCampaign(page);
  });

  test('clears the easiest site, converts the rewards and clears it again with a better fit [MVP-AC-02, MVP-AC-03, MVP-AC-04, MVP-AC-06, MVP-AC-09, MVP-AC-01]', async ({
    page,
  }) => {
    // Two sorties at 1x, each with warps, a fight and a docking cycle.
    test.setTimeout(15 * 60_000);

    await prepareAndUndock(page);
    await flyToScout(page);
    await engageScout(page);

    // Close and reopen in the middle of the fight: the lock, the running
    // guns and the booster come back exactly as they were.
    await expect(region(page, 'Combat log').locator('[data-event="damage"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await reopen(page, 'Verge Belt');
    await expect(region(page, 'Locks').getByText('Locked', { exact: true })).toBeVisible();
    await expect(region(page, 'Weapons').getByText(/^Firing at Pirate Scout/).first()).toBeVisible();
    await expect(
      region(page, 'Modules').getByRole('button', { name: /^Deactivate Small Shield Booster/ }),
    ).toBeVisible();
    await ensureRunning(page);

    await waitForClearedSite(page);
    await lootWreck(page);
    await returnAndDock(page);

    // The rewards are home: the bounty in the wallet, the loot in the hold.
    const sortie = region(page, 'Last sortie');
    await expect(
      sortie.getByText('Pirate Scout cleared: 1 of 1 opponents destroyed, 3,000 ISK in bounties.'),
    ).toBeVisible();
    await expect(sortie.getByText('2 x Burned Alloy Plate')).toBeVisible();
    await expect(page.getByText('23,000 ISK', { exact: true })).toBeVisible();

    // Sell the loot, buy a second gun and fit it.
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Sell Burned Alloy Plate' }).click();
    const sale = page.getByRole('dialog', { name: 'Confirm sale' });
    await sale.getByRole('button', { name: 'Confirm' }).click();
    await expect(sale).toBeHidden();
    await expect(page.getByText('23,000 ISK', { exact: true })).toBeHidden();

    await page.getByRole('button', { name: 'Buy 200mm Autocannon' }).click();
    const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
    await purchase.getByRole('button', { name: 'Confirm' }).click();
    await expect(purchase).toBeHidden();

    // Two guns fire twice as many rounds: restock the hold as well.
    await page.getByRole('button', { name: 'Buy Fusion S' }).click();
    const rounds = page.getByRole('dialog', { name: 'Confirm purchase' });
    await rounds.getByLabel('Quantity').fill('200');
    await rounds.getByLabel('Deliver to').selectOption({ label: 'Ship cargo hold' });
    await expect(rounds.getByText('Calculating…')).toBeHidden();
    await expect(rounds.getByText(/200 × Fusion S/).first()).toBeVisible();
    await rounds.getByRole('button', { name: 'Confirm' }).click();
    await expect(rounds).toBeHidden();

    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await page.getByRole('button', { name: 'Change fit' }).click();
    await page.getByLabel('Module in Weapon 2').selectOption({ value: 'module.turret.autocannon.small' });
    await page.getByLabel('Ammunition in Weapon 2').selectOption({ value: 'ammo.projectile.small.fusion' });
    await page.getByLabel('Ammunition in Weapon 1').selectOption({ value: 'ammo.projectile.small.fusion' });
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
    await expect(page.getByRole('cell', { name: '200mm Autocannon' })).toHaveCount(2);

    // Top the magazines up, if the fight left any short.
    await page.getByRole('button', { name: 'Services', exact: true }).click();
    await page.getByRole('button', { name: 'Resupply ammunition' }).click();
    const resupply = page.getByRole('dialog', { name: 'Confirm resupply' });
    await expect(resupply.getByText('Calculating…')).toBeHidden();
    const confirm = resupply.getByRole('button', { name: 'Confirm' });
    if (await confirm.isEnabled()) {
      await confirm.click();
    } else {
      await resupply.getByRole('button', { name: 'Cancel' }).click();
    }
    await expect(resupply).toBeHidden();

    // Close and reopen after converting the rewards: the wallet and the fit
    // are what the conversion left.
    const wallet = await page.locator('dd').filter({ hasText: /ISK$/ }).first().innerText();
    await reopen(page, 'Borrell Harbour');
    await expect(page.locator('dd').filter({ hasText: /ISK$/ }).first()).toHaveText(wallet);
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await expect(page.getByRole('cell', { name: '200mm Autocannon' })).toHaveCount(2);

    // The site is still offered, says it has been cleared, and is fought again
    // with both guns.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(
      page.locator('[data-disclosure="encounter.borrell.pirate-scout"]').getByText('Cleared 1 times'),
    ).toBeVisible();
    await prepareAndUndock(page);
    await flyToScout(page);
    await engageScout(page);
    await expect(
      region(page, 'Weapons').getByRole('heading', { name: '2 x 200mm Autocannon - Fusion S' }),
    ).toBeVisible();
    await expect(region(page, 'Weapons').getByText(/^Firing at Pirate Scout/)).toHaveCount(2);
    await waitForClearedSite(page);
    await returnAndDock(page);

    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(
      page.locator('[data-disclosure="encounter.borrell.pirate-scout"]').getByText('Cleared 2 times'),
    ).toBeVisible();
  });
});

test.describe('combat commands', () => {
  test.beforeEach(async ({ page }) => {
    await fixSeed(page);
    await freshCampaign(page);
    await prepareAndUndock(page);
  });

  test('commands a fight with the mouse alone [MVP-AC-03, FUNC-19.2, FUNC-20]', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await flyToScout(page);

    // Paused, the drawing holds still, and orders can still be given.
    await ensurePaused(page);
    const scoutId = await scoutEntry(page).getAttribute('data-object-entry');
    const scout = page.locator(`[data-layer="hits"] [data-object-id="${scoutId ?? ''}"]`);
    const menu = page.getByRole('group', { name: 'Commands for Pirate Scout' });

    // A secondary click on the ship in the view opens its commands.
    await scout.click({ button: 'right' });
    await menu.getByRole('button', { name: /^Orbit at/ }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('[data-readout="order"]')).toHaveText('Orbiting');
    await ensureRunning(page);

    // The secondary click selected it too, so its panel says when it is in
    // lock range; then lock it from the same menu, paused again.
    await expect(region(page, 'Selected').getByRole('button', { name: /^Lock target/ })).toBeEnabled({
      timeout: 90_000,
    });
    await ensurePaused(page);
    await scout.click({ button: 'right' });
    await menu.getByRole('button', { name: /^Lock target/ }).click();
    await expect(menu).toBeHidden();
    await ensureRunning(page);
    await expect(region(page, 'Locks').getByText('Locked', { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const weapons = region(page, 'Weapons');
    await weapons.getByRole('button', { name: /^Fire\s?E$/ }).click();
    await expect(weapons.getByText(/^Firing at Pirate Scout/)).toBeVisible();

    const modules = region(page, 'Modules');
    await modules.getByRole('button', { name: /^Activate Small Shield Booster/ }).click();
    await expect(modules.getByRole('button', { name: /^Deactivate Small Shield Booster/ })).toBeVisible();

    // Ranges on demand, from the view's own controls.
    await page.getByRole('button', { name: /^Show ranges/ }).click();
    await expect(page.locator('[data-range="optimal"]')).toHaveCount(1);

    // Stop firing, drop the lock and leave.
    await weapons.getByRole('button', { name: /^Cease fire/ }).click();
    await expect(weapons.locator('[data-weapon-status="stopped"]')).toBeVisible({ timeout: 10_000 });
    await expect(weapons.getByText('Stopped: Stopped on command.')).toBeVisible();
    await region(page, 'Locks').getByRole('button', { name: /^Unlock Pirate Scout/ }).click();
    await expect(region(page, 'Locks').getByText(/^No target is locked/)).toBeVisible();

    await page.getByRole('button', { name: /^Retreat/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({
      timeout: 60_000,
    });
  });

  test('commands a fight from the keyboard alone [MVP-AC-03, FUNC-20, TECH-12.3]', async ({ page }) => {
    test.setTimeout(4 * 60_000);

    // Arrive close, then warp and start the clock with shortcuts.
    await page.getByLabel('Arrive at').focus();
    await page.keyboard.type('1');
    await expect(page.getByLabel('Arrive at')).toHaveValue('10');
    await page.keyboard.press('Tab');
    await page.keyboard.press('w');
    await page.keyboard.press('p');
    await expect(page.getByRole('heading', { level: 2, name: 'Verge Belt' })).toBeVisible({
      timeout: 60_000,
    });

    // ] steps through the site until the scout is selected.
    await expect(async () => {
      if ((await scoutEntry(page).getAttribute('aria-pressed')) !== 'true') {
        await page.keyboard.press(']');
      }
      await expect(scoutEntry(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
    }).toPass({ timeout: 10_000 });

    await page.getByLabel('Range').focus();
    await page.keyboard.type('1');
    await expect(page.getByLabel('Range')).toHaveValue('1');
    await page.keyboard.press('Tab');
    await page.keyboard.press('o');
    await expect(page.locator('[data-readout="order"]')).toHaveText('Orbiting');

    // l locks once the scout is in range; e opens fire; 1 runs the booster.
    await expect(async () => {
      await page.keyboard.press('l');
      await expect(region(page, 'Locks').locator('[data-lock]')).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 90_000 });
    await expect(region(page, 'Locks').getByText('Locked', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const weapons = region(page, 'Weapons');
    await page.keyboard.press('e');
    await expect(weapons.getByText(/^Firing at Pirate Scout/)).toBeVisible();
    await page.keyboard.press('1');
    await expect(
      region(page, 'Modules').getByRole('button', { name: /^Deactivate Small Shield Booster/ }),
    ).toBeVisible();

    // q ceases fire; v reloads the part-spent magazine once the cycle ends.
    await page.keyboard.press('q');
    await expect(weapons.locator('[data-weapon-status="stopped"]')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('v');
    await expect(weapons.locator('[data-weapon-status="reloading"]')).toBeVisible({ timeout: 10_000 });

    // The context-menu equivalent opens from the list and gives focus back.
    await scoutEntry(page).focus();
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('group', { name: 'Commands for Pirate Scout' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(scoutEntry(page)).toBeFocused();

    // n drops the lock, x retreats.
    await page.keyboard.press('n');
    await expect(region(page, 'Locks').getByText(/^No target is locked/)).toBeVisible();
    await page.keyboard.press('x');
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({
      timeout: 60_000,
    });
  });
});
