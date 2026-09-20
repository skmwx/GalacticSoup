import { expect, test, type Page } from '@playwright/test';

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
}

test.describe('campaign persistence', () => {
  test.beforeEach(async ({ page }) => {
    await clearSaves(page);
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  });

  test('creates, closes and reopens a campaign [MVP-AC-01, TECH-11.1]', async ({ page }) => {
    await startCampaign(page);

    const identity = await page.getByText(/^c[0-9a-f]{24}$/).innerText();
    await expect(page.getByText('Saved at revision 1.')).toBeVisible();

    await page.getByRole('button', { name: 'Close campaign' }).click();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();
    await expect(page.getByText(new RegExp(`Saved campaign: ${PILOT}`))).toBeVisible();

    await page.getByRole('button', { name: 'Resume campaign' }).click();
    await expect(page.getByText(identity, { exact: true })).toBeVisible();
  });

  test('resumes the campaign after the page is reloaded [MVP-AC-01]', async ({ page }) => {
    await startCampaign(page);
    const identity = await page.getByText(/^c[0-9a-f]{24}$/).innerText();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Resume campaign' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume campaign' }).click();

    await expect(page.getByText(identity, { exact: true })).toBeVisible();
    await expect(page.getByText(PILOT, { exact: true })).toBeVisible();
  });

  test('adds no simulation time while the game is closed [FUNC-22.12]', async ({ page }) => {
    await startCampaign(page);
    await expect(page.getByText('0s')).toBeVisible();

    await page.getByRole('button', { name: 'Close campaign' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Resume campaign' }).click();

    await expect(page.getByText(PILOT, { exact: true })).toBeVisible();
    await expect(page.getByText('0s')).toBeVisible();
  });

  test('deletes the campaign and its saves on reset [FUNC-3.4]', async ({ page }) => {
    await startCampaign(page);

    await page.getByRole('button', { name: 'Reset campaign' }).click();
    await page.getByRole('button', { name: 'Delete this campaign' }).click();

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

  test('makes no network request while saving [TECH-2, TECH-3.2]', async ({ page, baseURL }) => {
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (baseURL !== undefined && !request.url().startsWith(baseURL)) {
        foreign.push(request.url());
      }
    });

    await startCampaign(page);
    await page.getByRole('button', { name: 'Save now' }).click();
    await expect(page.getByText(/Saved at revision/)).toBeVisible();

    expect(foreign).toEqual([]);
  });
});
