import { openGameMenu } from '../support/cockpit.ts';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { undock } from '../support/undock.ts';
import { chooseDestination, destinationBriefing, destinationEntry, destinations, dockHome, warpHome } from '../support/destinations.ts';
import { marketMode } from '../support/market.ts';
import { applyFit, chooseAmmunition, chooseModule, fittingSlots, slotRow } from '../support/fitting.ts';
import { takeService } from '../support/services.ts';
import { expectCheckpointShown, openCheckpoint, walletReadout } from '../support/checkpoint/browser.ts';
import { checkpointAt } from '../support/checkpoint/scenarios.ts';

/**
 * From the starting fit to the mastery site, in a real browser
 * (MVP Implementation Plan phases 16-17; MVP-AC-05, MVP-AC-06, MVP-AC-07,
 * MVP-AC-09).
 *
 * The played case is the shipped build: the engine in its worker, saves in
 * IndexedDB, simulation time at 1x. A new pilot spends the starting credits on
 * a second autocannon and phased rounds, clears the multi-opponent Pirate
 * Patrol by killing its cutters before its marksman, loots the wrecks and
 * sells the salvage. The patrol's bounties and salvage buy an afterburner and
 * a capacitor battery; the armour plating one wreck held is fitted as well.
 * The pilot takes the station's repair, which recharges the capacitor with
 * the free shield repair. Earning a reward and spending it is the point, so
 * that segment is played.
 *
 * The campaign is closed, the page loaded again and the campaign resumed at
 * three moments along the way (MVP Implementation Plan phase 21): prepared at
 * the station, in space beside the patrol's wrecks, and after the rewards were
 * converted. Nothing is kept in memory across a reopen, so each one continues
 * from what the save holds.
 *
 * The Pirate Base sortie that followed took most of the case's fourteen
 * minutes. It is flown headlessly instead, with the same fit and tactics, and
 * what the interface shows after it is checked from a saved checkpoint below
 * (Test Suite Optimization Plan phase 6; the assertion map is in
 * docs/test-suite-optimization/phase-5-6-release-evidence-and-patrol.md).
 *
 * The pilot here is a simple competent one: each opponent is selected,
 * ordered against, locked and fired on until it is destroyed, in a fixed
 * priority. Modules are switched on at the first lock and left running. The
 * headless progression scenarios hold the same fits and tactics to more seeds.
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

/**
 * Closes the campaign, loads the page again and resumes it. Closing saves, in
 * space as well as docked, so what comes back is the state that was left.
 */
async function reopen(page: Page, heading: string): Promise<void> {
  await openGameMenu(page);
  await page.getByRole('button', { name: /Close campaign/ }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
}

function wallet(page: Page): Locator {
  return page.locator('dd').filter({ hasText: /ISK$/ }).first();
}

/* -------------------------------------------------------------------------- */
/* Station                                                                     */
/* -------------------------------------------------------------------------- */

async function buy(page: Page, item: string, quantity = 1, toHold = false): Promise<void> {
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await marketMode(page, 'Buy');
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
  await marketMode(page, 'Sell');
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
  for (const [label, value] of choices) {
    const [, kind, slot] = /^(Module|Ammunition) in (.+)$/.exec(label) ?? [];
    if (slot === undefined) throw new Error(`Unknown fitting control: ${label}`);
    if (kind === 'Module') await chooseModule(page, slot, value);
    else await chooseAmmunition(page, slot, value);
  }
  await applyFit(page);
}

async function resupply(page: Page): Promise<void> {
  await takeService(page, 'Resupply ammunition', 'Confirm resupply');
}

async function moveToHold(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Hangar', exact: true }).click();
  const row = page.getByRole('table', { name: 'Station hangar' }).getByRole('row', { name: new RegExp(item) });
  await row.getByRole('button', { name: `Move all ${item} to the hold` }).click();
  await expect(page.getByRole('table', { name: 'Ship cargo hold' }).getByRole('rowheader', { name: item })).toBeVisible();
}

/** Undocks, then chooses the encounter in space, where destinations are chosen. */
async function depart(page: Page, encounter: string): Promise<void> {
  await page.getByRole('button', { name: 'Departure', exact: true }).click();
  await undock(page);
  await expect(page.getByRole('heading', { name: 'Navigation' })).toBeVisible();
  await chooseDestination(page, encounter);
}

/* -------------------------------------------------------------------------- */
/* Space                                                                       */
/* -------------------------------------------------------------------------- */

/** Warps to the destination chosen in space. */
async function warp(page: Page, arriveAtKm: string, site: string): Promise<void> {
  await destinations(page).getByLabel('Arrive at').selectOption(arriveAtKm);
  await destinations(page).getByRole('button', { name: /^Warp to/ }).click();
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

/*
 * The fight runs at 1x while the test reads the panels, so a control read a
 * moment ago may legitimately be gone or disabled by the time it is used: the
 * target dies, a lock breaks, a gun starts its reload. These helpers tolerate
 * exactly that and nothing else. A control that fails while it is still there
 * and enabled is a real failure and is thrown, and every tolerated miss is
 * recorded for the diagnostics a stalled fight reports.
 */

/** Whether a control is there and enabled now. Only its disappearance mid-check is tolerated. */
async function offered(control: Locator): Promise<boolean> {
  if ((await control.count()) === 0) return false;
  try {
    return await control.first().isEnabled({ timeout: 1_000 });
  } catch (error) {
    if ((await control.count()) === 0) return false;
    throw error;
  }
}

/** An attribute of an element that may have left the page, or `null` once it has. */
async function attributeIfPresent(element: Locator, name: string): Promise<string | null> {
  if ((await element.count()) === 0) return null;
  try {
    return await element.first().getAttribute(name, { timeout: 1_000 });
  } catch (error) {
    if ((await element.count()) === 0) return null;
    throw error;
  }
}

interface FightLog {
  current: string | null;
  lockStatus: string | null;
  presses: number;
  /** The most recent controls that were gone or disabled when clicked, newest last. */
  readonly transient: string[];
}

/**
 * Clicks a control if it is offered now. Returns false when it is not, or
 * when it went between the check and the click; rethrows when it is still
 * offered after a failed click.
 */
async function press(control: Locator, what: string, log: FightLog): Promise<boolean> {
  if (!(await offered(control))) return false;
  try {
    await control.first().click({ timeout: 2_000 });
    log.presses += 1;
    return true;
  } catch (error) {
    if (await offered(control)) throw error;
    log.transient.push(`${what} went before it was clicked`);
    if (log.transient.length > 10) log.transient.shift();
    return false;
  }
}

/** What the panels show now, and what the loop last saw: the report of a fight that did not end. */
async function fightDiagnostics(page: Page, log: FightLog): Promise<string> {
  const text = async (locator: Locator): Promise<string> =>
    (await locator.count()) === 0 ? '(not shown)' : (await locator.first().innerText()).replace(/\s+/g, ' ').trim();
  const target = log.current === null ? null : page.locator(`[data-object-entry="${log.current}"]`);
  return [
    `target: ${log.current ?? 'none'}${target === null ? '' : ` - ${await text(target)}`}`,
    `last lock status seen: ${log.lockStatus ?? 'none'}; presses: ${String(log.presses)}`,
    `In this site: ${await text(region(page, 'In this site'))}`,
    `Weapons: ${await text(region(page, 'Weapons'))}`,
    `Modules: ${await text(region(page, 'Modules'))}`,
    `Encounter: ${await text(page.locator('[data-encounter-summary]'))}`,
    `Clock: ${await text(page.getByText(/Running at|^Paused$/))}`,
    `Recent transient misses: ${log.transient.join('; ') || 'none'}`,
  ].join('\n  ');
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
  const cleared = page.locator('[data-encounter-summary="complete"]', { hasText: `Cleared: ${engagement.bounty} ISK paid` });
  const fire = region(page, 'Weapons').getByRole('button', { name: /^Fire\s?E$/ });
  const deadline = Date.now() + 10 * 60_000;
  const log: FightLog = { current: null, lockStatus: null, presses: 0, transient: [] };
  let modulesRunning = false;

  while (!(await cleared.isVisible())) {
    if (Date.now() > deadline) {
      throw new Error(`The ${engagement.bounty} ISK site was not cleared in time.\n  ${await fightDiagnostics(page, log)}`);
    }

    if (log.current === null || (await page.locator(`[data-object-entry="${log.current}"]`).count()) === 0) {
      log.current = null;
      log.lockStatus = null;
      for (const name of engagement.priority) {
        const id = await attributeIfPresent(opponent(page, name), 'data-object-entry');
        if (id !== null) {
          log.current = id;
          break;
        }
      }
      if (log.current === null) {
        await page.waitForTimeout(1_000);
        continue;
      }
      await press(page.locator(`[data-object-entry="${log.current}"]`), `the entry of ${log.current}`, log);
      await page.getByLabel('Range').selectOption(engagement.rangeKm);
      await press(page.getByRole('button', { name: engagement.movement }), 'the movement order', log);
    }

    const entry = page.locator(`[data-object-entry="${log.current}"]`);
    const lock = region(page, 'In this site').locator(`[data-lock="${log.current}"]`);
    log.lockStatus = await attributeIfPresent(lock, 'data-lock-status');
    if (log.lockStatus === null) {
      if ((await attributeIfPresent(entry, 'aria-pressed')) !== 'true') await press(entry, `the entry of ${log.current}`, log);
      await press(region(page, 'Navigation').getByRole('button', { name: /^Lock target/ }), 'Lock target', log);
    } else if (log.lockStatus === 'locked') {
      await press(fire, 'Fire', log);
      if (!modulesRunning) {
        for (const module of engagement.modules) {
          await press(region(page, 'Modules').getByRole('button', { name: new RegExp(`^Activate ${module}`) }), `Activate ${module}`, log);
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

/**
 * Takes the station's repair, which recharges the capacitor with the free
 * shield repair (Functional Specification 10), and checks that the ship panel
 * shows it full. No simulation time passes.
 */
async function repairAndRecharge(page: Page, capacity: string): Promise<void> {
  await takeService(page, 'Repair all', 'Confirm full repair', async (dialog) => {
    await expect(dialog.getByText(/recharged to full for free$/)).toBeVisible();
  });
  await page.getByRole('button', { name: 'Ships', exact: true }).click();
  await expect(page.getByText(new RegExp(`^${capacity} of ${capacity},`))).toBeVisible({ timeout: 10_000 });
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

/** Warps home through the station destination and docks there. */
async function returnAndDock(page: Page): Promise<void> {
  await warpHome(page);
  await ensureRunning(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({ timeout: 90_000 });
  await dockHome(page);
  await expect(page.getByText('Docked at Borrell Harbour')).toBeVisible({ timeout: 60_000 });
  await ensurePaused(page);
}

test.describe('progression through the multi-opponent site', () => {
  test.beforeEach(async ({ page }) => {
    await fixSeed(page);
    await freshCampaign(page);
  });

  test('clears the multi-opponent site, loots its wrecks after a reopen beside them and spends its rewards on the mastery fit [MVP-AC-01, MVP-AC-05, MVP-AC-06, MVP-AC-07, FUNC-9.10, FUNC-9.11]', async ({
    page,
  }) => {
    // One sortie at 1x: warps, a fight of a few minutes, the wrecks and a
    // docking cycle, and three reopenings.
    test.setTimeout(15 * 60_000);

    // Undocking needs no destination: every site is chosen in space, where
    // all three are offered (see the end of this flow).
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByText('No destination needed: you choose one in space.')).toBeVisible();

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

    // Checkpoint: prepared at the station. The purchases and the fit come back.
    const prepared = await wallet(page).innerText();
    await reopen(page, 'Borrell Harbour');
    await expect(wallet(page)).toHaveText(prepared);
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await expect(fittingSlots(page).filter({ hasText: '200mm Autocannon' })).toHaveCount(2);

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
      bounty: '13,000',
    });

    // Checkpoint: in space beside the wrecks. The cleared site comes back with
    // every wreck and what each one holds.
    await expect(region(page, 'In this site').locator('[data-kind="wreck"]')).toHaveCount(3);
    await reopen(page, 'Derelict Lane');
    await expect(region(page, 'In this site').locator('[data-kind="wreck"]')).toHaveCount(3);
    await expect(opponent(page, 'Pirate')).toHaveCount(0);
    await ensureRunning(page);
    await lootWrecks(page);
    await returnAndDock(page);

    const sortie = region(page, 'Last sortie');
    await expect(
      sortie.getByText('Pirate Patrol cleared: 3 of 3 opponents destroyed, 13,000 ISK in bounties.'),
    ).toBeVisible();
    await expect(sortie.getByText('1 x Small Armour Plating')).toBeVisible();

    // Convert the rewards: sell the salvage, buy what the mastery fit still
    // lacks, and fit the plating the marksman carried.
    await sell(page, 'Burned Alloy Plate');
    await sell(page, 'Iron Charge S');
    // Circuitry is the marksman's, when its wreck held some.
    if ((await page.getByRole('button', { name: 'Sell Charred Circuitry' }).count()) > 0) {
      await sell(page, 'Charred Circuitry');
    }
    await buy(page, '1MN Afterburner');
    await buy(page, 'Small Capacitor Battery');
    await buy(page, 'Phased Plasma S', 220, true);
    await refit(page, [
      ['Module in System 2', 'module.propulsion.afterburner.small'],
      ['Module in Engineering 1', 'module.plating.armor.small'],
      ['Module in Engineering 2', 'module.capacitor.battery.small'],
    ]);
    await expect(fittingSlots(page).filter({ hasText: '1MN Afterburner' })).toBeVisible();
    await expect(fittingSlots(page).filter({ hasText: 'Small Armour Plating' })).toBeVisible();
    await resupply(page);
    // The booster ran through the looting, and the battery added charge to
    // fill: the repair recharges it, so the ship leaves with a full capacitor.
    await repairAndRecharge(page, '370');

    // Checkpoint: the rewards are converted. The wallet and the mastery fit
    // come back.
    const converted = await wallet(page).innerText();
    await reopen(page, 'Borrell Harbour');
    await expect(wallet(page)).toHaveText(converted);
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    await expect(fittingSlots(page).filter({ hasText: '1MN Afterburner' })).toBeVisible();
    await expect(fittingSlots(page).filter({ hasText: 'Small Armour Plating' })).toBeVisible();
    // The Pirate Base fight with this fit is flown headlessly, by the
    // progression scenarios over several seeds and by the `base-cleared`
    // checkpoint below (Test Suite Optimization Plan phase 6).
  });
});

/*
 * The end of the progression from a saved checkpoint (Test Suite Optimization
 * Plan phase 6). The checkpoint continues the patrol checkpoint headlessly with
 * the same steps the case above plays: the salvage sold, the mastery fit bought
 * and fitted with the earned plating, then the headless progression scenario's
 * Pirate Base sortie flown home - the mastery fit keeping 10 km from the nearest
 * brawler. What the interface must show afterwards is checked here, through a
 * real close, reload and resume.
 */
test.describe('the mastery site from a checkpoint', () => {
  test('finds the mastery clear after a reopen, offers the mastery site first with its completion counted and keeps every site choosable [MVP-AC-01, MVP-AC-07, MVP-AC-09, FUNC-18]', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(CHECKPOINT_CASE_TIMEOUT_MS);
    const checkpoint = checkpointAt(await openCheckpoint(page, 'base-cleared', baseURL), 'station');
    const { facts } = checkpoint;
    const cleared = 'Pirate Base cleared: 4 of 4 opponents destroyed, 26,000 ISK in bounties.';
    await expect(region(page, 'Last sortie').getByText(cleared)).toBeVisible();

    // The mastery site is cleared, and the campaign closed, loaded again and
    // resumed in this browser still says so, with the wallet and hold as they were.
    await reopen(page, facts.stationName);
    await expectCheckpointShown(page, checkpoint);
    await expect(region(page, 'Last sortie').getByText(cleared)).toBeVisible();

    // Nothing ends here: the mastery site is still the chosen destination,
    // offered first in space with its completion counted, and every site -
    // tier is guidance, not a gate - can be chosen instead.
    expect(facts.selectedDestination?.name).toBe('Pirate Base');
    expect(facts.completions.find((entry) => entry.name === 'Pirate Base')?.count).toBe(1);
    await page.getByRole('button', { name: 'Departure', exact: true }).click();
    await expect(page.getByText('Chosen destination: Pirate Base. Space navigation offers it first.')).toBeVisible();
    await undock(page);
    await expect(destinationEntry(page, 'Pirate Base')).toHaveAttribute('aria-pressed', 'true');
    await expect(destinationBriefing(page).getByText('Cleared 1 times')).toBeVisible();
    for (const site of ['Pirate Scout', 'Pirate Patrol']) {
      await chooseDestination(page, site);
      await expect(destinations(page).getByRole('button', { name: new RegExp(`^Warp to ${site}`) })).toBeEnabled();
    }
  });
});

/**
 * The first case in a worker that opens a progression checkpoint also makes
 * it: a headless sortie or two, which blocks the worker for about 3 s
 * (`patrol-salvage`) or 9 s (`base-cleared`) on an idle machine and several
 * times that beside seven other browser workers in the release gate. The
 * default 30 s was too tight there.
 */
const CHECKPOINT_CASE_TIMEOUT_MS = 2 * 60_000;

/** "Engineering 1" for the first engineering slot, as the fitting screen names it. */
function slotName(slotKind: string, slotIndex: number): string {
  return `${slotKind.charAt(0).toUpperCase()}${slotKind.slice(1)} ${String(slotIndex + 1)}`;
}

/** The wallet readout as a number of credits. */
async function credits(page: Page): Promise<number> {
  const text = await walletReadout(page).innerText();
  const match = /^([\d,]+) ISK$/.exec(text.trim());
  if (match === null) throw new Error(`The wallet reads "${text}".`);
  return Number((match[1] ?? '').replace(/,/g, ''));
}

/*
 * The rewards half of the Patrol-to-Base case from a saved checkpoint
 * (Test Suite Optimization Plan phase 4). The checkpoint is docked after the
 * headless progression scenario's Pirate Patrol sortie - the same intermediate
 * fit and cutters-first tactics - with the bounty paid and every wreck looted.
 * Selling the salvage, fitting the module a wreck held and finding both after
 * closing and resuming the campaign are done here through the interface and the
 * worker; the long case above still earns them in real time.
 */
test.describe('progression rewards from a checkpoint', () => {
  test('sells the patrol salvage, fits the earned plating and finds the wallet and fit after a reopen [MVP-AC-06, TECH-11.4]', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(CHECKPOINT_CASE_TIMEOUT_MS);
    const checkpoint = checkpointAt(await openCheckpoint(page, 'patrol-salvage', baseURL), 'station');
    const { facts } = checkpoint;
    const plating = facts.hold.find((stack) => stack.definitionId === 'module.plating.armor.small');
    if (plating === undefined) throw new Error('The patrol checkpoint holds no earned plating.');
    const salvage = [...new Set(facts.hold.filter((stack) => stack.kind === 'item').map((stack) => stack.name))];
    expect(salvage.length).toBeGreaterThan(0);

    // Convert the salvage: each stack sold whole, and the wallet rises.
    for (const item of salvage) await sell(page, item);
    await expect.poll(() => credits(page)).toBeGreaterThan(facts.credits);
    const sold = await credits(page);

    // Fit the earned plating into the first free engineering slot.
    const free = facts.fit.find((slot) => slot.slotKind === 'engineering' && slot.moduleId === null);
    if (free === undefined) throw new Error('The patrol checkpoint fit has no free engineering slot.');
    const platingSlot = slotName(free.slotKind, free.slotIndex);
    await refit(page, [[`Module in ${platingSlot}`, plating.definitionId]]);
    await expect(fittingSlots(page).filter({ hasText: plating.name })).toBeVisible();
    // Fitting is free, so the wallet is what the sales left.
    expect(await credits(page)).toBe(sold);

    // Close, load the page again and resume: the save holds the sales and the fit.
    const shown = await walletReadout(page).innerText();
    await reopen(page, facts.stationName);
    await expect(walletReadout(page)).toHaveText(shown);
    await page.getByRole('button', { name: 'Fitting', exact: true }).click();
    for (const slot of facts.fit) {
      const expected = slot.slotKind === free.slotKind && slot.slotIndex === free.slotIndex ? plating.definitionId : slot.moduleId;
      const row = slotRow(page, slotName(slot.slotKind, slot.slotIndex));
      if (expected === null) await expect(row).not.toHaveAttribute('data-module', /./);
      else await expect(row).toHaveAttribute('data-module', expected);
    }
    // Nothing that was sold came back to sell again.
    await page.getByRole('button', { name: 'Market', exact: true }).click();
    await marketMode(page, 'Sell');
    for (const item of salvage) {
      await expect(page.getByRole('button', { name: `Sell ${item}` })).toHaveCount(0);
    }
  });
});
