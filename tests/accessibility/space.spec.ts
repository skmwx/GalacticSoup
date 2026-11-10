import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { chooseDestination, destinationEntry, destinations, siteObject } from '../support/destinations.ts';

/**
 * The space view under keyboard-only operation
 * (Technical Specification 12.2, 12.3; Functional Specification 20).
 *
 * The drawing is an image; the controls beside it are ordinary buttons. That
 * is what lets a player select an object, give an order and dock again without
 * a pointer, and what keeps the semantic states readable without colour.
 */

const PILOT = 'Keyboard Navigator';

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

async function undock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Departure', exact: true }).click();
  await page.getByRole('button', { name: /^Undock/ }).click();
  await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
}

test.describe('space accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await freshCampaign(page);
  });

  test('passes an automated audit on the departure and space surfaces [TECH-12.3]', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await audit(page);

    await page.getByRole('button', { name: /^Undock/ }).click();
    await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
    await audit(page);

    // The destinations and a briefing pass too.
    await chooseDestination(page, 'Pirate Patrol');
    await audit(page);
  });

  test('describes the drawing instead of exposing its shapes [TECH-12.2]', async ({ page }) => {
    await undock(page);

    // One image with a description, not a tree of unlabelled shapes.
    await expect(page.getByRole('img', { name: /Schematic view of Borrell Harbour/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /showing 2 objects/ })).toBeVisible();
  });

  test('selects an object and gives an order with the keyboard alone [TECH-12.3, FUNC-20]', async ({
    page,
  }) => {
    await undock(page);

    const station = siteObject(page, /Borrell Harbour/);
    await station.focus();
    await page.keyboard.press('Enter');
    await expect(station).toHaveAttribute('aria-pressed', 'true');

    // The registry's shortcut gives the order without a pointer.
    await page.keyboard.press('a');
    await expect(page.locator('[data-readout="order"]')).toHaveText('Approaching');
  });

  test('says why an order is unavailable rather than hiding it [TECH-12.3, FUNC-22.10]', async ({
    page,
  }) => {
    await undock(page);

    // There is no separate retreat button any more: the station is one of
    // the destinations.
    await expect(page.getByRole('button', { name: /^Retreat/ })).toHaveCount(0);

    const approach = page.getByRole('button', { name: /^Approach/ });
    await expect(approach).toBeVisible();
    await expect(approach).toBeDisabled();
    await expect(approach).toHaveAccessibleDescription(/Select something in the view or the list first\./);
  });

  test('chooses a destination and warps with the keyboard alone [MVP-AC-03, FUNC-20]', async ({ page }) => {
    await undock(page);

    const patrol = destinationEntry(page, 'Pirate Patrol');
    await patrol.focus();
    await page.keyboard.press('Enter');
    await expect(patrol).toHaveAttribute('aria-pressed', 'true');
    await expect(destinations(page).getByRole('group', { name: 'Destination briefing' })).toContainText('Pirate Patrol');

    // The station's own site offers docking, not a warp to where the ship is.
    const home = destinationEntry(page, 'Borrell Harbour');
    await home.focus();
    await page.keyboard.press('Enter');
    await expect(destinations(page).getByRole('button', { name: /^Dock at Borrell Harbour/ })).toBeEnabled();
    await expect(destinations(page).getByRole('button', { name: /^Warp to/ })).toHaveCount(0);

    // The warp key sends the chosen warp; nothing moved before it.
    await patrol.focus();
    await page.keyboard.press('Enter');
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('w');
    await expect(page.getByText(/Aligning for warp/).first()).toBeVisible();
  });

  test('sets a course with the keyboard alone through the point menu [FUNC-20, FUNC-19.2, TECH-12.3]', async ({ page }) => {
    await undock(page);
    const view = page.getByRole('img', { name: /Schematic view/ });
    await expect(view).toHaveAccessibleDescription('Right-click empty space to set a course.');

    // The remappable set-course key opens the point menu on the view's centre,
    // announces the point and puts focus on Set course.
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('.');
    const menu = page.getByRole('group', { name: 'Commands for empty space' });
    await expect(menu).toBeVisible();
    const setCourse = menu.getByRole('button', { name: /^Set course/ });
    await expect(setCourse).toBeFocused();
    const status = menu.getByRole('status');
    await expect(status).toHaveText(/from your ship/);
    await audit(page);

    // The arrow keys move the point; the announcement follows it.
    const before = await status.textContent();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await expect(status).not.toHaveText(before ?? '');

    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('[data-readout="order"]')).toHaveText('Moving to a point');

    // The radar button opens the same menu and takes focus back on Escape.
    const button = page.getByRole('button', { name: /^Set course on the radar/ });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('stays readable at a doubled interface scale [TECH-12.3]', async ({ page }) => {
    await undock(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--gs-ui-scale', '2');
      document.documentElement.style.setProperty('--gs-text-scale', '2');
    });

    await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
