import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { serviceButton } from '../support/services.ts';

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

const PANELS = ['Market', 'Hangar', 'Fitting', 'Ship'] as const;

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

  test('switches the market to Sell with the keyboard and audits both modes [TECH-12.3, FUNC-11.3]', async ({ page }) => {
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    const buyMode = page.getByRole('radio', { name: 'Buy', exact: true });
    await expect(buyMode).toBeChecked();
    // Charge suitability is words, not only a colour.
    const fusion = page.getByRole('row', { name: /^Fusion S/ });
    await expect(fusion.getByText('Fits a weapon you have fitted')).toBeVisible();
    await audit(page);

    // Arrow keys move between the two modes, as in any radio group.
    await buyMode.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Sell', exact: true })).toBeChecked();
    await expect(page.getByRole('table', { name: /Stacks you own here/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Buy / })).toHaveCount(0);

    // Icon-only controls keep item- and place-specific names and a tooltip.
    const sell = page.getByRole('button', { name: 'Sell Fusion S (Hold)' });
    await sell.focus();
    await expect(page.locator('[data-tooltip]')).toContainText('Sell Fusion S (Hold)');
    await audit(page);
  });

  test('moves a typed quantity with the keyboard and explains a refused one [TECH-12.3, FUNC-6.2]', async ({ page }) => {
    await page.getByRole('button', { name: 'Hangar', exact: true }).click();
    const hold = page.getByRole('table', { name: 'Ship cargo hold' });
    const hangar = page.getByRole('table', { name: 'Station hangar' });

    // A short visible word, the full name for assistive technology and the
    // tooltip, and the refusal in the tooltip rather than beside the control.
    const typed = page.getByRole('button', { name: 'Move the typed number of Fusion S to the hangar' });
    await expect(typed).toHaveText('Move');
    await typed.focus();
    await expect(page.locator('[data-tooltip]')).toContainText('Type how many units to move.');
    await expect(typed).toHaveAttribute('aria-disabled', 'true');

    const field = hold.getByLabel('Units of Fusion S to move');
    await field.focus();
    await page.keyboard.type('2.5');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await field.fill('');
    await page.keyboard.type('5');
    await page.keyboard.press('Tab');
    await expect(typed).toBeFocused();
    await expect(typed).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Enter');

    await expect(hangar.getByRole('row', { name: /Fusion S/ }).getByRole('cell').first()).toHaveText('5');
    await expect(hold.getByLabel('Units of Fusion S to move')).toHaveValue('');
    await audit(page);
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
    // An undamaged ship cannot be repaired, and the reason is words: the
    // tooltip that focus shows, and the button's accessible description.
    const repair = await serviceButton(page, 'Repair all', true);
    await expect(repair).toBeDisabled();
    await expect(repair).toHaveAccessibleDescription(/already fully repaired/);
    await repair.focus();
    await expect(page.getByText(/already fully repaired/).last()).toBeVisible();
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
