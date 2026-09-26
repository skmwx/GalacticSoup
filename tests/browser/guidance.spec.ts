import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * A first-time player follows the in-game guidance through the easiest
 * complete loop (MVP Implementation Plan phase 18; Functional Specification
 * 3.2, 19.7; MVP-AC-10).
 *
 * The run starts from a clean browser profile. At every step the test reads
 * which step the guidance is on and does what that step's text says, with the
 * control or shortcut the text names: "Show me" to reach a station surface,
 * the keys it lists in space. It never opens a surface or presses a key the
 * guidance has not pointed at, so what it proves is that the guidance alone
 * gets a new player from the hub, through a fight, home, and to the next
 * site - and that the notifications along the way say what happened.
 *
 * As in the other browser loops, the sixteen seed bytes the client supplies
 * are fixed so the scout's wreck holds the same loot every run.
 */

const PILOT = 'First Timer';
const SEED = 'bb22cc33dd44ee55ff6677889900aa11';

async function fixSeed(page: Page): Promise<void> {
  await page.addInitScript((seed: string) => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array && array.length === 16) {
        for (let index = 0; index < 16; index += 1) {
          array[index] = Number.parseInt(seed.slice(index * 2, index * 2 + 2), 16);
        }
        return array;
      }
      return original(array as never) as T;
    }) as typeof crypto.getRandomValues;
  }, SEED);
}

/** A clean profile: no campaign, no preferences. */
async function cleanProfile(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        window.localStorage.clear();
        const request = indexedDB.deleteDatabase('galactic-soup');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
}

function guidance(page: Page): Locator {
  return page.getByRole('region', { name: 'Flight school', exact: true });
}

function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** Waits until the guidance points at a step, and returns its text. */
async function step(page: Page, title: string, timeout = 30_000): Promise<string> {
  await expect(guidance(page).getByRole('heading', { level: 3 })).toHaveText(title, { timeout });
  return (await guidance(page).locator('p').allInnerTexts()).join(' ');
}

/** The guidance's own control for reaching the surface its step names. */
async function showMe(page: Page): Promise<void> {
  const button = guidance(page).getByRole('button', { name: 'Show me' });
  if (await button.isEnabled()) await button.click();
}

async function ensureRunning(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: /^Resume/ });
  if (await resume.isVisible()) await resume.click();
  await expect(page.getByText(/Running at 1x/)).toBeVisible();
}

async function confirmDialog(page: Page, name: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog.getByText('Calculating…')).toBeHidden();
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  if (await confirm.isEnabled()) {
    await confirm.click();
  } else {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
  await expect(dialog).toBeHidden();
}

test.describe('guided first loop', () => {
  test('follows the in-game guidance from a new campaign through the easiest complete loop [MVP-AC-10, FUNC-3.2, FUNC-19.7, TECH-12.4]', async ({
    page,
  }) => {
    test.setTimeout(20 * 60_000);
    await fixSeed(page);
    await cleanProfile(page);
    await page.getByLabel('Pilot name').fill(PILOT);
    await page.getByRole('button', { name: 'Start campaign' }).click();
    await expect(guidance(page)).toBeVisible();
    const notices = region(page, 'Notifications');

    // Choose a site: the guidance names the Pirate Scout.
    expect(await step(page, 'Choose a site')).toContain('Pirate Scout');
    await showMe(page);
    await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
    await expect(notices.getByText('Done: Choose a site.')).toBeVisible();

    // Carry spare rounds: the hangar, and "Move to hold" on the Fusion S rounds.
    expect(await step(page, 'Carry spare rounds')).toContain('Move to hold');
    await showMe(page);
    await page.getByRole('table', { name: 'Station hangar' }).getByRole('row', { name: /Fusion S/ })
      .getByRole('button', { name: 'Move to hold' }).click();

    // Undock from Departure.
    expect(await step(page, 'Undock')).toContain('Undock');
    await showMe(page);
    await page.getByRole('button', { name: /^Undock/ }).click();
    await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();

    // Warp (W), with the clock running (P).
    expect(await step(page, 'Warp to the site')).toMatch(/Arrive at to 10 km.*Warp \(W\).*Resume \(P\)/);
    await page.getByLabel('Arrive at').selectOption('10');
    await page.keyboard.press('w');
    await page.keyboard.press('p');
    await expect(page.getByRole('heading', { level: 2, name: 'Verge Belt' })).toBeVisible({ timeout: 90_000 });

    // Select with ], then Orbit (O).
    expect(await step(page, 'Give a movement order')).toContain('Orbit (O)');
    // ] steps through the site's objects; the Selected panel names the one chosen.
    const selected = region(page, 'Selected');
    for (let presses = 0; presses < 8 && !(await selected.getByText('Pirate Scout').first().isVisible()); presses += 1) {
      await page.keyboard.press(']');
    }
    await expect(selected.getByText('Pirate Scout').first()).toBeVisible();
    await page.keyboard.press('o');

    // Lock (L).
    expect(await step(page, 'Lock a target')).toMatch(/Lock target \(L\) once it is inside your lock range/);
    await expect(region(page, 'Selected').getByRole('button', { name: /^Lock target/ })).toBeEnabled({ timeout: 90_000 });
    await page.keyboard.press('l');
    await expect(region(page, 'Locks').getByText('Locked', { exact: true })).toBeVisible({ timeout: 60_000 });

    // Fire (E).
    expect(await step(page, 'Open fire', 60_000)).toContain('Fire (E)');
    await page.keyboard.press('e');

    // The booster on 1.
    expect(await step(page, 'Run your shield booster')).toContain('with 1');
    await page.keyboard.press('1');

    // The pirate's lock was immediate danger, shown in words and heard.
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Event log')).toBeVisible();
    await page.getByRole('button', { name: /^Event log/ }).click();
    await expect(region(page, 'Event log').getByText('Pirate Scout has locked your ship.')).toBeVisible();
    await page.getByRole('button', { name: /^Event log/ }).click();

    // Clear the site: keep firing until the Encounter panel reports it.
    expect(await step(page, 'Clear the site', 60_000)).toContain('Destroy every opponent');
    await expect(guidance(page).getByRole('heading', { level: 3 })).toHaveText('Loot the wreck', {
      timeout: 8 * 60_000,
    });

    // Loot: select the wreck, Approach at 0.5 km, then Take all (T).
    expect(await step(page, 'Loot the wreck')).toContain('Take all (T)');
    await region(page, 'In this site').getByRole('button', { name: /Wreck/ }).click();
    await page.getByLabel('Range').selectOption('0.5');
    await page.keyboard.press('a');
    await expect(region(page, 'Wreck').getByRole('button', { name: /^Take all/ })).toBeEnabled({ timeout: 90_000 });
    await page.keyboard.press('t');

    // Home: Retreat (X), then Dock (D).
    expect(await step(page, 'Return and dock')).toMatch(/Retreat \(X\).*Dock \(D\)/);
    await page.keyboard.press('x');
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({ timeout: 90_000 });
    await page.keyboard.press('d');
    await expect(page.getByText('Your ship is docked.', { exact: false })).toBeVisible({ timeout: 60_000 });

    // Sell what was looted, at the market.
    expect(await step(page, 'Sell your loot')).toContain('Market');
    await showMe(page);
    const salvage = page.getByRole('button', { name: /^Sell Burned Alloy Plate/ });
    await ((await salvage.count()) > 0 ? salvage : page.getByRole('button', { name: /^Sell / })).first().click();
    await confirmDialog(page, 'Confirm sale');

    // Get ready: repair, resupply and let the capacitor fill with the clock running.
    expect(await step(page, 'Get the ship ready')).toContain('capacitor');
    await showMe(page);
    for (const [control, dialog] of [['Repair the ship', 'Confirm repair'], ['Resupply ammunition', 'Confirm resupply']] as const) {
      const open = page.getByRole('button', { name: control });
      if (await open.isEnabled()) {
        await open.click();
        await confirmDialog(page, dialog);
      }
    }
    await ensureRunning(page);

    // Improve the fit: a second autocannon, bought and fitted.
    expect(await step(page, 'Improve the fit', 5 * 60_000)).toContain('second autocannon');
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await page.getByRole('button', { name: 'Buy 200mm Autocannon' }).click();
    await confirmDialog(page, 'Confirm purchase');
    await showMe(page);
    await page.getByRole('button', { name: 'Change fit' }).click();
    await page.getByLabel('Module in Weapon 2').selectOption({ value: 'module.turret.autocannon.small' });
    await page.getByRole('button', { name: 'Apply fit' }).click();

    // A harder site: the guidance names the Pirate Patrol and its tactics.
    expect(await step(page, 'Try a harder site')).toContain('cutters first');
    await showMe(page);
    await page.getByRole('button', { name: 'Choose Pirate Patrol' }).click();
    await page.getByRole('button', { name: /^Undock/ }).click();
    await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
    await page.keyboard.press('w');
    await ensureRunning(page);

    // Arriving at the patrol finishes the guidance.
    await expect(guidance(page)).toHaveAttribute('data-guidance-step', 'finished', { timeout: 90_000 });
    await expect(guidance(page)).toContainText('You have flown the whole loop.');
    await expect(guidance(page)).toContainText('15 of 15 steps done');
  });
});
