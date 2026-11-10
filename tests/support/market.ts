import { expect, type Page } from '@playwright/test';

/**
 * Chooses the market's Buy or Sell mode (UIR1-03). The market shows one
 * direction at a time and opens in Buy, so a flow that sells - or buys again
 * after selling - says which side it wants.
 */
export async function marketMode(page: Page, mode: 'Buy' | 'Sell'): Promise<void> {
  const option = page.getByRole('radio', { name: mode, exact: true });
  await option.check();
  await expect(option).toBeChecked();
}
