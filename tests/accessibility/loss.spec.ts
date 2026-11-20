import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { openCheckpoint } from '../support/checkpoint/browser.ts';

/**
 * The loss report and the shipless station under automated audit
 * (Technical Specification 12.3; Functional Specification 9.12, 19.6, 20).
 *
 * A pilot has sold the starter ship's autocannon and lost what was left at
 * the hard site. The sale and the payout leave them above the reference value
 * of a starter ship with its original fit, so the recovery service supplied
 * nothing and they are docked without a ship. The report that explains the
 * loss and the station that tells them how to fly again must pass the same
 * audit as every other surface, and the way back - buying a hull - must work
 * from there.
 *
 * The case begins after the loss (Test Suite Optimization Plan phase 8): the
 * campaign was played to the destruction headlessly, saved, and is opened
 * through the start screen and the worker. The helper first checks what the
 * station shows: the wallet, the lost sortie and the report's every lost and
 * surviving item. Playing the destruction itself in the browser, and the
 * reload that only its autosave survives, are `tests/browser/loss.spec.ts`'s
 * evidence.
 */

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe('loss accessibility', () => {
  test('audits the loss report and the shipless station, then buys a way back [FUNC-9.12, FUNC-19.6, FUNC-20, FUNC-22.1, TECH-12.3, MVP-AC-10]', async ({
    page,
    baseURL,
  }) => {
    await openCheckpoint(page, 'loss-shipless', baseURL);
    const report = page.getByRole('region', { name: 'Ship lost', exact: true });

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
