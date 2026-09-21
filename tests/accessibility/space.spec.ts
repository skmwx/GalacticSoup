import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
  await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
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

    await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
    await page.getByRole('button', { name: /^Undock/ }).click();
    await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
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

    const station = page.getByRole('button', { name: /Borrell Harbour/ }).last();
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

    const retreat = page.getByRole('button', { name: /^Retreat/ });
    await expect(retreat).toBeVisible();
    await expect(retreat).toBeDisabled();
    await expect(page.getByText('There is no combat site to retreat from.')).toBeVisible();
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
