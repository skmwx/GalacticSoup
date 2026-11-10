import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The fitting screen in browser flows (UIR1-05).
 *
 * Fitting is edited in place: each slot row has a Change module control and
 * each weapon row a Change ammunition control, and each opens a short list of
 * the engine's choices. The first change opens the engine draft; Apply fit
 * commits it. Choices are picked by definition id (`data-value`), so a flow
 * does not depend on display names; `''` empties the slot or unloads the
 * weapon.
 */
export async function chooseModule(page: Page, slot: string, moduleId: string): Promise<void> {
  await choose(page, `Change module in ${slot}`, `Modules for ${slot}`, moduleId);
  await expect(slotRow(page, slot)).toHaveAttribute('data-module', moduleId);
}

export async function chooseAmmunition(page: Page, slot: string, ammunitionId: string): Promise<void> {
  await choose(page, `Change ammunition in ${slot}`, `Ammunition for ${slot}`, ammunitionId);
  await expect(slotRow(page, slot)).toHaveAttribute('data-charge', ammunitionId);
}

/** One slot row, by its visible name such as "Weapon 1". */
export function slotRow(page: Page, slot: string): Locator {
  return page.locator(`[data-slot-name="${slot}"]`);
}

/** The slot rows of the fitting screen. */
export function fittingSlots(page: Page): Locator {
  return page.getByRole('list', { name: 'Modules', exact: true }).getByRole('listitem');
}

/** Applies the open draft and waits until the screen shows the fitted ship again. */
export async function applyFit(page: Page): Promise<void> {
  const apply = page.getByRole('button', { name: 'Apply fit' });
  await expect(apply).not.toHaveAttribute('aria-disabled', 'true');
  await apply.click();
  await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
}

async function choose(page: Page, trigger: string, list: string, value: string): Promise<void> {
  await page.getByRole('button', { name: trigger, exact: true }).click();
  const choices = page.getByRole('group', { name: list, exact: true });
  const choice = choices.locator(`button[data-value="${value}"]`);
  await expect(choice).toBeVisible();
  if ((await choice.getAttribute('aria-pressed')) === 'true') {
    await page.keyboard.press('Escape');
  } else {
    await choice.click();
  }
  await expect(choices).toBeHidden();
}
