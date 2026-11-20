import { expect, test, type Locator, type Page } from '@playwright/test';

import { undock } from '../support/undock.ts';
import { destinationEntry, dockHome, warpHome, warpTo } from '../support/destinations.ts';
import { marketMode } from '../support/market.ts';
import { chooseAmmunition, chooseModule, fittingSlots } from '../support/fitting.ts';
import { openCheckpoint } from '../support/checkpoint/browser.ts';
import { confirmDialog, fixSeed, freshCampaign } from '../support/freshCampaign.ts';

/**
 * Losing a ship and coming back from it, in a real browser
 * (MVP Implementation Plan phase 15; MVP-AC-08, FUNC-9.12).
 *
 * The run is the shipped build: the engine in its worker, saves in IndexedDB,
 * simulation time at 1x.
 *
 * One case plays the destruction itself (Test Suite Optimization Plan phase
 * 8). The pilot takes the starter ship's autocannon off and sells it, flies
 * what is left to the hard site and lets it be destroyed. The payout leaves
 * enough to buy a starter ship back, so the recovery service supplies none:
 * the loss report explains why, the page is reloaded without closing the
 * campaign - so only the autosave taken at the destruction can bring the
 * shipless station back - and the pilot buys a hull, fits a gun to it, and
 * flies it to the easiest site and locks the scout there.
 *
 * The other recovery - a granted replacement, and the survivors brought home
 * from the wreck - begins after a loss the campaign has already had. It opens
 * a checkpoint reached headlessly: the same starter ship, with a spare gun in
 * the hangar, destroyed idling at the hard site. Clearing the easiest site
 * again with the recovered ship is the headless loss case's evidence
 * (`tests/integration/loss.test.ts`).
 *
 * The client supplies a campaign's seed, so the played case fixes the sixteen
 * random bytes that become it; the checkpoint campaign is made from the same
 * bytes. The survival rolls are therefore the same every run, and nothing else
 * about the game is changed.
 */

const PILOT = 'Loss Pilot';

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

/** Buys one of an item at the market, delivered where the dialog suggests. */
async function buy(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await marketMode(page, 'Buy');
  await page.getByRole('button', { name: `Buy ${item}` }).click();
  const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
  await confirmDialog(purchase);
}

/**
 * Chooses a destination in space and warps to it. `label` names the warp
 * control when it differs from the destination's name, as for a wreck.
 */
async function warp(
  page: Page,
  arriveAtKm: string,
  site: string,
  destination: string | RegExp,
  label?: RegExp,
): Promise<void> {
  await warpTo(page, destination, Number(arriveAtKm), ...(label === undefined ? [] : [label]));
  await ensureRunning(page);
  await expect(page.getByRole('heading', { level: 2, name: site })).toBeVisible({ timeout: 60_000 });
}

/** Warps home through the station destination and docks there. */
async function returnAndDock(page: Page): Promise<void> {
  await warpHome(page);
  await ensureRunning(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({
    timeout: 60_000,
  });
  await dockHome(page);
  await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
  await ensurePaused(page);
}

test.describe('losing a ship', () => {
  test('is destroyed with nothing supplied, reloads the shipless station, buys a hull and flies it to a fight [MVP-AC-08, FUNC-9.12, FUNC-3.4, FUNC-22.1, MVP-AC-01]', async ({
    page,
  }) => {
    // One sortie at 1x to the loss, then a warp out in the bought ship.
    test.setTimeout(8 * 60_000);
    await fixSeed(page);
    await freshCampaign(page, PILOT);

    // Take the autocannon off and sell it: after the payout the pilot can
    // afford a starter ship, so none is supplied.
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await chooseModule(page, 'Weapon 1', '');
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await marketMode(page, 'Sell');
    await page.getByRole('button', { name: 'Sell 200mm Autocannon' }).click();
    const sale = page.getByRole('dialog', { name: 'Confirm sale' });
    await confirmDialog(sale);

    // Fly what is left to the hard site and do nothing there.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await undock(page);
    await warp(page, '10', 'Outpost Cradle', 'Pirate Base');

    // The destruction is one transaction: the station comes back with the report.
    const report = region(page, 'Ship lost');
    await expect(report).toBeVisible({ timeout: 4 * 60_000 });
    await ensurePaused(page);
    await expect(
      report.getByText(/^Your Wayfarer was destroyed at Outpost Cradle fighting Pirate Base/),
    ).toBeVisible();
    await expect(report.getByRole('rowheader', { name: 'Pirate Gunner' }).first()).toBeVisible();
    await expect(
      report.getByRole('list', { name: 'Lost items' }).getByText('1 x Small Shield Booster (fitted)'),
    ).toBeVisible();
    await expect(
      report.getByText("Basic insurance paid 3,600 ISK: 30% of the hull's 12,000 ISK reference value."),
    ).toBeVisible();
    await expect(report.getByText(/^You have no ship\. With 33,822 ISK/)).toBeVisible();
    await expect(page.getByText('33,822 ISK', { exact: true })).toBeVisible();

    // Reload without closing: only the autosave taken at the destruction can
    // bring the shipless station back.
    await saved(page);
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(region(page, 'Ship lost')).toBeVisible();
    await expect(region(page, 'Ship lost').getByText(/^You have no ship\. With 33,822 ISK/)).toBeVisible();
    await expect(page.getByText('33,822 ISK', { exact: true })).toBeVisible();
    await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible();
    await expect(region(page, 'No ship')).toBeVisible();
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Undock/ })).toBeDisabled();

    // The recovery purchase: a bought hull becomes the active ship at once.
    await buy(page, 'Wayfarer');
    await expect(region(page, 'No ship')).toBeHidden();

    // It arrives empty: give it a gun and its rounds, and fly it to a fight.
    await buy(page, '200mm Autocannon');
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await chooseModule(page, 'Weapon 1', 'module.turret.autocannon.small');
    await chooseAmmunition(page, 'Weapon 1', 'ammo.projectile.small.fusion');
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
    await expect(fittingSlots(page).filter({ hasText: '200mm Autocannon' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Undock/ })).toBeEnabled();
    await undock(page);
    await warp(page, '10', 'Verge Belt', 'Pirate Scout');
    await ensurePaused(page);
    await region(page, 'In this site').getByRole('button', { name: /Pirate Scout/ }).click();
    const lock = region(page, 'Navigation').getByRole('button', { name: /^Lock target/ });
    await expect(lock).toBeEnabled({ timeout: 30_000 });
    await lock.click();
    await ensureRunning(page);
    await expect(region(page, 'In this site').getByText('Locked', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(region(page, 'Weapons').getByText('Aimed at Pirate Scout')).toBeVisible();
  });
});

test.describe('recovering from a checkpoint after a loss', () => {
  test('flies the granted replacement to its wreck, brings the survivors home and refits with them [MVP-AC-08, FUNC-9.12, FUNC-5.4, FUNC-22.1]', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(4 * 60_000);
    // The helper checks the station, the paused clock, the wallet, the lost
    // sortie and the open report's every lost and surviving item line.
    await openCheckpoint(page, 'loss-granted', baseURL);
    const report = region(page, 'Ship lost');
    await expect(report.getByRole('rowheader', { name: 'Pirate Gunner' }).first()).toBeVisible();
    await expect(
      report.getByText("Basic insurance paid 3,600 ISK: 30% of the hull's 12,000 ISK reference value."),
    ).toBeVisible();
    await expect(report.getByText(/the recovery service supplied a replacement Wayfarer/)).toBeVisible();
    await expect(page.getByText('11,600 ISK', { exact: true })).toBeVisible();

    // The replacement is a recovery grant: flown freely, never sold or insured.
    await page.getByRole('button', { name: 'Ships', exact: true }).click();
    await expect(page.getByText('Recovery grant').first()).toBeVisible();

    // Recover the wreck through the ordinary destination flow, without a map.
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await report.getByRole('button', { name: /^Choose your wreck as the destination/ }).click();
    await expect(report.getByRole('button', { name: /^Your wreck is the destination/ })).toBeVisible();
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByText('Chosen destination: your wreck at Outpost Cradle. Space navigation offers it first.')).toBeVisible();
    await undock(page);
    // Space navigation offers the chosen wreck first.
    await expect(destinationEntry(page, 'Your wreck at Outpost Cradle')).toHaveAttribute('aria-pressed', 'true');
    await warp(page, '0', 'Outpost Cradle', 'Your wreck at Outpost Cradle', /^Warp to your wreck at Outpost Cradle/);
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
    await chooseModule(page, 'Weapon 2', 'module.turret.autocannon.small');
    await chooseAmmunition(page, 'Weapon 2', 'ammo.projectile.small.fusion');
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
    await expect(fittingSlots(page).filter({ hasText: '200mm Autocannon' })).toHaveCount(2);

    await page.getByRole('button', { name: 'Hangar', exact: true }).click();
    // The spare rounds went down with the ship and came back out of its
    // wreck, so they are in the hold already; any in the hangar join them.
    const fusion = page.getByRole('table', { name: 'Station hangar' }).getByRole('row', { name: /Fusion S/ });
    if ((await fusion.count()) > 0) await fusion.getByRole('button', { name: 'Move all Fusion S to the hold' }).click();
    await expect(
      page.getByRole('table', { name: 'Ship cargo hold' }).getByRole('rowheader', { name: 'Fusion S' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Undock/ })).toBeEnabled();
  });
});
