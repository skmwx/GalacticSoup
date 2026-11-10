import { expect, test, type Page } from '@playwright/test';

import { gameMenuButton, openSettings } from '../support/cockpit.ts';

/**
 * The shipped build must boot, start the dedicated engine worker and reach it
 * through the gateway, without any gameplay network request
 * (Technical Specification 2, 3.1, 3.2, 4.2).
 */

/** Diagnostics are a section of Settings, reached from the game menu, outside the gameplay layout. */
async function openBuildDetails(page: Page): Promise<void> {
  await expect(page.getByLabel('Pilot name')).toBeVisible();
  await openSettings(page);
  await page.getByText('Build and engine details').click();
}

test.describe('application boot', () => {
  test('reaches the engine through the dedicated worker [TECH-3.1, TECH-4.2]', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/');

    // The document keeps its title for assistive technology, but no title band
    // or routine readiness text takes screen space: only the game menu shows.
    await expect(page.getByRole('heading', { level: 1, name: 'Galactic Soup' })).toHaveCount(1);
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready over a dedicated worker\./);
    await expect(page.getByRole('status', { name: 'Engine status' }).locator('..')).toHaveCSS('position', 'absolute');
    await expect(page.getByText('A single-player space trading, exploration and combat game.')).toHaveCount(0);
    await expect(gameMenuButton(page)).toBeVisible();

    // The build identity is a diagnostics surface, not the main screen.
    await openBuildDetails(page);
    await expect(page.getByText('worker', { exact: true })).toBeVisible();
    await expect(page.getByText(/^\d+ request types$/)).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('serves the compiled content bundle to the worker [TECH-6.3]', async ({ page }) => {
    await page.goto('/');

    await openBuildDetails(page);
    // The version the build derived from the authored content and its digest.
    await expect(page.getByText(/^\d+\.\d+\.\d+\+[0-9a-f]{12}$/)).toBeVisible();
    await expect(page.getByText(/\d+ definitions in \d+ kinds/)).toBeVisible();
  });

  test('makes no request outside its own origin [TECH-2, TECH-3.2, FUNC-22.14]', async ({ page, baseURL }) => {
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (baseURL !== undefined && !request.url().startsWith(baseURL)) {
        foreign.push(request.url());
      }
    });

    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);

    expect(foreign).toEqual([]);
  });

  test('does not show the compatibility failure on a supported browser [TECH-4.2]', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});
