import { expect, test } from '@playwright/test';

import { openGameMenu } from '../support/cockpit.ts';

/**
 * The short offline flow for the branded Chrome and Edge builds
 * (Test Suite Optimization Plan phase 9; MVP Scope 9.2.4; Technical
 * Specification 2, 3.1, 3.2).
 *
 * The release gate repeats the start, save and offline flows in the Chrome and
 * Edge installed on the machine. The whole offline sortie
 * (`offline.spec.ts`) stays in the Chromium and Firefox release projects; a
 * branded build needs only to show that the loaded production bundle keeps
 * working with the network off: it changes the campaign, writes a save, and
 * closes and resumes the campaign within the page it already loaded, asking
 * for nothing and failing at nothing.
 *
 * This file runs only in the branded projects (`BRANDED_ONLY_SPECS` in
 * `config/testSelections.mjs`), so the required projects do not repeat a
 * subset of the whole sortie.
 */

const PILOT = 'Branded Offline Pilot';

test.describe('a branded build without a network', () => {
  test('loads the production bundle, then starts, buys, saves, closes and resumes a campaign offline [MVP-AC-06, TECH-2, TECH-3.1, TECH-3.2]', async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    context.on('request', (request) => requests.push(request.url()));
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    // The production bundle, its engine worker, from a clean profile.
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready over a dedicated worker\./);
    await expect(page.getByLabel('Pilot name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toHaveCount(0);

    // Where the loaded files come from is the boot case's same-origin
    // evidence, which the branded projects also run (`boot.spec.ts`).
    expect(requests.length).toBeGreaterThan(0);

    await context.setOffline(true);
    requests.length = 0;

    // Change the campaign: start it, and buy a module, which autosaves.
    await page.getByLabel('Pilot name').fill(PILOT);
    await page.getByRole('button', { name: 'Start campaign' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
    await expect(page.getByText('20,000 ISK', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Buy Small Armour Plating' }).click();
    const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
    await expect(purchase.getByText('Balance afterwards')).toBeVisible();
    await expect(purchase.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    await purchase.getByRole('button', { name: 'Confirm' }).click();
    await expect(purchase).toBeHidden();
    await expect(page.getByText('20,000 ISK', { exact: true })).toBeHidden();
    await expect(page.getByRole('status', { name: 'Campaign save status' })).toHaveText(
      /^Saved at revision [\d,]+\.$/,
      { timeout: 30_000 },
    );
    const wallet = await page.locator('dd').filter({ hasText: /ISK$/ }).first().innerText();

    // Close and resume within the loaded page: the save store is local.
    await openGameMenu(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await expect(page.getByText(new RegExp(`Saved campaign: ${PILOT}`))).toBeVisible();
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: /ISK$/ }).first()).toHaveText(wallet);
    await page.getByRole('button', { name: 'Hangar', exact: true }).click();
    await expect(
      page.getByRole('table', { name: 'Station hangar' }).getByRole('rowheader', { name: 'Small Armour Plating' }),
    ).toBeVisible();

    // With the network off, the game asked for nothing and nothing failed.
    expect(requests).toEqual([]);
    expect(problems).toEqual([]);
  });
});
