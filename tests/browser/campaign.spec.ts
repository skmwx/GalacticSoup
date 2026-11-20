import { openGameMenu } from '../support/cockpit.ts';
import { expect, test, type Page } from '@playwright/test';

import { SAVE_FORMAT_VERSION } from '@engine';

/**
 * The campaign save cycle in a real browser
 * (MVP-AC-01; Functional Specification 3.3-3.4; Technical Specification 11).
 *
 * The shipped build runs its engine and its IndexedDB save store in the
 * dedicated worker, so this is the only level at which the real storage path
 * is exercised. Each test starts from an empty origin.
 */

const PILOT = 'Vela Trask';

async function clearSaves(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('galactic-soup');
        request.onsuccess = () => {
          resolve();
        };
        request.onerror = () => {
          resolve();
        };
        request.onblocked = () => {
          resolve();
        };
      }),
  );
}

async function startCampaign(page: Page, name = PILOT): Promise<void> {
  await page.getByLabel('Pilot name').fill(name);
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
}

/** The campaign identity lives behind the frame's details disclosure. */
async function campaignIdentity(page: Page): Promise<string> {
  await openGameMenu(page);
  await page.getByText('Campaign details').click();
  return page.getByText(/^c[0-9a-f]{24}$/).innerText();
}

test.describe('campaign persistence', () => {
  test.beforeEach(async ({ page }) => {
    await clearSaves(page);
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  });

  test('creates, closes and reopens a campaign [MVP-AC-01, TECH-11.1]', { tag: '@feature' }, async ({ page }) => {
    await startCampaign(page);

    const identity = await campaignIdentity(page);
    await expect(page.getByText('Saved at revision 1.')).toBeVisible();

    await openGameMenu(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();
    await expect(page.getByText(new RegExp(`Saved campaign: ${PILOT}`))).toBeVisible();

    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
    expect(await campaignIdentity(page)).toBe(identity);
  });

  test('resumes the campaign after the page is reloaded [MVP-AC-01]', async ({ page }) => {
    await startCampaign(page);
    const identity = await campaignIdentity(page);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume campaign' }).click();

    await expect(page.getByText(PILOT, { exact: true })).toBeVisible();
    expect(await campaignIdentity(page)).toBe(identity);
  });

  test('adds no simulation time while the game is closed [FUNC-22.12]', async ({ page }) => {
    await startCampaign(page);
    await expect(page.getByText('0s', { exact: true })).toBeVisible();

    await openGameMenu(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();

    await expect(page.getByText(PILOT, { exact: true })).toBeVisible();
    await expect(page.getByText('0s', { exact: true })).toBeVisible();
  });

  test('adds one capped step, never the missing hours, after a suspension or a clock change [V02-AC-13, FUNC-22.12, TECH-9.1]', async ({ page }) => {
    // The page's clocks are Playwright's from here on: they run in real time
    // until a test jumps them, the way a sleeping laptop or a changed system
    // clock would.
    await page.clock.install();
    await page.reload();
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
    await startCampaign(page);
    const simulated = async (): Promise<number> => {
      const text = await page.locator('dt', { hasText: 'Simulation time' }).locator('xpath=following-sibling::dd[1]').innerText();
      let seconds = 0;
      for (const [, amount, unit] of text.matchAll(/(\d+)\s*([hms])/g)) {
        seconds += Number(amount) * (unit === 'h' ? 3_600 : unit === 'm' ? 60 : 1);
      }
      return seconds;
    };
    const run = async (): Promise<void> => {
      await page.getByRole('button', { name: /^Resume/ }).click();
      await expect(page.getByText(/Running at 1x/)).toBeVisible();
    };
    const pause = async (): Promise<void> => {
      await page.getByRole('button', { name: /^Pause/ }).click();
      await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    };
    // The readout shows whole seconds and can show the last running step a
    // moment late, so "nothing added" allows that one second, against hours.
    const DISPLAY_SLACK = 1;

    await run();
    await expect.poll(simulated, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    await pause();
    const before = await simulated();

    // Paused, two hours pass: nothing moves.
    await page.clock.fastForward('02:00:00');
    expect((await simulated()) - before).toBeLessThanOrEqual(DISPLAY_SLACK);

    // Running, the tab sleeps for two hours: the first frame back advances at
    // most one capped step, not the two hours.
    await run();
    await page.clock.fastForward('02:00:00');
    await pause();
    const afterSleep = await simulated();
    expect(afterSleep - before).toBeLessThan(15);

    // The system clock is set years ahead while running: the game reads
    // only elapsed frame time, so the jump adds nothing.
    await run();
    await page.clock.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    await pause();
    expect((await simulated()) - afterSleep).toBeLessThan(15);

    // Close and reopen: the campaign comes back at the time it was closed.
    const closedAt = await simulated();
    await openGameMenu(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    // Only once the close has finished saving: the hours pass while closed.
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();
    await page.clock.fastForward('08:00:00');
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
    expect(Math.abs((await simulated()) - closedAt)).toBeLessThanOrEqual(DISPLAY_SLACK);
  });

  test('deletes the campaign and its saves on reset [FUNC-3.4]', async ({ page }) => {
    await startCampaign(page);

    await openGameMenu(page);
    await page.getByRole('button', { name: /Reset campaign/ }).click();
    await page.getByRole('button', { name: /Delete this campaign/ }).click();

    await expect(page.getByLabel('Pilot name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel('Pilot name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toHaveCount(0);
  });

  test('stores exactly one campaign slot [MVP Scope 6]', async ({ page }) => {
    await startCampaign(page);

    const slots = await page.evaluate(
      async () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('galactic-soup');
          open.onsuccess = () => {
            const database = open.result;
            const count = database
              .transaction('manifests', 'readonly')
              .objectStore('manifests')
              .count();
            count.onsuccess = () => {
              resolve(count.result);
              database.close();
            };
            count.onerror = () => {
              resolve(-1);
              database.close();
            };
          };
          open.onerror = () => {
            resolve(-1);
          };
        }),
    );

    expect(slots).toBe(1);
  });

  test('persists the starting fit through the real worker and IndexedDB [MVP-AC-02, FUNC-8.4, TECH-11.2]', { tag: '@feature' }, async ({ page }) => {
    await startCampaign(page);
    // The expected format comes from the engine rather than a literal, so a
    // format change fails the phase that makes it instead of this test.
    const savedAssets = () => page.evaluate(async (expectedFormat) => new Promise<{
      credits: number; activeShipId: string; ships: Record<string, { cargoInventoryId: string }>;
      stacks: Record<string, { quantity: number; inventoryId: string; state: { kind: string } }>;
      inventories: Record<string, { location: { kind: string } }>;
    }>((resolve, reject) => {
      const open = indexedDB.open('galactic-soup');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
        read.onerror = () => { db.close(); reject(read.error); };
        read.onsuccess = () => {
          const records = read.result as { document: { formatVersion: number; sequence: number; state: { assets: Parameters<typeof resolve>[0] } } }[];
          const saves = records.map((record) => record.document);
          const latest = saves.sort((a, b) => b.sequence - a.sequence)[0]!;
          db.close();
          if (latest.formatVersion !== expectedFormat) {
            reject(new Error(`Expected save format ${String(expectedFormat)}.`));
          } else resolve(latest.state.assets);
        };
      };
    }), SAVE_FORMAT_VERSION);
    const before = await savedAssets();
    expect(before.credits).toBe(20000);
    expect(Object.keys(before.ships)).toEqual([before.activeShipId]);
    // Two fitted modules of one unit each, one loaded magazine and whatever
    // the grant left behind; the quantities themselves are tuning values.
    const quantities = Object.values(before.stacks).map((s) => s.quantity).sort((a, b) => a - b);
    expect(quantities).toHaveLength(4);
    expect(quantities.slice(0, 2)).toEqual([1, 1]);
    expect(quantities[2]).toBeGreaterThan(1);
    // The fitted modules and the loaded magazine live in the ship's fitting
    // store; the spare rounds the magazine did not take ride in the hold.
    const placed = Object.values(before.stacks).map(
      (s) => `${before.inventories[s.inventoryId]?.location.kind ?? '?'}:${s.state.kind}`,
    );
    expect(placed.sort()).toEqual(['cargo:plain', 'fitting:charge', 'fitting:fitted', 'fitting:fitted']);
    await openGameMenu(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByText(PILOT, { exact: true })).toBeVisible();
    await openGameMenu(page);
    await page.getByRole('button', { name: /Close campaign/ }).click();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();
    expect(await savedAssets()).toEqual(before);
  });

  test('makes no network request while saving [TECH-2, TECH-3.2]', async ({ page, context }) => {
    await startCampaign(page);
    await openGameMenu(page, false);

    // Saving is local: from the click to the saved revision the context asks
    // for nothing at all. Where the loaded files come from is the boot case's
    // same-origin evidence (`boot.spec.ts`).
    const requests: string[] = [];
    context.on('request', (request) => requests.push(request.url()));
    await page.getByRole('button', { name: /Save now/ }).click();
    await expect(page.getByText(/Saved at revision/)).toBeVisible();

    expect(requests).toEqual([]);
  });
});
