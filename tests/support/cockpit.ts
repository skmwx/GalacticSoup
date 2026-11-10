import type { Locator, Page } from '@playwright/test';

/** The icon-only game-menu trigger, named "Game menu" for assistive technology. */
export function gameMenuButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Game menu', exact: true });
}

/** Follow the same menu and disclosures as a player; do not bypass the UI. */
export async function openGameMenu(page: Page, management = true, keyboard = false): Promise<void> {
  const menu = gameMenuButton(page);
  if (await menu.getAttribute('aria-expanded') !== 'true') {
    if (keyboard) { await menu.focus(); await page.keyboard.press('Enter'); } else await menu.click();
  }
  if (management) {
    const summary = page.getByText('Campaign management', { exact: true });
    if (!await summary.locator('..').evaluate((element) => element.hasAttribute('open'))) {
      if (keyboard) { await summary.focus(); await page.keyboard.press('Enter'); } else await summary.click();
    }
  }
}

export async function openGameMenuByKeyboard(page: Page, management = true): Promise<void> {
  await openGameMenu(page, management, true);
}

/** Settings is the game menu's last entry, before a campaign and during play alike. */
export async function openSettings(page: Page, keyboard = false): Promise<void> {
  await openGameMenu(page, false, keyboard);
  const entry = page.getByRole('button', { name: /^Settings/ });
  if (keyboard) { await entry.focus(); await page.keyboard.press('Enter'); } else await entry.click();
}
