import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The loss report and the shipless station under automated audit
 * (Technical Specification 12.3; Functional Specification 9.12, 19.6, 20).
 *
 * A pilot sells the starter ship's autocannon and loses what is left at the
 * hard site. The sale and the payout leave them above the reference value of a
 * starter ship with its original fit, so the recovery service supplies nothing
 * and they are docked without a ship. The report that explains the loss and
 * the station that tells them how to fly again must pass the same audit as
 * every other surface, and the way back - buying a hull - must work from there.
 *
 * The client supplies a campaign's seed, so the test fixes the sixteen random
 * bytes that become it: the one survival roll then always loses the shield
 * booster, and nothing else about the game is changed.
 */

const PILOT = 'Audited Pilot';
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
    await fixSeed(page);
    await freshCampaign(page);

    // Take the autocannon off and sell it.
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await page.getByRole('button', { name: 'Change fit' }).click();
    await page.getByLabel('Module in Weapon 1').selectOption({ value: '' });
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Sell 200mm Autocannon' }).click();
    const sale = page.getByRole('dialog', { name: 'Confirm sale' });
    await expect(sale.getByText('Calculating…')).toBeHidden();
    await sale.getByRole('button', { name: 'Confirm' }).click();
    await expect(sale).toBeHidden();

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
    await expect(report.getByText(/^You have no ship\. With 33,822 ISK/)).toBeVisible();
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
