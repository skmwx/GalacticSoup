import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { chooseDestination, destinations, destinationEntry, showNavigationView, warpTo } from '../support/destinations.ts';
import { buy, freshCampaign, fund } from '../support/funding.ts';
import { undock } from '../support/undock.ts';

/**
 * The v0.2 surfaces under the accessibility pass
 * (v0.2 Implementation Plan phase 7, work item 3; FeatureSpec02 9;
 * Technical Specification 12.2, 12.3; Functional Specification 19.3, 20).
 *
 * The release enlarged four surfaces the MVP pass did not see: a hangar of
 * several ships with their comparison, a market of 26 modules and 16 charges
 * with purpose, size and compatibility filters, twelve destinations grouped
 * into bands, and fights with guided volleys and webs. Each must pass the same
 * automated audit as the rest of the game, be operable without a pointer, say
 * what it shows in words rather than colour alone, and keep the tactical
 * marks honest under reduced motion.
 */

const PILOT = 'Accessible Captain';
/** Enough for a destroyer and a cruiser hull. */
const FUNDING = 400_000;

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

async function ensureRunning(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: /^Resume/ });
  if (await resume.isVisible()) await resume.click();
  await expect(page.getByText(/Running at 1x/)).toBeVisible();
}

async function pause(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Pause/ }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
}

/** Opens every collapsed equipment entry and explanation, so their contents are audited too. */
async function openEverything(page: Page): Promise<void> {
  const closed = page.locator('[data-panel="equipment"] button[aria-expanded="false"]');
  while ((await closed.count()) > 0) await closed.first().click();
  // Only the explanations on screen: a nested one opens with its parent.
  for (const summary of await page.locator('summary').all()) {
    if (await summary.isVisible()) await summary.click();
  }
}

test.describe('v0.2 surfaces: accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await freshCampaign(page, PILOT);
  });

  test('audits a hangar of three ships and their comparison, and switches ship from the keyboard [V02-AC-14, V02-AC-03, TECH-12.3, FUNC-20]', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await fund(page, FUNDING);
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await buy(page, 'Bulwark', 1);
    await buy(page, 'Citadel', 1);

    await page.getByRole('button', { name: 'Ships', exact: true }).click();
    const ships = page.getByRole('list', { name: 'Your ships' });
    await expect(ships.getByRole('listitem')).toHaveCount(3);
    // The active ship and a bare hull are said in words, and the comparison names its best values.
    await expect(ships.getByRole('listitem').filter({ hasText: /Active/ })).toHaveCount(1);
    await expect(page.locator('[data-bare-hull]').first()).toContainText('A bare hull is not ready to fight');
    const comparison = page.locator('[data-ship-comparison]');
    await expect(comparison.locator('caption')).toContainText('marked "best"');
    await audit(page);

    // Fly the Bulwark without a pointer; the button then says it is already the ship flown.
    const fly = page.getByRole('button', { name: /^Fly Bulwark/ });
    await fly.focus();
    await page.keyboard.press('Enter');
    await expect(fly).toHaveAttribute('aria-disabled', 'true');
    await expect(fly).toHaveAccessibleDescription(/already the ship you fly/);
    await expect(fly).toBeFocused();
    await audit(page);

    // At a doubled scale the hangar and its comparison still fit the window.
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--gs-ui-scale', '2');
      document.documentElement.style.setProperty('--gs-text-scale', '2');
    });
    await expect(page.getByRole('heading', { name: 'Your ships' })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test('audits the market under its purpose, size and compatibility filters, operated from the keyboard [V02-AC-14, V02-AC-05, TECH-12.3, FUNC-11.3]', async ({ page }) => {
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    const table = page.getByRole('table', { name: /items quoted here/ });

    const purpose = page.getByLabel('Purpose');
    await purpose.focus();
    await purpose.selectOption({ label: 'Weapons' });
    await expect(table.getByRole('rowheader', { name: 'Guided Launcher S' })).toBeVisible();
    await expect(table.getByRole('rowheader', { name: 'Slug Warhead S' })).toHaveCount(0);
    await audit(page);

    const size = page.getByLabel('Size');
    await size.focus();
    await size.selectOption({ label: 'Medium' });
    await expect(table.getByRole('rowheader', { name: 'Guided Launcher S' })).toHaveCount(0);
    await audit(page);

    // "Fits the active ship" is a checkbox the keyboard toggles; the starter takes no medium module.
    const fits = page.getByRole('checkbox', { name: 'Fits the active ship' });
    await fits.focus();
    await page.keyboard.press('Space');
    await expect(fits).toBeChecked();
    await expect(table.getByRole('rowheader')).toHaveCount(0);
    await audit(page);

    await page.keyboard.press('Space');
    await expect(fits).not.toBeChecked();
    await size.selectOption({ label: 'All' });
    await purpose.selectOption({ label: 'Ammunition' });
    await expect(table.getByRole('rowheader', { name: 'Slug Warhead S' })).toBeVisible();
    await expect(table.getByRole('row', { name: /Slug Warhead S/ }).getByText('Loads into Small guided weapons')).toBeVisible();
    await audit(page);
  });

  test('audits twelve destinations in bands, filters them and chooses one from the keyboard [V02-AC-14, V02-AC-09, TECH-12.3, FUNC-20]', async ({ page }) => {
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await undock(page);
    await showNavigationView(page, 'Warp');
    const chooser = destinations(page);
    for (const band of ['Entry band · tier 1', 'Developed band · tier 2', 'Advanced band · tier 3']) {
      await expect(chooser.getByRole('list', { name: band })).toBeVisible();
    }
    await audit(page);

    // Filtering one band keeps the others' existence in words.
    const filter = chooser.getByLabel('Show');
    await filter.focus();
    await filter.selectOption({ label: 'Advanced band · tier 3' });
    await expect(chooser.getByRole('list', { name: 'Entry band · tier 1' })).toHaveCount(0);
    await expect(chooser.locator('[data-band-hidden]')).toContainText('more sites are listed under the other bands');

    // Choose the advanced site from the keyboard: its warning and briefing are text.
    const entry = destinationEntry(page, 'Command Group');
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(entry).toHaveAttribute('aria-pressed', 'true');
    const briefing = chooser.getByRole('group', { name: 'Destination briefing' });
    await expect(briefing.locator('[data-advanced-warning]')).toBeVisible();
    await expect(briefing).toContainText('Threats:');
    await audit(page);

    await filter.selectOption({ label: 'All bands' });
    await expect(chooser.getByRole('list', { name: 'Entry band · tier 1' })).toBeVisible();
  });

  test('audits a fight under guided fire: volleys are marked by shape and described in words, also with reduced motion [V02-AC-14, V02-AC-06, TECH-12.2, TECH-12.3, FUNC-19.3]', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await undock(page);
    await warpTo(page, 'Missile Picket', 10);
    await ensureRunning(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Signal Spire' })).toBeVisible({ timeout: 60_000 });

    await region(page, 'In this site').getByRole('button', { name: /Pirate Lancer/ }).click();
    const lock = region(page, 'Navigation').getByRole('button', { name: /^Lock target/ });
    await expect(lock).toBeEnabled({ timeout: 60_000 });
    await lock.click();

    // The lancer's rounds are drawn as filled diamonds, each with a text title.
    const incoming = page.locator('[data-projectile="incoming"]').first();
    await expect(incoming).toBeVisible({ timeout: 90_000 });
    await pause(page);
    await expect(page.locator('[data-projectile="incoming"]').first().locator('title'))
      .toHaveText(/^Guided projectile, [\d.]+ s of flight left$/);
    await openEverything(page);
    await audit(page);
  });

  test('audits a fight under a web: the slowing is named with its source, strength, time and the speed left [V02-AC-14, V02-AC-07, TECH-12.2, TECH-12.3, FUNC-9.9]', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await undock(page);
    await chooseDestination(page, 'Range Check');
    await warpTo(page, 'Range Check', 10);
    await ensureRunning(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Tangle Drift' })).toBeVisible({ timeout: 60_000 });

    // Hold still: the binder closes in and webs the ship.
    const limit = page.locator('[data-readout="speedEffects"] [data-speed-limit]').first();
    await expect(limit).toBeVisible({ timeout: 120_000 });
    await pause(page);
    await expect(limit).toHaveText(/^Speed limited to .+ \(normally .+\)$|^Speed limited to .+, the floor/);
    await expect(page.locator('[data-readout="speedEffects"] [data-speed-effect]').first()).toContainText(/Pirate Binder/);
    await expect(page.locator('[data-effect="web"][data-direction="incoming"] title').first())
      .toHaveText(/^Web: -\d+% speed, [\d.]+ s left$/);
    await openEverything(page);
    await audit(page);
  });
});
