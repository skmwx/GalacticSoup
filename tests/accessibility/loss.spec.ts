import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The loss report and the shipless station under automated audit
 * (Technical Specification 12.3; Functional Specification 9.12, 19.6, 20).
 *
 * A pilot with the starting credits loses the starter ship at the hard site.
 * The payout leaves them above the starter hull's reference value, so the
 * recovery service supplies nothing and they are docked without a ship. The
 * report that explains the loss and the station that tells them how to fly
 * again must pass the same audit as every other surface, and the way back -
 * buying a hull - must work from there.
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

test.describe('loss accessibility', () => {
  test('audits the loss report and the shipless station, then buys a way back [FUNC-9.12, FUNC-19.6, FUNC-20, FUNC-22.1, TECH-12.3, MVP-AC-10]', async ({
    page,
  }) => {
    test.setTimeout(6 * 60_000);
    await freshCampaign(page);

    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Pirate Base' }).click();
    await page.getByRole('button', { name: /^Undock/ }).click();
    await page.getByLabel('Arrive at').selectOption('10');
    await page.getByRole('button', { name: /^Warp/ }).click();
    await page.getByRole('button', { name: /^Resume/ }).click();

    const report = page.getByRole('region', { name: 'Ship lost', exact: true });
    await expect(report).toBeVisible({ timeout: 4 * 60_000 });
    await page.getByRole('button', { name: /^Pause/ }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();

    // The report explains in words: attackers, what was lost, the payout and
    // why no ship was supplied.
    await expect(report.getByRole('table')).toBeVisible();
    await expect(report.getByRole('list', { name: 'Lost items' })).toBeVisible();
    await expect(report.getByText(/^You have no ship\. With 23,600 ISK/)).toBeVisible();
    await report.getByText('Show the payout calculation').click();
    await audit(page);

    // Shipless, the station says so and undocking says why it is refused.
    const notice = page.getByRole('region', { name: 'No ship', exact: true });
    await expect(notice).toBeVisible();
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Undock/ })).toBeDisabled();
    await expect(page.getByText(/You have no ship/).first()).toBeVisible();
    await audit(page);

    // Buying the starter hull makes it the active ship at once.
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Buy Wayfarer' }).click();
    const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
    await expect(purchase.getByText('Calculating…')).toBeHidden();
    await purchase.getByRole('button', { name: 'Confirm' }).click();
    await expect(purchase).toBeHidden();
    await expect(page.getByRole('region', { name: 'No ship', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Undock/ })).toBeEnabled();
    await audit(page);
  });
});
