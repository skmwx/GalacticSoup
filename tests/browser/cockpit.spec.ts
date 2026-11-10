import { expect, test, type Page } from '@playwright/test';
import { gameMenuButton, openGameMenu } from '../support/cockpit.ts';
import { chooseDestination, destinationBriefing } from '../support/destinations.ts';

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Pilot name').fill('Cockpit Pilot');
  await page.getByRole('button', { name: 'Start campaign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Borrell Harbour', exact: true })).toBeVisible();
}

test('keeps campaign management separate, undocks without a destination and reads briefings in space without moving', async ({ page }) => {
  await start(page);
  await expect(page.getByRole('button', { name: 'Reset campaign', exact: true })).toHaveCount(0);
  await openGameMenu(page);
  await page.getByRole('button', { name: 'Reset campaign', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete this campaign', exact: true })).toBeVisible();
  await gameMenuButton(page).click();
  await openGameMenu(page);
  await expect(page.getByRole('button', { name: 'Delete this campaign', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset campaign', exact: true }).click();
  await page.getByRole('button', { name: 'Keep playing', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(gameMenuButton(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Reset campaign', exact: true })).toHaveCount(0);

  await page.locator('[data-action="station.departure"]').click();
  await expect(page.getByText('No destination needed: you choose one in space.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-selection="none"]')).toBeVisible();
  await page.getByRole('button', { name: /^Undock/ }).click();
  await expect(page.getByRole('heading', { name: 'Navigation' })).toBeVisible();

  await chooseDestination(page, 'Pirate Base');
  await expect(destinationBriefing(page)).toContainText('A starter fit will not survive this one.');
  await chooseDestination(page, 'Pirate Scout');
  await expect(destinationBriefing(page)).toContainText('Pirate Scout');
  // Reading briefings never moves the ship.
  await expect(page.locator('[data-readout="order"]')).toHaveText('Holding position');
});

test('keeps frequent flight controls in the desktop working view and reflows without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page);
  await page.locator('[data-action="station.departure"]').click();
  const undock = page.getByRole('button', { name: 'Undock', exact: true });
  const departureBox = await undock.boundingBox();
  expect(departureBox).not.toBeNull();
  expect(departureBox!.y + departureBox!.height).toBeLessThanOrEqual(900);
  await undock.click();
  await expect(page.getByRole('heading', { name: 'In this site' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  // One equipment panel holds the weapons and modules, beside Navigation and beneath the radar.
  await expect(page.locator('[data-panel="equipment"]')).toHaveCount(1);
  await expect(page.locator('[data-panel="equipment"] [data-panel="weapons"]')).toBeVisible();
  await expect(page.locator('[data-panel="equipment"] [data-panel="modules"]')).toBeVisible();
  const radar = (await page.locator('svg[data-course]').boundingBox())!;
  const navigation = (await page.locator('[data-panel="navigation"]').boundingBox())!;
  const equipment = (await page.locator('[data-panel="equipment"]').boundingBox())!;
  expect(navigation.y).toBeGreaterThanOrEqual(radar.y + radar.height);
  expect(Math.abs(equipment.y - navigation.y)).toBeLessThan(1);
  expect(equipment.x).toBeGreaterThanOrEqual(navigation.x + navigation.width);
  // The player's ship is drawn on the radar but not listed among the site's objects.
  await expect(page.locator('[data-layer="objects"] [data-player="true"]')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'In this site', exact: true }).getByRole('button', { name: /Your ship/ })).toHaveCount(0);
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
    await expect(page.locator('[data-panel="navigation"]')).toBeVisible();
  }
  // At 390 pixels the columns stack in reading order: Navigation, then the equipment.
  const stackedNavigation = (await page.locator('[data-panel="navigation"]').boundingBox())!;
  const stackedEquipment = (await page.locator('[data-panel="equipment"]').boundingBox())!;
  expect(stackedEquipment.y).toBeGreaterThanOrEqual(stackedNavigation.y + stackedNavigation.height);
});
