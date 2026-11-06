import { expect, test, type Page } from '@playwright/test';
import { openGameMenu } from '../support/cockpit.ts';

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Pilot name').fill('Cockpit Pilot');
  await page.getByRole('button', { name: 'Start campaign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Borrell Harbour', exact: true })).toBeVisible();
}

test('keeps campaign management separate and allows briefing inspection without choosing a destination', async ({ page }) => {
  await start(page);
  await expect(page.getByRole('button', { name: 'Reset campaign', exact: true })).toHaveCount(0);
  await openGameMenu(page);
  await page.getByRole('button', { name: 'Reset campaign', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete this campaign', exact: true })).toBeVisible();
  await page.getByText('Game menu', { exact: true }).click();
  await openGameMenu(page);
  await expect(page.getByRole('button', { name: 'Delete this campaign', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset campaign', exact: true }).click();
  await page.getByRole('button', { name: 'Keep playing', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Game menu', { exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Reset campaign', exact: true })).toHaveCount(0);

  await page.locator('[data-action="station.departure"]').click();
  await page.locator('[data-destination="encounter.borrell.pirate-base"] button[aria-pressed]').click();
  await expect(page.getByRole('region', { name: 'Site briefing' })).toContainText('A starter fit will not survive this one.');
  await expect(page.getByText('No destination chosen yet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose Pirate Scout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Site briefing' })).toContainText('Pirate Scout');
  await expect(page.locator('[data-selection="encounter"]')).toContainText('Pirate Scout');
});

test('keeps frequent flight controls in the desktop working view and reflows without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page);
  await page.locator('[data-action="station.departure"]').click();
  const undock = page.getByRole('button', { name: 'Undock', exact: true });
  const departureBox = await undock.boundingBox();
  expect(departureBox).not.toBeNull();
  expect(departureBox!.y + departureBox!.height).toBeLessThanOrEqual(900);
  await page.getByRole('button', { name: 'Choose Pirate Scout', exact: true }).click();
  await undock.click();
  await expect(page.getByRole('heading', { name: 'In this site' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const action of ['time.toggle', 'movement.stop', 'weapons.fire', 'module.toggle.1']) {
    const box = await page.locator(`button[data-action="${action}"]`).first().boundingBox();
    expect(box, action).not.toBeNull();
    expect(box!.y, action).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, action).toBeLessThanOrEqual(900);
  }
  for (const width of [1920, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `overflow at ${width}px`).toBe(true);
    await expect(page.locator('[data-panel="status"]')).toBeVisible();
    await expect(page.locator('[data-panel="weapons"]')).toBeVisible();
  }
});
