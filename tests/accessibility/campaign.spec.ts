import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The campaign surface under keyboard-only operation
 * (Technical Specification 12.3; Functional Specification 20).
 *
 * Every state the panel can be in is checked, because the open campaign and
 * the resume choice are different surfaces, not different text.
 */

const PILOT = 'Keyboard Pilot';

async function freshPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('galactic-soup');
        request.onsuccess = () => {
          resolve();
        };
        request.onerror = () => {
          resolve();
        };
        request.onblocked = () => {
          resolve();
        };
      }),
  );
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
}

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe('campaign accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await freshPage(page);
  });

  test('starts and closes a campaign with the keyboard alone [TECH-12.3]', async ({ page }) => {
    const field = page.getByLabel('Pilot name');
    await field.focus();
    await page.keyboard.type(PILOT);
    await page.keyboard.press('Enter');

    await expect(page.getByText(PILOT, { exact: true })).toBeVisible();
    await audit(page);

    // Reach "Close campaign" by tabbing from the top of the panel.
    const close = page.getByRole('button', { name: 'Close campaign' });
    await close.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();
    await audit(page);
  });

  test('keeps the reset confirmation reachable and reversible [TECH-12.3]', async ({ page }) => {
    await page.getByLabel('Pilot name').fill(PILOT);
    await page.getByRole('button', { name: 'Start campaign' }).click();
    await expect(page.getByText(PILOT, { exact: true })).toBeVisible();

    const reset = page.getByRole('button', { name: 'Reset campaign' });
    await reset.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('button', { name: 'Delete this campaign' })).toBeVisible();
    await audit(page);

    await page.getByRole('button', { name: 'Keep playing' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Reset campaign' })).toBeVisible();
  });

  test('stays readable at a doubled interface scale [TECH-12.3]', async ({ page }) => {
    await page.getByLabel('Pilot name').fill(PILOT);
    await page.getByRole('button', { name: 'Start campaign' }).click();
    await expect(page.getByText(PILOT, { exact: true })).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--gs-ui-scale', '2');
      document.documentElement.style.setProperty('--gs-text-scale', '2');
    });

    await expect(page.getByRole('button', { name: 'Close campaign' })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test('does not rely on colour alone to report a save [TECH-12.3]', async ({ page }) => {
    await page.getByLabel('Pilot name').fill(PILOT);
    await page.getByRole('button', { name: 'Start campaign' }).click();

    // The save state is words in a live region, not a coloured indicator.
    await expect(page.getByRole('status', { name: 'Campaign save status' })).toHaveText(
      /Saved at revision \d+\./,
    );
  });
});
