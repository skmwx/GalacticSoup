import { expect, type Page } from '@playwright/test';

/**
 * Undocks from the Departure surface in a browser flow (Functional
 * Specification 10, 20).
 *
 * A ship with an undock warning - an unloaded or missing weapon, unrepaired
 * armour or hull - asks for confirmation first unless the player switched the
 * question off. Flows that undock such a ship on purpose answer "Undock
 * anyway", as the player would; the question itself is tested in
 * `tests/accessibility/presentation.spec.ts`.
 */
export async function undock(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Undock/ }).click();
  const confirm = page.getByRole('dialog', { name: 'Undock with warnings?' });
  const commands = page.getByRole('heading', { name: 'Commands' });
  await expect(confirm.or(commands)).toBeVisible();
  if (await confirm.isVisible()) {
    await confirm.getByRole('button', { name: /^Undock anyway/ }).click();
    await expect(commands).toBeVisible();
  }
}
