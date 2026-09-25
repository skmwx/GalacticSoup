import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * From the starting fit to the mastery site, in a real browser
 * (MVP Implementation Plan phase 16; MVP-AC-05, MVP-AC-06, MVP-AC-07,
 * MVP-AC-09).
 *
 * The run is the shipped build: the engine in its worker, saves in IndexedDB,
 * simulation time at 1x. A new pilot spends the starting credits on a second
 * autocannon and phased rounds, clears the multi-opponent Pirate Patrol by
 * killing its cutters before its marksman, loots the wrecks and sells the
 * salvage. The patrol's bounties and salvage buy an afterburner and a
 * capacitor battery; the armour plating one wreck held is fitted as well. With
 * that fit the pilot kites the Pirate Base's gunners at 10 km, clears it and
 * comes home, and every site is still offered.
 *
 * The pilot here is the simplest competent one: modules are switched on once
 * and left running, and each opponent is selected, ordered against, locked and
 * fired on in a fixed priority until it is destroyed. The headless progression
 * scenarios hold the same fits and tactics to more seeds.
 *
 * The client supplies a campaign's seed, so the test fixes the sixteen random
 * bytes that become it. Wrecks are rolled from their own stream in the order
 * opponents die, and the priority fixes that order, so the patrol's loot is
 * the same every run; nothing else about the game is changed.
 */

const PILOT = 'Progression Pilot';
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

async function freshCampaign(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('galactic-soup');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  await page.getByLabel('Pilot name').fill(PILOT);
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
}

function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

async function ensureRunning(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: /^Resume/ });
  if (await resume.isVisible()) {
    await resume.click();
  }
  await expect(page.getByText(/Running at 1x/)).toBeVisible();
}

async function ensurePaused(page: Page): Promise<void> {
  const pause = page.getByRole('button', { name: /^Pause/ });
  if (await pause.isVisible()) {
    await pause.click();
  }
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
}

/* -------------------------------------------------------------------------- */
/* Station                                                                     */
/* -------------------------------------------------------------------------- */

async function buy(page: Page, item: string, quantity = 1, toHold = false): Promise<void> {
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await page.getByRole('button', { name: `Buy ${item}` }).click();
  const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
  if (quantity !== 1) await purchase.getByLabel('Quantity').fill(String(quantity));
  if (toHold) await purchase.getByLabel('Deliver to').selectOption({ label: 'Ship cargo hold' });
  await expect(purchase.getByText('Calculating…')).toBeHidden();
  await purchase.getByRole('button', { name: 'Confirm' }).click();
  await expect(purchase).toBeHidden();
}

/**
 * Sells every stack of an item, each whole, which is what the sale dialog
 * offers first. Loot from two wrecks may arrive as separate stacks.
 */
async function sell(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  const offer = page.getByRole('button', { name: `Sell ${item}` });
  await expect(offer.first()).toBeVisible();
  while ((await offer.count()) > 0) {
    const before = await offer.count();
    await offer.first().click();
    const sale = page.getByRole('dialog', { name: 'Confirm sale' });
    await expect(sale.getByText('Calculating…')).toBeHidden();
    await sale.getByRole('button', { name: 'Confirm' }).click();
    await expect(sale).toBeHidden();
    await expect(offer).toHaveCount(before - 1);
  }
}

async function refit(page: Page, choices: readonly (readonly [string, string])[]): Promise<void> {
  await page.getByRole('button', { name: 'Fitting', exact: true }).click();
  await page.getByRole('button', { name: 'Change fit' }).click();
  for (const [label, value] of choices) {
    await page.getByLabel(label).selectOption({ value });
  }
  await page.getByRole('button', { name: 'Apply fit' }).click();
  await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
}

async function resupply(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await page.getByRole('button', { name: 'Resupply ammunition' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm resupply' });
  await expect(dialog.getByText('Calculating…')).toBeHidden();
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  if (await confirm.isEnabled()) {
    await confirm.click();
  } else {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
  await expect(dialog).toBeHidden();
}

async function moveToHold(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Hangar', exact: true }).click();
  const row = page.getByRole('table', { name: 'Station hangar' }).getByRole('row', { name: new RegExp(item) });
  await row.getByRole('button', { name: 'Move to hold' }).click();
  await expect(page.getByRole('table', { name: 'Ship cargo hold' }).getByRole('rowheader', { name: item })).toBeVisible();
}

async function depart(page: Page, encounter: string): Promise<void> {
  await page.getByRole('button', { name: 'Departure', exact: true }).click();
  await page.getByRole('button', { name: `Choose ${encounter}` }).click();
  await expect(page.getByText(`Destination: ${encounter}`)).toBeVisible();
  await page.getByRole('button', { name: /^Undock/ }).click();
  await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
}

/* -------------------------------------------------------------------------- */
/* Space                                                                       */
/* -------------------------------------------------------------------------- */

async function warp(page: Page, arriveAtKm: string, site: string): Promise<void> {
  await page.getByLabel('Arrive at').selectOption(arriveAtKm);
  await page.getByRole('button', { name: /^Warp/ }).click();
  await ensureRunning(page);
  await expect(page.getByRole('heading', { level: 2, name: site })).toBeVisible({ timeout: 90_000 });
}

interface Engagement {
  /** Opponent names, engaged in this order. */
  readonly priority: readonly string[];
  readonly rangeKm: string;
  readonly movement: RegExp;
  /** Modules switched on at the first lock and left running. */
  readonly modules: readonly string[];
  readonly bounty: string;
}

function opponent(page: Page, name: string): Locator {
  return region(page, 'In this site').locator('[data-kind="ship"][data-attitude="hostile"]').filter({ hasText: name });
}

/** Clicks a control if it is there and enabled now; the fight moves on either way. */
async function press(control: Locator): Promise<boolean> {
  try {
    if ((await control.count()) === 0 || !(await control.first().isEnabled())) return false;
    await control.first().click({ timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fights the site with the ordinary controls, deciding once a second as a
 * player watching the panels would: keep the current opponent until its ship
 * leaves the site; otherwise select the first in priority and order the
 * chosen movement against it; lock it when the lock control allows; and press
 * Fire whenever it is enabled, because a gun that was reloading when Fire was
 * last pressed does not join in by itself (Functional Specification 9.4).
 * Modules are switched on at the first lock and left running.
 */
async function fight(page: Page, engagement: Engagement): Promise<void> {
  const cleared = region(page, 'Encounter').getByText(`Site cleared: ${engagement.bounty} ISK paid`, { exact: false });
  const fire = region(page, 'Weapons').getByRole('button', { name: /^Fire\s?E$/ });
  const deadline = Date.now() + 12 * 60_000;
  let current: string | null = null;
  let modulesRunning = false;

  while (!(await cleared.isVisible())) {
    expect(Date.now(), `${engagement.bounty} ISK site not cleared in time`).toBeLessThan(deadline);

    if (current === null || (await page.locator(`[data-object-entry="${current}"]`).count()) === 0) {
      current = null;
      for (const name of engagement.priority) {
        const candidate = opponent(page, name).first();
        if ((await candidate.count()) > 0) {
          current = await candidate.getAttribute('data-object-entry');
          break;
        }
      }
      if (current === null) {
        await page.waitForTimeout(1_000);
        continue;
      }
      await press(page.locator(`[data-object-entry="${current}"]`));
      await page.getByLabel('Range').selectOption(engagement.rangeKm);
      await press(page.getByRole('button', { name: engagement.movement }));
    }

    const entry = page.locator(`[data-object-entry="${current}"]`);
    const lock = region(page, 'Locks').locator(`[data-lock="${current}"]`);
    if ((await lock.count()) === 0) {
      if ((await entry.getAttribute('aria-pressed').catch(() => null)) !== 'true') await press(entry);
      await press(region(page, 'Selected').getByRole('button', { name: /^Lock target/ }));
    } else if ((await lock.getAttribute('data-lock-status').catch(() => null)) === 'locked') {
      await press(fire);
      if (!modulesRunning) {
        for (const module of engagement.modules) {
          await press(region(page, 'Modules').getByRole('button', { name: new RegExp(`^Activate ${module}`) }));
        }
        modulesRunning = true;
      }
    }
    await page.waitForTimeout(1_000);
  }
  for (const module of engagement.modules) {
    await expect(region(page, 'Modules').getByRole('button', { name: new RegExp(`^Deactivate ${module}`) })).toBeVisible();
  }
}

/** Opens every wreck in the site, flying into reach where needed, and empties it. */
async function lootWrecks(page: Page): Promise<void> {
  const ids = await region(page, 'In this site')
    .locator('[data-kind="wreck"]')
    .evaluateAll((entries) => entries.map((entry) => entry.getAttribute('data-object-entry') ?? ''));
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    await page.locator(`[data-object-entry="${id}"]`).click();
    const wreck = region(page, 'Wreck');
    const takeAll = wreck.getByRole('button', { name: /^Take all/ });
    const approach = wreck.getByRole('button', { name: /^Approach to open/ });
    if (await approach.isVisible()) {
      await approach.click();
    }
    const empty = wreck.getByText('The wreck is empty.');
    await expect(takeAll.or(empty)).toBeVisible({ timeout: 120_000 });
    if (!(await empty.isVisible())) {
      await expect(takeAll).toBeEnabled({ timeout: 10_000 });
      await takeAll.click();
      await expect(empty).toBeVisible();
    }
  }
}

async function returnAndDock(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Retreat/ }).click();
  await ensureRunning(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: /^Dock/ }).click();
  await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
  await ensurePaused(page);
}

test.describe('progression to the mastery site', () => {
  test.beforeEach(async ({ page }) => {
    await fixSeed(page);
    await freshCampaign(page);
  });

  test('clears the multi-opponent site, converts its rewards and clears the mastery site [MVP-AC-05, MVP-AC-06, MVP-AC-07, MVP-AC-09, FUNC-9.10, FUNC-9.11, FUNC-18]', async ({
    page,
  }) => {
    // Two sorties at 1x, each with warps, a fight of several minutes and a
    // docking cycle, plus the wrecks of the first.
    test.setTimeout(25 * 60_000);

    // Every site is offered from the start; tier is guidance, not a gate.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    for (const site of ['Pirate Scout', 'Pirate Patrol', 'Pirate Base']) {
      await expect(page.getByRole('button', { name: `Choose ${site}` })).toBeEnabled();
    }

    // The starting credits buy the intermediate fit: a second autocannon and
    // phased rounds for the cutters' shields.
    await buy(page, '200mm Autocannon');
    await buy(page, 'Phased Plasma S', 240);
    await refit(page, [
      ['Module in Weapon 2', 'module.turret.autocannon.small'],
      ['Ammunition in Weapon 1', 'ammo.projectile.small.phased'],
      ['Ammunition in Weapon 2', 'ammo.projectile.small.phased'],
    ]);
    await resupply(page);
    await moveToHold(page, 'Phased Plasma S');

    // The Pirate Patrol: cutters first, then the marksman that will not close.
    await depart(page, 'Pirate Patrol');
    await warp(page, '10', 'Derelict Lane');
    await expect(opponent(page, 'Pirate Cutter')).toHaveCount(2);
    await expect(opponent(page, 'Pirate Marksman')).toHaveCount(1);
    await fight(page, {
      priority: ['Pirate Cutter', 'Pirate Marksman'],
      rangeKm: '1',
      movement: /^Orbit/,
      modules: ['Small Shield Booster'],
      bounty: '21,000',
    });
    await lootWrecks(page);
    await returnAndDock(page);

    const sortie = region(page, 'Last sortie');
    await expect(
      sortie.getByText('Pirate Patrol cleared: 3 of 3 opponents destroyed, 21,000 ISK in bounties.'),
    ).toBeVisible();
    await expect(sortie.getByText('1 x Small Armour Plating')).toBeVisible();

    // Convert the rewards: sell the salvage, buy what the mastery fit still
    // lacks, and fit the plating the marksman carried.
    await sell(page, 'Burned Alloy Plate');
    await sell(page, 'Iron Charge S');
    await buy(page, '1MN Afterburner');
    await buy(page, 'Small Capacitor Battery');
    await buy(page, 'Phased Plasma S', 220, true);
    await refit(page, [
      ['Module in System 2', 'module.propulsion.afterburner.small'],
      ['Module in Engineering 1', 'module.plating.armor.small'],
      ['Module in Engineering 2', 'module.capacitor.battery.small'],
    ]);
    await expect(page.getByRole('cell', { name: '1MN Afterburner' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Small Armour Plating' })).toBeVisible();
    await resupply(page);

    // The Pirate Base: arrive far off, burn and keep 10 km from the faster
    // gunners, then the warden, then the marksman.
    await depart(page, 'Pirate Base');
    await warp(page, '30', 'Outpost Cradle');
    await expect(opponent(page, 'Pirate Gunner')).toHaveCount(2);
    await fight(page, {
      priority: ['Pirate Gunner', 'Pirate Warden', 'Pirate Marksman'],
      rangeKm: '10',
      movement: /^Keep range/,
      modules: ['1MN Afterburner', 'Small Shield Booster'],
      bounty: '37,000',
    });
    await returnAndDock(page);

    await expect(
      region(page, 'Last sortie').getByText('Pirate Base cleared: 4 of 4 opponents destroyed, 37,000 ISK in bounties.'),
    ).toBeVisible();

    // Nothing ends here: the mastery site counts its completion and is still
    // the chosen destination, and the other sites can be chosen instead.
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(
      page.locator('[data-disclosure="encounter.borrell.pirate-base"]').getByText('Cleared 1 times'),
    ).toBeVisible();
    await expect(page.getByText('Destination: Pirate Base')).toBeVisible();
    for (const site of ['Pirate Scout', 'Pirate Patrol']) {
      await expect(page.getByRole('button', { name: `Choose ${site}` })).toBeEnabled();
    }
  });
});
