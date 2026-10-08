import { expect, test, type Locator, type Page } from '@playwright/test';

import { undock } from '../support/undock.ts';

/**
 * The shipped build needs nothing but its own files
 * (MVP Implementation Plan phase 21; MVP Scope 9.2.4; Technical Specification
 * 2, 3.1, 3.2).
 *
 * The run starts from a clean browser profile and listens to every request the
 * browser context makes. Starting the game may ask only for files of the build
 * itself, from the origin that serves it: that is what lets it start on a
 * machine with no connection once the build is there. The network is then
 * switched off altogether and a whole loop is played - a sortie to the easiest
 * site, the fight, the wreck, the way home, a sale, a save, and the campaign
 * closed and resumed. Nothing may be asked for at all, and nothing may fail.
 *
 * The installable package and its service worker are deferred (MVP Scope 7),
 * so loading the page again still needs the local files to be served.
 *
 * The sixteen seed bytes the client supplies are fixed, as in the other loops,
 * so the wreck holds the same loot every run.
 */

const PILOT = 'Offline Pilot';
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

test.describe('playing without a network', () => {
  test('starts from its own files and plays a whole loop with the network switched off [MVP-AC-01, MVP-AC-06, TECH-2, TECH-3.1, TECH-3.2]', async ({
    page,
    context,
    baseURL,
  }) => {
    // One sortie at 1x with its warps, a fight and a docking cycle.
    test.setTimeout(10 * 60_000);

    const requests: string[] = [];
    context.on('request', (request) => requests.push(request.url()));
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await fixSeed(page);
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);

    // A clean profile: there is no campaign to resume.
    await expect(page.getByLabel('Pilot name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toHaveCount(0);

    // Starting asked for the page, its script, its styles and the engine
    // worker, and for nothing that is not served beside them.
    expect(baseURL).toBeDefined();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((url) => !url.startsWith(baseURL ?? ''))).toEqual([]);

    await context.setOffline(true);
    requests.length = 0;

    await page.getByLabel('Pilot name').fill(PILOT);
    await page.getByRole('button', { name: 'Start campaign' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
    await expect(page.getByText('20,000 ISK', { exact: true })).toBeVisible();

    // Out to the easiest site.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
    await expect(page.getByText('Destination: Pirate Scout')).toBeVisible();
    await undock(page);
    await page.getByLabel('Arrive at').selectOption('10');
    await page.getByRole('button', { name: /^Warp/ }).click();
    await ensureRunning(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Verge Belt' })).toBeVisible({
      timeout: 60_000,
    });

    // The fight.
    await region(page, 'In this site').getByRole('button', { name: /Pirate Scout/ }).click();
    await page.getByLabel('Range').selectOption('1');
    await page.getByRole('button', { name: /^Orbit/ }).click();
    const lock = region(page, 'Selected').getByRole('button', { name: /^Lock target/ });
    await expect(lock).toBeEnabled({ timeout: 60_000 });
    await lock.click();
    await expect(region(page, 'Locks').getByText('Locked', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await region(page, 'Weapons').getByRole('button', { name: /^Fire\s?E$/ }).click();
    await region(page, 'Modules')
      .getByRole('button', { name: /^Activate Small Shield Booster/ })
      .click();
    await expect(region(page, 'Encounter').getByText(/^Site cleared: 3,000 ISK paid/)).toBeVisible({
      timeout: 6 * 60_000,
    });

    // The wreck, and the way home.
    await region(page, 'In this site').getByRole('button', { name: /Wreck/ }).click();
    const wreck = region(page, 'Wreck');
    const takeAll = wreck.getByRole('button', { name: /^Take all/ });
    if (!(await takeAll.isVisible())) {
      await wreck.getByRole('button', { name: /^Approach to open/ }).click();
    }
    await expect(takeAll).toBeEnabled({ timeout: 60_000 });
    await takeAll.click();
    await expect(wreck.getByText('The wreck is empty.')).toBeVisible();

    await page.getByRole('button', { name: /^Retreat/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: /^Dock/ }).click();
    await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
    await ensurePaused(page);
    await expect(page.getByText('23,000 ISK', { exact: true })).toBeVisible();

    // Convert the reward: the sale is a market transaction, which autosaves.
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Sell Burned Alloy Plate' }).click();
    const sale = page.getByRole('dialog', { name: 'Confirm sale' });
    await expect(sale.getByText('Calculating…')).toBeHidden();
    await sale.getByRole('button', { name: 'Confirm' }).click();
    await expect(sale).toBeHidden();
    await expect(page.getByText('23,000 ISK', { exact: true })).toBeHidden();
    await expect(page.getByRole('status', { name: 'Campaign save status' })).toHaveText(
      /^Saved at revision [\d,]+\.$/,
      { timeout: 30_000 },
    );
    const wallet = await page.locator('dd').filter({ hasText: /ISK$/ }).first().innerText();

    // Close and resume: the save store is local too.
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await expect(page.getByText(new RegExp(`Saved campaign: ${PILOT}`))).toBeVisible();
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: /ISK$/ }).first()).toHaveText(wallet);
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(
      page.locator('[data-disclosure="encounter.borrell.pirate-scout"]').getByText('Cleared 1 times'),
    ).toBeVisible();

    // With the network off, the game asked for nothing and nothing failed.
    expect(requests).toEqual([]);
    expect(problems).toEqual([]);
  });
});
