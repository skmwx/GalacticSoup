import type { Page } from '@playwright/test';

/** Follow the same management disclosures as a player; do not bypass the UI. */
export async function openGameMenu(page: Page, management = true, keyboard = false): Promise<void> {
  const activate = async (label: string): Promise<void> => {
    const summary = page.getByText(label, { exact: true });
    if (keyboard) { await summary.focus(); await page.keyboard.press('Enter'); } else await summary.click();
  };
  const menu = page.getByText('Game menu', { exact: true });
  if (!await menu.locator('..').evaluate((element) => element.hasAttribute('open'))) await activate('Game menu');
  if (management) {
    const section = page.getByText('Campaign management', { exact: true });
    if (!await section.locator('..').evaluate((element) => element.hasAttribute('open'))) await activate('Campaign management');
  }
}

export async function openGameMenuByKeyboard(page: Page, management = true): Promise<void> {
  await openGameMenu(page, management, true);
}
