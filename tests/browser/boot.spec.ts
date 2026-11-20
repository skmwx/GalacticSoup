import { expect, test } from '@playwright/test';

import { gameMenuButton, openSettings } from '../support/cockpit.ts';
import { foreignRequests, observeRequests, originOf } from '../support/origin.ts';

/**
 * The shipped build must boot, start the dedicated engine worker and reach it
 * through the gateway, without any gameplay network request
 * (Technical Specification 2, 3.1, 3.2, 4.2, 6.3).
 *
 * One startup carries every successful-boot assertion, and opens the
 * diagnostics once for both the worker and the content bundle (Test Suite
 * Optimization Plan phase 10). It is also the one owner of the same-origin
 * evidence: it must observe the document and the engine worker's script being
 * requested, and every request the context makes must have exactly the origin
 * that serves the build. A worker that cannot start is the component suite's
 * (`tests/component/CompatibilityFailure.test.tsx`).
 */

test.describe('application boot', () => {
  test('boots from its own origin, reaches the engine through the dedicated worker and serves it the content bundle [TECH-2, TECH-3.1, TECH-3.2, TECH-4.2, TECH-6.3, FUNC-22.14]', { tag: '@feature' }, async ({
    page,
    context,
    baseURL,
  }) => {
    expect(baseURL).toBeDefined();
    const origin = originOf(baseURL ?? '');
    const requests = observeRequests(context);
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
    // A supported browser is not shown the compatibility failure.
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // The build identity is a diagnostics surface, not the main screen. It
    // names the worker transport and the content the build derived from the
    // authored content and its digest.
    await expect(page.getByLabel('Pilot name')).toBeVisible();
    await openSettings(page);
    await page.getByText('Build and engine details').click();
    await expect(page.getByText('worker', { exact: true })).toBeVisible();
    await expect(page.getByText(/^\d+ request types$/)).toBeVisible();
    await expect(page.getByText(/^\d+\.\d+\.\d+\+[0-9a-f]{12}$/)).toBeVisible();
    await expect(page.getByText(/\d+ definitions in \d+ kinds/)).toBeVisible();

    // The document and the engine worker's script were requested, from
    // exactly the origin that serves the build, and nothing came from anywhere
    // else.
    const documents = requests.filter((request) => request.resourceType === 'document');
    expect(documents.map((request) => request.url)).toEqual([`${origin}/`]);
    const worker = requests.filter((request) => /\/engineWorker-[\w-]+\.js$/.test(new URL(request.url).pathname));
    expect(worker.length).toBeGreaterThan(0);
    expect(worker.every((request) => request.origin === origin)).toBe(true);
    expect(foreignRequests(requests, origin)).toEqual([]);

    expect(consoleErrors).toEqual([]);
  });
});
