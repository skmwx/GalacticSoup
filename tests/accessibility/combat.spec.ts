import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The combat surfaces under automated audit
 * (Technical Specification 12.2, 12.3; Functional Specification 19.3, 20).
 *
 * A fight fills the space view with status, weapons, modules, locks, the
 * encounter roster and the log, and a secondary click adds a menu over the
 * drawing. Each of those must pass the same audit as the station, carry its
 * states in words as well as colour, and stay usable at a doubled scale.
 */

const PILOT = 'Audited Pilot';

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

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Flies to the scout site, locks the scout and opens fire, then pauses. */
async function inAFight(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hangar', exact: true }).click();
  await page.getByRole('button', { name: 'Move to hold' }).first().click();
  await page.getByRole('button', { name: 'Departure', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
  await page.getByRole('button', { name: /^Undock/ }).click();
  await page.getByLabel('Arrive at').selectOption('10');
  await page.getByRole('button', { name: /^Warp/ }).click();
  await page.getByRole('button', { name: /^Resume/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Verge Belt' })).toBeVisible({ timeout: 60_000 });

  await page
    .getByRole('region', { name: 'In this site' })
    .getByRole('button', { name: /Pirate Scout/ })
    .click();
  const lock = page.getByRole('region', { name: 'Selected' }).getByRole('button', { name: /^Lock target/ });
  await expect(lock).toBeEnabled({ timeout: 60_000 });
  await lock.click();
  const weapons = page.getByRole('region', { name: 'Weapons' });
  await expect(weapons.getByRole('button', { name: /^Fire\s?E$/ })).toBeEnabled({ timeout: 30_000 });
  await weapons.getByRole('button', { name: /^Fire\s?E$/ }).click();
  await expect(weapons.getByText(/^Firing at Pirate Scout/)).toBeVisible();
  await page.getByRole('button', { name: /^Pause/ }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
}

test.describe('combat accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await freshCampaign(page);
  });

  test('passes an automated audit in the middle of a fight [TECH-12.3, FUNC-19.3]', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await inAFight(page);

    // Open every explanation so its contents are audited too.
    for (const summary of await page.locator('summary').all()) {
      await summary.click();
    }
    await audit(page);
  });

  test('passes an audit with the context menu open, and closes it with Escape [TECH-12.3, FUNC-20]', async ({
    page,
  }) => {
    test.setTimeout(3 * 60_000);
    await inAFight(page);

    const entry = page.getByRole('region', { name: 'In this site' }).getByRole('button', { name: /Pirate Scout/ });
    await entry.focus();
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('group', { name: 'Commands for Pirate Scout' });
    await expect(menu).toBeVisible();
    await audit(page);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(entry).toBeFocused();
  });

  test('names hostility, locks and threats in words, not only colour [TECH-12.2, FUNC-9.1]', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await inAFight(page);

    const entry = page.getByRole('region', { name: 'In this site' }).getByRole('button', { name: /Pirate Scout/ });
    await expect(entry).toContainText('Hostile');
    await expect(entry).toContainText('Locked');
    // The drawing's hostile and lock states are shapes, not only strokes.
    await expect(page.locator('[data-layer="objects"] [data-hostile="true"]')).toHaveCount(1);
    await expect(page.locator('[data-layer="objects"] [data-lock-marker="locked"]')).toHaveCount(1);
  });

  test('stays usable at a doubled interface scale in a fight [TECH-12.3]', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await inAFight(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--gs-ui-scale', '2');
      document.documentElement.style.setProperty('--gs-text-scale', '2');
    });

    await expect(page.getByRole('region', { name: 'Weapons' })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
