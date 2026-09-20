import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The station surfaces under keyboard-only operation
 * (Technical Specification 12.3; Functional Specification 20).
 *
 * This is the baseline the station screens are built to: every surface passes
 * an automated audit, every action is reachable and operable from the
 * keyboard, and a modal confirmation traps focus and gives it back. The full
 * accessibility pass over the finished game is a later phase.
 */

const PILOT = 'Keyboard Pilot';

const PANELS = ['Market', 'Hangar', 'Fitting', 'Services', 'Ship'] as const;

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

test.describe('station accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await freshCampaign(page);
  });

  test('passes an automated audit on every station surface [TECH-12.3]', async ({ page }) => {
    await audit(page);

    for (const panel of PANELS) {
      await page.getByRole('button', { name: panel, exact: true }).click();
      await expect(page.getByRole('button', { name: panel, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await audit(page);
    }
  });

  test('passes an automated audit inside a confirmation [TECH-12.3]', async ({ page }) => {
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Buy Fusion S' }).click();

    await expect(page.getByRole('dialog', { name: 'Confirm purchase' })).toBeVisible();
    await audit(page);
  });

  test('reaches a surface and a purchase with the keyboard alone [TECH-12.3]', async ({ page }) => {
    // The registry's shortcut opens the market without a pointer.
    await page.keyboard.press('m');
    await expect(page.getByRole('heading', { name: 'Local market' })).toBeVisible();

    const buy = page.getByRole('button', { name: 'Buy Fusion S' });
    await buy.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Confirm purchase' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm' }).focus();
    await page.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    await expect(page.getByText('20,000 ISK')).toBeHidden();
  });

  test('traps focus in a confirmation and returns it afterwards [TECH-12.3]', async ({ page }) => {
    await page.getByRole('button', { name: 'Market', exact: true }).click();

    const opener = page.getByRole('button', { name: 'Buy Fusion S' });
    await opener.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Confirm purchase' });
    await expect(dialog).toBeVisible();

    // Tabbing past the last control comes back to the first one, so focus
    // never escapes behind the overlay.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(inside).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('does not rely on colour alone to report a refusal [TECH-12.3]', async ({ page }) => {
    await page.getByRole('button', { name: 'Services', exact: true }).click();
    await page.getByRole('button', { name: 'Repair the ship' }).click();

    // An undamaged ship cannot be repaired, and the reason is words.
    const dialog = page.getByRole('dialog', { name: 'Confirm repair' });
    await expect(dialog.getByText(/already fully repaired/).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Confirm/ })).toBeDisabled();
  });

  test('stays readable at a doubled interface scale [TECH-12.3]', async ({ page }) => {
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--gs-ui-scale', '2');
      document.documentElement.style.setProperty('--gs-text-scale', '2');
    });

    await expect(page.getByRole('heading', { name: 'Local market' })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
