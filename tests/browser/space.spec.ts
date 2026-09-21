import { expect, test, type Page } from '@playwright/test';

/**
 * The traversal loop in a real browser
 * (MVP-AC-01, MVP-AC-03, MVP-AC-08).
 *
 * One flow does what a player does between two visits to the station: choose
 * a site, undock, give orders in the schematic view, warp out, retreat, warp
 * back and dock. Everything runs against the shipped build, so the engine is
 * in the worker, the saves are in IndexedDB, and every order crosses the
 * gateway exactly as it does in play.
 */

const PILOT = 'Traversal Pilot';

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

async function undock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Departure', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
  await expect(page.getByText('Destination: Pirate Scout')).toBeVisible();
  await page.getByRole('button', { name: /^Undock/ }).click();
  await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
}

test.describe('traversal', () => {
  test.beforeEach(async ({ page }) => {
    await freshCampaign(page);
  });

  test('undocks, flies, warps, retreats, docks and resumes [MVP-AC-03, MVP-AC-08, MVP-AC-01]', async ({
    page,
  }) => {
    // Two warps across the system and a docking cycle all run on the
    // simulation clock at 1x, so this flow takes simulated - and therefore
    // real - minutes rather than seconds.
    test.setTimeout(180_000);
    await undock(page);

    // The site view names where the ship is and what is in range.
    await expect(page.getByRole('img', { name: /Schematic view of Borrell Harbour/ })).toBeVisible();
    await expect(page.getByText('Borrell Harbour, Borrell — danger 1')).toBeVisible();

    // Selecting the station enables the orders that need a target.
    await expect(page.getByRole('button', { name: /^Orbit/ })).toBeDisabled();
    await page
      .getByRole('button', { name: /Borrell Harbour/ })
      .last()
      .click();
    await page.getByLabel('Range').selectOption('5');
    await page.getByRole('button', { name: /^Orbit/ }).click();
    await expect(page.getByText('Orbiting')).toBeVisible();

    // Running the clock moves the ship, and only the engine moves it.
    await page.getByRole('button', { name: /Resume/ }).click();
    await expect(page.locator('[data-readout="speed"]')).not.toHaveText('0 km/s', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /^Stop/ }).click();
    await expect(page.getByText('Holding position')).toBeVisible();

    // Warp to the chosen encounter, and arrive in a site of its own.
    await page.getByLabel('Destination').selectOption('site.borrell.verge');
    await page.getByLabel('Arrive at').selectOption('30');
    await page.getByRole('button', { name: /^Warp/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Verge Belt' })).toBeVisible({
      timeout: 30_000,
    });

    // Retreat brings the ship home, where the station can be docked with.
    await expect(page.getByRole('button', { name: /^Retreat/ })).toBeEnabled();
    await page.getByRole('button', { name: /^Retreat/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: /^Dock/ }).click();
    await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Pause/ }).click();

    // Reopening finds the ship where the engine left it.
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible();
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByText('Destination: Pirate Scout')).toBeVisible();
  });

  test('resumes in the site it was closed in [MVP-AC-01, FUNC-3.4]', async ({ page }) => {
    await undock(page);
    await page.getByRole('button', { name: /Borrell Harbour/ }).last().click();
    await page.getByRole('button', { name: /^Approach/ }).click();
    await expect(page.getByText('Approaching')).toBeVisible();

    await page.getByRole('button', { name: /Close campaign/ }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();

    await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
    await expect(page.getByText('Approaching')).toBeVisible();
  });

  test('sets a course by clicking the schematic view [FUNC-19.2]', async ({ page }) => {
    await undock(page);

    await page.getByRole('button', { name: 'Pick a point' }).click();
    const view = page.getByRole('img', { name: /Schematic view/ });
    await expect(view).toHaveAttribute('data-choosing', 'true');
    const box = await view.boundingBox();
    if (box === null) throw new Error('The view was not laid out.');
    await view.click({ position: { x: box.width * 0.25, y: box.height * 0.25 } });

    // The click filled the coordinates, and the course is still an engine
    // command rather than something the view did on its own.
    await expect(page.getByLabel('X (km)')).not.toHaveValue('0');
    await page.getByRole('button', { name: 'Set course' }).click();
    await expect(page.getByText('Moving to a point')).toBeVisible();
  });
});
