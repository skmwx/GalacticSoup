import { expect, test, type Locator, type Page } from '@playwright/test';

import { openGameMenu } from '../support/cockpit.ts';
import { chooseDestination, destinationBriefing, destinations, dockHome, warpHome, warpTo } from '../support/destinations.ts';
import { applyFit, chooseAmmunition, chooseModule } from '../support/fitting.ts';
import { buy, freshCampaign, fund } from '../support/funding.ts';
import { takeService } from '../support/services.ts';
import { undock } from '../support/undock.ts';

/**
 * The v0.2 progression loop in the browser (FeatureSpec02 V02-AC-14; v0.2
 * Implementation Plan phase 5).
 *
 * Buy a destroyer, switch to it, fit it with blasters and a web, choose a site
 * by its band and briefing, web and destroy the cutter, loot its wreck, come
 * home to repair and resupply, then take the ship to an advanced site and
 * close and reopen the game there.
 *
 * The campaign's wallet is topped up once, by rewriting the stored save and
 * sealing it again, so the run does not have to grind for the hull: earning
 * the credits through ordinary play is the career runs' evidence, not this
 * flow's. Everything after that is the shipped interface, by mouse and by the
 * keyboard shortcuts.
 */

const PILOT = 'Ladder Pilot';
const SEED = 'ee55ff6677889900aa11bb22cc33dd44';
const FUNDING = 400_000;

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

function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

async function ensureRunning(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: /^Resume/ });
  if (await resume.isVisible()) await resume.click();
  await expect(page.getByText(/Running at 1x/)).toBeVisible();
}

async function closeAndReopen(page: Page, heading: string): Promise<void> {
  await openGameMenu(page);
  await page.getByRole('button', { name: /Close campaign/ }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
}

test.describe('the v0.2 progression loop', () => {
  test.beforeEach(async ({ page }) => {
    await fixSeed(page);
    await freshCampaign(page, PILOT);
  });

  test('buys and flies a destroyer, webs and loots at a fit-sensitive site, refits and reopens at an advanced site [V02-AC-14, V02-AC-03, V02-AC-07, V02-AC-09, FUNC-19.5]', async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);
    await fund(page, FUNDING);

    // Buy a bare destroyer and its equipment; the hull arrives with nothing fitted.
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await buy(page, 'Bulwark', 1);
    await buy(page, 'Light Blaster', 4);
    await buy(page, 'Stasis Web', 1);
    await buy(page, '1MN Afterburner', 1);
    await buy(page, 'Small Armour Repairer', 1);

    // Switch to it at the station: the frigate stays docked with its own fit.
    await page.getByRole('button', { name: 'Ships', exact: true }).click();
    await expect(page.locator('[data-bare-hull]')).toBeVisible();
    await page.getByRole('button', { name: /^Fly Bulwark/ }).click();
    await expect(page.getByRole('button', { name: /^Fly Bulwark/ })).toHaveAttribute('aria-disabled', 'true');

    // Plasma into the destroyer's own hold, then fit it.
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await buy(page, 'Plasma Charge S', 300, true);
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    for (const slot of ['Weapon 1', 'Weapon 2', 'Weapon 3', 'Weapon 4']) {
      await chooseModule(page, slot, 'module.turret.blaster.small');
      await chooseAmmunition(page, slot, 'ammo.hybrid.small.plasma');
    }
    await chooseModule(page, 'System 1', 'module.web.small');
    await chooseModule(page, 'System 2', 'module.propulsion.afterburner.small');
    await chooseModule(page, 'System 3', 'module.repair.armor.small');
    await applyFit(page);
    await takeService(page, 'Resupply ammunition', 'Confirm resupply');

    // Choose by band: every site is listed and the fit-sensitive one says so.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await undock(page);
    await expect(page.getByRole('heading', { name: 'Navigation' })).toBeVisible();
    for (const band of ['Entry band · tier 1', 'Developed band · tier 2', 'Advanced band · tier 3']) {
      await expect(destinations(page).getByRole('list', { name: band })).toBeVisible();
    }
    await chooseDestination(page, 'Knife Fight');
    await expect(destinationBriefing(page)).toContainText('Fit-sensitive. Weak fits:');
    await expect(destinationBriefing(page)).toContainText('Threats: Fast close-range frigate');
    // Arrive close, then warp with the keyboard.
    await destinations(page).getByLabel('Arrive at').selectOption('10');
    await page.keyboard.press('w');
    await ensureRunning(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Shard Gulch' })).toBeVisible({ timeout: 60_000 });

    // Lock the cutter, web it and fire every blaster.
    await region(page, 'In this site').getByRole('button', { name: /Pirate Cutter/ }).click();
    await page.getByRole('button', { name: /^Orbit/ }).click();
    const lock = region(page, 'Navigation').getByRole('button', { name: /^Lock target/ });
    await expect(lock).toBeEnabled({ timeout: 60_000 });
    await lock.click();
    await expect(region(page, 'In this site').getByText('Locked', { exact: true })).toBeVisible({ timeout: 30_000 });
    const web = region(page, 'Modules').getByRole('button', { name: /^Activate Stasis Web on Pirate Cutter/ });
    await expect(web).toBeEnabled({ timeout: 30_000 });
    await web.click();
    await page.keyboard.press('e');
    await expect(page.locator('[data-effect="web"][data-direction="outgoing"]').first()).toBeVisible({ timeout: 30_000 });

    // The cutter dies; its wreck is looted.
    await expect(page.locator('[data-encounter-summary="complete"]')).toBeVisible({ timeout: 180_000 });
    await region(page, 'In this site').getByRole('button', { name: /Wreck/ }).first().click();
    const wreck = region(page, 'Wreck');
    const takeAll = wreck.getByRole('button', { name: /^Take all/ });
    if (!await takeAll.isVisible()) {
      await wreck.getByRole('button', { name: /^Approach to open/ }).click();
    }
    await expect(takeAll).toBeEnabled({ timeout: 60_000 });
    await takeAll.click();
    await expect(wreck.getByText('The wreck is empty.')).toBeVisible();

    // Home: repair and resupply.
    await warpHome(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({ timeout: 60_000 });
    await dockHome(page);
    await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
    await takeService(page, 'Repair all', 'Confirm full repair');
    await takeService(page, 'Resupply ammunition', 'Confirm resupply');

    // An advanced site: the warning says the system rating does not describe it.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    // Docked, the chosen site's band, threats and counters are repeated while there is time to refit.
    await expect(page.locator('[data-departure-briefing="encounter.borrell.knife-fight"]')).toContainText('Entry band · tier 1');
    await undock(page);
    await chooseDestination(page, 'Bombardment Line');
    await expect(destinationBriefing(page).locator('[data-advanced-warning]')).toBeVisible();
    await warpTo(page, 'Bombardment Line', 50);
    await ensureRunning(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Ashfall Line' })).toBeVisible({ timeout: 60_000 });

    // Close and reopen there: the same ship, in the same site.
    await closeAndReopen(page, 'Ashfall Line');
    await ensureRunning(page);
    await warpHome(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({ timeout: 60_000 });
    await dockHome(page);
    await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Ships', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Fly Bulwark/ })).toHaveAttribute('aria-disabled', 'true');
  });
});
