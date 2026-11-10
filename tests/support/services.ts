import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Station services in browser flows (UIR1-06).
 *
 * Repair, resupply and insurance are on the station Overview, one priced
 * button each: Repair armour, Repair hull, Repair all, Resupply ammunition
 * and Improve insurance. A button's accessible name carries its price
 * ("Repair all · 1,234 ISK"), so flows match it by the start of its name.
 * Each still opens the shared confirmation, named after the operation.
 */

/** The Services region of the Overview. */
export function servicesRegion(page: Page): Locator {
  return page.getByRole('region', { name: 'Services', exact: true });
}

/** Opens the Overview from the rail and waits for its services. */
export async function openServices(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const region = servicesRegion(page);
  await expect(region).toBeVisible();
  return region;
}

/**
 * One service button, once the engine has priced it. `operation` is the
 * start of its name, such as "Repair all" or "Resupply ammunition"; `open`
 * first opens the Overview from the rail.
 */
export async function serviceButton(page: Page, operation: string, open = false): Promise<Locator> {
  if (open) await openServices(page);
  const button = servicesRegion(page).getByRole('button', { name: new RegExp(`^${operation}`) });
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAccessibleName(/pricing/);
  return button;
}

/**
 * Opens a service's confirmation and returns it, or returns `null` when the
 * engine says there is nothing to do (the button is unavailable).
 */
export async function openService(page: Page, operation: string, dialog: string): Promise<Locator | null> {
  const button = await serviceButton(page, operation, true);
  if ((await button.getAttribute('aria-disabled')) === 'true') return null;
  await button.click();
  const opened = page.getByRole('dialog', { name: dialog });
  await expect(opened).toBeVisible();
  return opened;
}

/**
 * Takes a service when there is something to take, confirming its quoted
 * total; a confirmation the engine refuses is cancelled. `inspect` checks the
 * open confirmation first. Resolves whether the service was taken.
 */
export async function takeService(
  page: Page,
  operation: string,
  dialog: string,
  inspect?: (opened: Locator) => Promise<void>,
): Promise<boolean> {
  const opened = await openService(page, operation, dialog);
  if (opened === null) return false;
  await inspect?.(opened);
  // A running clock can regenerate the shield or capacitor between the price
  // and the press (questions-and-answers Q12); the engine then shows the new
  // figures, and they are confirmed again - never bypassed.
  const changed = opened.getByRole('alert').filter({ hasText: 'Something changed while you were deciding.' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const confirm = opened.getByRole('button', { name: 'Confirm' });
    if (!await confirm.isEnabled()) {
      await opened.getByRole('button', { name: 'Cancel' }).click();
      await expect(opened).toBeHidden();
      return false;
    }
    await confirm.click();
    // Settled once the dialog closed, or once the press is answered (no longer
    // pending) with replacement figures.
    await expect.poll(async () => !await opened.isVisible() ||
      (await changed.isVisible() && await confirm.isEnabled())).toBe(true);
    if (!await opened.isVisible()) return true;
  }
  throw new Error(`${dialog} kept changing and was never confirmed.`);
}
