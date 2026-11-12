import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Browser helpers for the space navigation destinations (MVP UI review 01,
 * UIR1-07).
 *
 * The ship undocks with no destination; the station, the encounter sites and
 * the player's own wrecks are chosen in space from the Destinations section of
 * the navigation panel's Warp tab. Choosing one shows its briefing and moves
 * nothing; the Warp button beside it - or Dock, for the station from its own
 * site - sends the ordinary command.
 *
 * The navigation panel shows one of two views (MVP review 02): Warp, which it
 * opens on at the station's site, and Local - the orders, locking and the list
 * of what is in the site - which it opens on anywhere else. The helpers that
 * act on destinations show the Warp view first.
 */

/** Shows one of the navigation panel's two views, if it is not showing already. */
export async function showNavigationView(page: Page, view: 'Warp' | 'Local'): Promise<void> {
  const tab = page.getByRole('tab', { name: view, exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The station's authored name, as the chooser shows it. */
export const HOME_STATION = 'Borrell Harbour';

export function destinations(page: Page): Locator {
  return page.getByRole('region', { name: 'Destinations' });
}

/** The chooser entry whose name starts with `name`. */
export function destinationEntry(page: Page, name: string | RegExp): Locator {
  return destinations(page).getByRole('button', {
    name: typeof name === 'string' ? new RegExp(`^${escape(name)}`) : name,
  });
}

/** The chosen destination's briefing. */
export function destinationBriefing(page: Page): Locator {
  return destinations(page).getByRole('group', { name: 'Destination briefing' });
}

/** Chooses a destination in space; it is recorded but nothing moves. */
export async function chooseDestination(page: Page, name: string | RegExp): Promise<void> {
  await showNavigationView(page, 'Warp');
  const entry = destinationEntry(page, name);
  await entry.click();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Chooses a destination and warps to it, arriving the given distance away.
 * `label` is the warp control's name when it differs from the destination's,
 * as it does for a wreck ("Warp to your wreck at ...").
 */
export async function warpTo(
  page: Page,
  name: string | RegExp,
  arrivalKm: number | null = null,
  label: RegExp = typeof name === 'string' ? new RegExp(`^Warp to ${escape(name)}`) : /^Warp to/,
): Promise<void> {
  await chooseDestination(page, name);
  if (arrivalKm !== null) {
    await destinations(page).getByLabel('Arrive at').selectOption(String(arrivalKm));
  }
  const warp = destinations(page).getByRole('button', { name: label });
  await expect(warp).toBeEnabled();
  await warp.click();
}

/** Warps home to the station's site through the station destination. */
export async function warpHome(page: Page): Promise<void> {
  await warpTo(page, HOME_STATION, 0);
}

/**
 * Docks at the station from its own site, through the station destination.
 * The station is chosen first, so this works whatever was chosen before.
 */
export async function dockHome(page: Page): Promise<void> {
  await chooseDestination(page, HOME_STATION);
  const dock = destinations(page).getByRole('button', { name: new RegExp(`^Dock at ${HOME_STATION}`) });
  await expect(dock).toBeEnabled();
  await dock.click();
}

/**
 * An object's entry in the list of objects in the site, on the Local view.
 * The destination chooser also names the station, so a bare name match is
 * ambiguous.
 */
export function siteObject(page: Page, name: RegExp): Locator {
  return page
    .locator('section', { has: page.getByRole('heading', { name: 'In this site' }) })
    .getByRole('button', { name });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
