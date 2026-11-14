import { openGameMenu } from '../support/cockpit.ts';
import { expect, test, type Page } from '@playwright/test';
import { chooseModule, fittingSlots } from '../support/fitting.ts';
import { serviceButton } from '../support/services.ts';

/**
 * The station loop in a real browser
 * (MVP-AC-01, MVP-AC-02, MVP-AC-04, MVP-AC-06).
 *
 * One flow does what a player does before their first undock: read the market,
 * inspect and compare two items, buy one, move it, change the fit, use the
 * station services, and then close and reopen the campaign to find all of it
 * still there. Everything runs against the shipped build, so the engine is in
 * the worker and the saves are in IndexedDB.
 */

const PILOT = 'Station Pilot';

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

test.describe('station interface', () => {
  test.beforeEach(async ({ page }) => {
    await freshCampaign(page);
  });

  test('prepares a ship end to end and finds it after a reopen [MVP-AC-01, MVP-AC-02, MVP-AC-06]', async ({
    page,
  }) => {
    await expect(page.getByText('20,000 ISK')).toBeVisible();

    // Inspect an item and compare it with another, from the market.
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect 200mm Autocannon' }).click();
    const inspect = page.getByRole('dialog', { name: 'Item details' });
    await expect(inspect.getByText('Module', { exact: true })).toBeVisible();
    await inspect.getByLabel('Compare with').selectOption({ label: '75mm Railgun' });
    await expect(inspect.getByText(/200mm Autocannon compared with 75mm Railgun/)).toBeVisible();
    await expect(inspect.getByRole('row', { name: /Optimal range/ })).toBeVisible();
    await page.keyboard.press('Escape');

    // Buy a module, confirming the total and the balance it leaves.
    await page.getByRole('button', { name: 'Buy Small Armour Plating' }).click();
    const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
    await expect(purchase.getByText('Balance afterwards')).toBeVisible();
    await purchase.getByRole('button', { name: 'Confirm' }).click();
    await expect(purchase).toBeHidden();
    await expect(page.getByText('20,000 ISK')).toBeHidden();

    // Fit it, and see the ship the draft would produce.
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await chooseModule(page, 'Engineering 1', 'module.plating.armor.small');
    await expect(page.getByText('Previewing changes that are not applied yet.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The ship this draft would produce' })).toBeVisible();
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();

    // The ship screen explains the result and says the fit may undock.
    await page.getByRole('button', { name: 'Ships', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Undock readiness' })).toHaveText(
      /may undock/,
    );

    // Use a station service, from the Overview, for the price on its button.
    const priced = await serviceButton(page, 'Improve insurance', true);
    const premium = /· (.+ ISK)$/.exec(await priced.innerText())?.[1];
    expect(premium).toBeDefined();
    const beforeCover = await page.getByText(/ISK$/).first().innerText();
    await priced.click();
    const insurance = page.getByRole('dialog', { name: 'Confirm insurance' });
    await expect(insurance.getByText('Enhanced', { exact: true })).toBeVisible();
    await expect(insurance.getByText(premium!, { exact: true }).first()).toBeVisible();
    await insurance.getByRole('button', { name: 'Confirm' }).click();
    await expect(insurance).toBeHidden();
    // The wallet is read back from the engine after the command; wait for it.
    await expect(page.getByText(/ISK$/).first()).not.toHaveText(beforeCover);

    const wallet = await page.getByText(/ISK$/).first().innerText();

    // Close, reopen, and find the same wallet, the same fit and the same cover.
    await openGameMenu(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();

    await expect(page.getByText(wallet, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await expect(fittingSlots(page).filter({ hasText: 'Small Armour Plating' })).toBeVisible();
    const covered = await serviceButton(page, 'Improve insurance', true);
    await expect(covered).toHaveAttribute('aria-disabled', 'true');
    await expect(covered).toHaveAccessibleDescription(/already has enhanced insurance/);
  });

  test('moves a stack between the hangar and the hold [FUNC-6.2]', async ({ page }) => {
    await page.getByRole('button', { name: 'Hangar', exact: true }).click();

    // The spare rounds start in the hold: out to the hangar, and back.
    const hangar = page.getByRole('table', { name: 'Station hangar' });
    const hold = page.getByRole('table', { name: 'Ship cargo hold' });
    await expect(hold.getByRole('rowheader', { name: 'Fusion S' })).toBeVisible();
    await page.getByRole('button', { name: 'Move all Fusion S to the hangar' }).click();
    await expect(hangar.getByRole('rowheader', { name: 'Fusion S' })).toBeVisible();
    await expect(hold.getByRole('rowheader', { name: 'Fusion S' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Move all Fusion S to the hold' }).click();
    await expect(hold.getByRole('rowheader', { name: 'Fusion S' })).toBeVisible();
    await expect(hangar.getByRole('rowheader', { name: 'Fusion S' })).toHaveCount(0);
  });

  test('explains a price instead of asserting it [MVP-AC-04, FUNC-19.6]', async ({ page }) => {
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Buy Fusion S' }).click();

    const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
    await purchase.getByText('Show the calculation').first().click();

    await expect(purchase.getByText(/station sell price = mid price/).first()).toBeVisible();
    await expect(purchase.getByText('Base price').first()).toBeVisible();
  });

  test('runs the simulation clock only while it is not paused [FUNC-3.3]', async ({ page }) => {
    const clock = page.getByText('0s', { exact: true });
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await expect(clock).toBeVisible();

    await page.getByRole('button', { name: /Resume/ }).click();
    await expect(page.getByText(/Running at 1x/)).toBeVisible();
    await expect(clock).toBeHidden({ timeout: 10_000 });

    await page.getByRole('button', { name: /Pause/ }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    const held = await page.getByText(/^\d+[smhd]/).first().innerText();
    await page.waitForTimeout(1_500);
    await expect(page.getByText(held, { exact: true }).first()).toBeVisible();
  });
});
