import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Guidance and notifications under the accessibility baseline
 * (Functional Specification 3.2, 19.7, 20; Technical Specification 12.3-12.4;
 * MVP-AC-10).
 *
 * The guidance panel, the notifications, the event log and the alert
 * settings pass an automated audit, can be reached and operated from the
 * keyboard, and say what they mean in words and shapes rather than colour.
 */

const PILOT = 'Guided Pilot';

async function freshCampaign(page: Page): Promise<void> {
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
  await page.getByLabel('Pilot name').fill(PILOT);
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
}

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe('guidance and notification accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await freshCampaign(page);
  });

  test('passes an audit with the guidance, a notification, the event log and the settings open [TECH-12.3, FUNC-19.7, MVP-AC-10]', async ({ page }) => {
    const guidance = page.getByRole('region', { name: 'Flight school', exact: true });
    await expect(guidance).toBeVisible();
    await guidance.getByText('All steps').click();
    await guidance.getByRole('button', { name: 'Show me' }).click();
    await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
    const notices = page.getByRole('region', { name: 'Notifications', exact: true });
    await expect(notices.getByText('Done: Choose a site.')).toBeVisible();
    await audit(page);

    await page.getByRole('button', { name: /^Event log/ }).click();
    await expect(page.getByRole('region', { name: 'Event log', exact: true })).toBeVisible();
    await audit(page);

    await page.getByRole('button', { name: /^Alerts and sound/ }).click();
    await expect(page.getByRole('region', { name: 'Alerts and sound', exact: true })).toBeVisible();
    await audit(page);
  });

  test('operates the guidance and the event log from the keyboard alone [TECH-12.3, FUNC-20, FUNC-3.2]', async ({ page }) => {
    const guidance = page.getByRole('region', { name: 'Flight school', exact: true });
    await guidance.getByRole('button', { name: 'Show me' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 3, name: 'Departure' })).toBeVisible();

    await guidance.getByRole('button', { name: 'Skip step' }).focus();
    await page.keyboard.press('Enter');
    await expect(guidance.getByRole('heading', { level: 3 })).toHaveText('Carry spare rounds');

    // J hides and shows the guidance; I opens the event log.
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('j');
    await expect(guidance).toBeHidden();
    await page.keyboard.press('j');
    await expect(guidance).toBeVisible();
    await page.keyboard.press('i');
    const log = page.getByRole('region', { name: 'Event log', exact: true });
    await expect(log).toBeVisible();
    await log.getByLabel('Show').focus();
    await page.keyboard.press('ArrowDown');
    await expect(log.getByLabel('Show')).toHaveValue('warnings');
  });

  test('names a step\'s state and a notification\'s level in words, not colour alone [TECH-12.2, TECH-12.3, FUNC-19.7]', async ({ page }) => {
    const guidance = page.getByRole('region', { name: 'Flight school', exact: true });
    await guidance.getByRole('button', { name: 'Skip step' }).click();
    await guidance.getByText('All steps').click();
    await expect(guidance.locator('[data-status="skipped"]')).toContainText('skipped');
    await expect(guidance.locator('[data-status="current"]')).toContainText('next');

    await guidance.getByRole('button', { name: 'Show me' }).click();
    await expect(page.getByRole('button', { name: 'Hangar', exact: true }))
      .toHaveAccessibleDescription('The guidance says your next step is here.');

    // Carrying the spare rounds completes the step the guidance pointed at.
    await page.getByRole('table', { name: 'Station hangar' }).getByRole('row', { name: /Fusion S/ })
      .getByRole('button', { name: 'Move to hold' }).click();
    await page.getByRole('button', { name: /^Event log/ }).click();
    const entry = page.getByRole('region', { name: 'Event log', exact: true }).getByRole('listitem').first();
    await expect(entry).toContainText(/Info|Done|Warning|Danger/);
    await expect(entry.locator('[data-severity-icon]')).toHaveCount(1);
  });

  test('stays usable at a doubled interface and text scale [TECH-12.3, TECH-12.5]', async ({ page }) => {
    await page.addStyleTag({ content: ':root { --gs-ui-scale: 2; --gs-text-scale: 2; }' });
    const guidance = page.getByRole('region', { name: 'Flight school', exact: true });
    await expect(guidance.getByRole('button', { name: 'Skip step' })).toBeVisible();
    await page.getByRole('button', { name: /^Alerts and sound/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Show Combat alerts' })).toBeVisible();
    await audit(page);
  });
});
