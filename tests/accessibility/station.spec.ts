import { expect, test, type Page } from '@playwright/test';

import { audit } from '../support/axe.ts';
import { serviceButton } from '../support/services.ts';

/**
 * The station surfaces under keyboard-only operation
 * (Technical Specification 12.3; Functional Specification 20).
 *
 * This is the baseline the station screens are built to: every surface passes
 * an automated audit, every action is reachable and operable from the
 * keyboard, and a refusal is said in words.
 *
 * The audits of every station surface and of the purchase confirmation, at
 * the standard and the doubled presentation, and the focus trap and return of
 * every confirmation are owned by `presentation.spec.ts` (Test Suite
 * Optimization Plan phase 10a). This file keeps what only it shows: the Sell
 * mode and its radio keys, a typed quantity and its refusal, a purchase by
 * keyboard alone, and a refused service explained without colour.
 */

const PILOT = 'Keyboard Pilot';

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

test.describe('station accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await freshCampaign(page);
  });

  test('switches the market to Sell with the keyboard and audits the Sell mode [TECH-12.3, FUNC-11.3]', async ({ page }) => {
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    const buyMode = page.getByRole('radio', { name: 'Buy', exact: true });
    await expect(buyMode).toBeChecked();
    // Charge suitability is words, not only a colour. The Buy mode itself is
    // audited by the presentation matrix.
    const fusion = page.getByRole('row', { name: /^Fusion S/ });
    await expect(fusion.getByText('Fits a weapon you have fitted')).toBeVisible();

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

  test('reaches a surface and a purchase with the keyboard alone [TECH-12.3]', { tag: '@feature' }, async ({ page }) => {
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

  test('does not rely on colour alone to report a refusal [TECH-12.3]', async ({ page }) => {
    // An undamaged ship cannot be repaired, and the reason is words: the
    // tooltip that focus shows, and the button's accessible description.
    const repair = await serviceButton(page, 'Repair all', true);
    await expect(repair).toBeDisabled();
    await expect(repair).toHaveAccessibleDescription(/already fully repaired/);
    await repair.focus();
    await expect(page.getByText(/already fully repaired/).last()).toBeVisible();
  });
});
