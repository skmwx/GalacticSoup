import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Presentation settings, input and accessibility across the MVP surfaces
 * (Functional Specification 19.1-19.7, 20; Technical Specification 12.2-12.3,
 * 15.1; MVP-AC-02, MVP-AC-03, MVP-AC-08, MVP-AC-10).
 *
 * Every station surface, every confirmation and the space view in a fight pass
 * the automated audit - including the WCAG 2.2 pointer-target rule - at the
 * default presentation and at doubled interface and text size in high
 * contrast with reduced motion, without scrolling sideways. The settings are
 * reached and changed by keyboard alone and by mouse alone and survive a
 * reload; a remapped key is the one the buttons, the guidance and the combat
 * shortcuts use; every dialog takes focus, keeps it and gives it back; and
 * with every colour made the same, each state still reads by shape or word.
 */

const PILOT = 'Presentation Pilot';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const STORAGE_KEY = 'galactic-soup.preferences';
const SURFACES = ['Overview', 'Market', 'Hangar', 'Fitting', 'Services', 'Ship', 'Departure'] as const;

interface Variant {
  readonly name: string;
  readonly display: {
    readonly uiScale: number;
    readonly textScale: number;
    readonly contrast: 'standard' | 'high';
    readonly motion: 'full' | 'reduced';
  };
}

const VARIANTS: readonly Variant[] = [
  { name: 'standard size and contrast', display: { uiScale: 1, textScale: 1, contrast: 'standard', motion: 'full' } },
  {
    name: 'doubled size, high contrast and reduced motion',
    display: { uiScale: 2, textScale: 2, contrast: 'high', motion: 'reduced' },
  },
];

async function clearProfile(page: Page): Promise<void> {
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
}

async function startCampaign(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);
  await page.getByLabel('Pilot name').fill(PILOT);
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible();
}

async function withDisplay(page: Page, display: Variant['display']): Promise<void> {
  await clearProfile(page);
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify({ version: 2, display })] as const,
  );
}

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
}

function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

function surface(page: Page, name: string): Locator {
  return page.getByRole('navigation', { name: 'Station services' }).getByRole('button', { name, exact: true });
}

/** Chooses the scout, undocks and arrives at 10 km. The ship already carries its spare rounds. */
async function flyToScout(page: Page): Promise<void> {
  await surface(page, 'Departure').click();
  await page.getByRole('button', { name: 'Choose Pirate Scout' }).click();
  await page.getByRole('button', { name: /^Undock/ }).click();
  await page.getByLabel('Arrive at').selectOption('10');
  await page.getByRole('button', { name: /^Warp/ }).click();
  await page.getByRole('button', { name: /^Resume/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Verge Belt' })).toBeVisible({ timeout: 60_000 });
}

function scoutEntry(page: Page): Locator {
  return region(page, 'In this site').getByRole('button', { name: /Pirate Scout/ });
}

/** Selects the scout, locks it once in range and opens fire; then pauses. */
async function engageScout(page: Page): Promise<void> {
  await scoutEntry(page).click();
  const lock = region(page, 'Selected').getByRole('button', { name: /^Lock target/ });
  await expect(lock).toBeEnabled({ timeout: 60_000 });
  await lock.click();
  const fire = region(page, 'Weapons').locator('[data-action="weapons.fire"]');
  await expect(fire).toBeEnabled({ timeout: 30_000 });
  await fire.click();
  await expect(page.locator('[data-effect="hostileLock"]').first()).toBeAttached({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Pause/ }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
}

/** Opens a dialog from the keyboard and proves it traps focus and gives it back. */
async function checkDialogFocus(page: Page, opener: Locator, title: string): Promise<void> {
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press(step % 3 === 2 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
}

test.describe('presentation settings and accessibility', () => {
  for (const variant of VARIANTS) {
    test(`audits every station surface, a confirmation and a fight at ${variant.name} [TECH-12.3, TECH-12.2, TECH-15.1, FUNC-20, MVP-AC-02, MVP-AC-03]`, async ({ page }) => {
      test.setTimeout(4 * 60_000);
      await withDisplay(page, variant.display);
      await startCampaign(page);

      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-contrast', variant.display.contrast);
      await expect(root).toHaveAttribute('data-motion', variant.display.motion);

      for (const name of SURFACES) {
        await surface(page, name).click();
        await expect(surface(page, name)).toHaveAttribute('aria-current', 'page');
        await audit(page);
        await expectNoSidewaysScroll(page);
      }

      await surface(page, 'Market').click();
      await page.getByRole('button', { name: 'Buy Fusion S' }).click();
      const purchase = page.getByRole('dialog', { name: 'Confirm purchase' });
      await expect(purchase.getByText('Calculating…')).toBeHidden();
      await audit(page);
      await purchase.getByRole('button', { name: 'Cancel' }).click();

      await page.getByRole('button', { name: /^Settings/ }).click();
      await expect(region(page, 'Settings')).toBeVisible();
      await audit(page);
      await expectNoSidewaysScroll(page);
      await page.getByRole('button', { name: 'Close settings' }).click();

      await flyToScout(page);
      await engageScout(page);
      await audit(page);
      await expectNoSidewaysScroll(page);
    });
  }

  test('changes the display from the keyboard alone before a campaign, and keeps it after a reload [FUNC-20, TECH-12.3, TECH-3.1]', async ({ page }) => {
    await clearProfile(page);
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);

    const opener = page.getByRole('button', { name: /^Settings/ });
    await opener.focus();
    await page.keyboard.press('Enter');
    const settings = region(page, 'Settings');
    await expect(settings).toBeVisible();

    // Arrow keys step a list box; each change applies at once.
    await settings.getByLabel('Text size').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(settings.getByLabel('Text size')).toHaveValue('1.5');
    await settings.getByLabel('Contrast').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(settings.getByLabel('Contrast')).toHaveValue('high');
    await settings.getByLabel('Motion').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(settings.getByLabel('Motion')).toHaveValue('reduced');

    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-contrast', 'high');
    await expect(root).toHaveAttribute('data-motion', 'reduced');
    expect(await root.evaluate((element) => element.style.getPropertyValue('--gs-text-scale'))).toBe('1.5');
    await audit(page);

    // Escape closes the non-modal panel and returns focus to its control.
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(opener).toBeFocused();

    // The settings are the browser's: a reload keeps them, a campaign does not own them.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
    await startCampaign(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      version: 2,
      display: { textScale: 1.5, contrast: 'high', motion: 'reduced' },
    });

    // Restoring the defaults hands contrast and motion back to the browser.
    await page.getByRole('button', { name: /^Settings/ }).click();
    await page.getByRole('button', { name: 'Restore display defaults' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-contrast', /.+/);
  });

  test('changes the settings and answers the undock warning with the mouse alone [FUNC-20, FUNC-10, MVP-AC-02]', async ({ page }) => {
    await clearProfile(page);
    await startCampaign(page);

    await page.getByRole('button', { name: /^Settings/ }).click();
    const settings = region(page, 'Settings');
    await settings.getByLabel('Interface size').selectOption('1.5');
    await expect(page.locator('html')).toHaveCSS('--gs-ui-scale', '1.5');
    await settings.getByRole('button', { name: 'Close settings' }).click();

    // Take the gun off: the ship may still undock, but it asks first.
    await surface(page, 'Fitting').click();
    await page.getByRole('button', { name: 'Change fit' }).click();
    await page.getByLabel('Module in Weapon 1').selectOption({ value: '' });
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();

    await surface(page, 'Departure').click();
    await expect(page.getByRole('list', { name: 'Before you undock' }).first()).toBeVisible();
    await page.getByRole('button', { name: /^Undock/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Undock with warnings?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('list', { name: 'Before you undock' })).toBeVisible();
    await audit(page);
    await confirm.getByRole('button', { name: 'Stay docked' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('heading', { level: 3, name: 'Departure' })).toBeVisible();

    // Switched off in the settings, the question is not asked.
    await page.getByRole('button', { name: /^Settings/ }).click();
    await settings.getByRole('checkbox', { name: 'Ask before undocking with a warning' }).click();
    await settings.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: /^Undock/ }).click();
    await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
    await expect(confirm).toBeHidden();
  });

  test('remaps a key from the keyboard; buttons, guidance and combat follow it, and a refused key says why [FUNC-20, FUNC-19.2, TECH-12.3, MVP-AC-03, MVP-AC-10]', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await clearProfile(page);
    await startCampaign(page);

    const opener = page.getByRole('button', { name: /^Settings/ });
    await opener.focus();
    await page.keyboard.press('Enter');
    const keys = region(page, 'Keyboard shortcuts');
    const change = keys.getByRole('button', { name: 'Change key for Lock target' });
    await change.focus();
    await page.keyboard.press('Enter');
    await expect(keys.getByRole('button', { name: 'Press the new key for Lock target' })).toBeFocused();

    // A key the page needs is refused; Escape keeps the old key.
    await page.keyboard.press('Tab');
    await keys.getByRole('button', { name: 'Change key for Lock target' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(keys.locator('[data-binding-message]')).toHaveText('Enter cannot be a shortcut: the page needs it.');

    // Z is free: Lock target takes it.
    await keys.getByRole('button', { name: 'Change key for Lock target' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('z');
    await expect(keys.locator('[data-binding-message]')).toHaveText('Lock target now uses Z.');
    await expect(keys.locator('[data-binding="targeting.lock"] kbd')).toHaveText('Z');

    // Departure moves to 0; the first guidance step names the new key.
    await keys.getByRole('button', { name: 'Change key for Departure' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('0');
    await expect(keys.locator('[data-binding="station.departure"] kbd')).toHaveText('0');
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await expect(page.getByRole('region', { name: 'Flight school', exact: true })).toContainText('Open Departure (0).');
    await page.keyboard.press('0');
    await expect(page.getByRole('heading', { level: 3, name: 'Departure' })).toBeVisible();

    await flyToScout(page);
    const lock = region(page, 'Selected');
    await scoutEntry(page).click();
    await expect(lock.getByRole('button', { name: /^Lock target/ })).toHaveAttribute('aria-keyshortcuts', 'Z');
    await expect(lock.getByRole('button', { name: /^Lock target/ }).locator('kbd')).toHaveText('Z');

    // Before the scout is in range Z says why; L no longer locks anything.
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const notice = page.locator('[data-shortcut-notice]');
    if (await lock.getByRole('button', { name: /^Lock target/ }).isDisabled()) {
      await page.keyboard.press('z');
      await expect(notice).toHaveText(/^Lock target \(Z\): /);
    }
    await expect(async () => {
      await page.keyboard.press('z');
      await expect(region(page, 'Locks').locator('[data-lock]')).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 90_000 });

    // A key with no handler on this surface says so rather than doing nothing.
    await page.keyboard.press('m');
    await expect(notice).toHaveText('Market (M): Not available here.');

    await page.keyboard.press('x');
    await expect(page.getByRole('heading', { level: 2, name: 'Borrell Harbour' })).toBeVisible({ timeout: 60_000 });
  });

  test('traps focus in every confirmation and returns it to the control that opened it [TECH-12.3, FUNC-19.5, FUNC-20]', async ({ page }) => {
    await clearProfile(page);
    await startCampaign(page);

    await surface(page, 'Market').click();
    await checkDialogFocus(page, page.getByRole('button', { name: 'Buy Fusion S' }), 'Confirm purchase');
    await checkDialogFocus(page, page.getByRole('button', { name: 'Sell Fusion S' }), 'Confirm sale');
    await checkDialogFocus(page, page.getByRole('button', { name: 'Inspect Fusion S' }).first(), 'Item details');

    await surface(page, 'Hangar').click();
    await checkDialogFocus(
      page,
      page.getByRole('table', { name: 'Ship cargo hold' }).getByRole('button', { name: /^Inspect/ }).first(),
      'Item details',
    );

    await surface(page, 'Services').click();
    await checkDialogFocus(page, page.getByRole('button', { name: 'Repair the ship' }), 'Confirm repair');
    await checkDialogFocus(page, page.getByRole('button', { name: 'Resupply ammunition' }), 'Confirm resupply');
    await checkDialogFocus(page, page.getByRole('button', { name: 'Improve insurance' }), 'Confirm insurance');

    // The undock question needs a warning: a ship with no gun.
    await surface(page, 'Fitting').click();
    await page.getByRole('button', { name: 'Change fit' }).click();
    await page.getByLabel('Module in Weapon 1').selectOption({ value: '' });
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();
    await surface(page, 'Departure').click();
    await checkDialogFocus(page, page.getByRole('button', { name: /^Undock/ }), 'Undock with warnings?');
  });

  test('keeps every state readable when every colour is the same [TECH-12.2, FUNC-20, FUNC-19.7, MVP-AC-08]', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await clearProfile(page);
    await startCampaign(page);
    await page.addStyleTag({
      content: `:root, :root[data-contrast] {
        --gs-color-accent: #d0d0d0; --gs-color-ok: #d0d0d0; --gs-color-warn: #d0d0d0;
        --gs-color-danger: #d0d0d0; --gs-color-text: #d0d0d0; --gs-color-text-muted: #d0d0d0;
      }`,
    });

    // Fitting validity: the undock status carries a tick; a warning an exclamation mark.
    await surface(page, 'Ship').click();
    await expect(page.getByRole('status', { name: 'Undock readiness' }).locator('[data-status-mark="ok"]')).toBeVisible();
    await surface(page, 'Fitting').click();
    await page.getByRole('button', { name: 'Change fit' }).click();
    await page.getByLabel('Module in Weapon 1').selectOption({ value: '' });
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await surface(page, 'Departure').click();
    await expect(page.getByRole('list', { name: 'Before you undock' }).first().locator('[data-status-mark="warning"]').first()).toBeVisible();
    await surface(page, 'Fitting').click();
    await page.getByRole('button', { name: 'Change fit' }).click();
    await page.getByLabel('Module in Weapon 1').selectOption({ value: 'module.turret.autocannon.small' });
    await page.getByLabel('Ammunition in Weapon 1').selectOption({ value: 'ammo.projectile.small.fusion' });
    await page.getByRole('button', { name: 'Apply fit' }).click();
    await expect(page.getByText('This is the fit your ship is wearing.', { exact: false })).toBeVisible();

    await flyToScout(page);
    await engageScout(page);

    // Hostility, selection, lock, player ownership and danger each have a shape.
    const view = page.locator('[data-layer="objects"]');
    await expect(view.locator('[data-attitude="hostile"] [data-hostile="true"]').first()).toBeAttached();
    await expect(view.locator('[data-selected="true"] [data-selection="true"]')).toHaveCount(1);
    await expect(view.locator('[data-lock-marker="locked"]')).toHaveCount(1);
    await expect(view.locator('[data-player="true"]')).toHaveCount(1);
    // ...and a word: threats, damage and notifications.
    await expect(page.locator('[data-readout="threats"]')).toHaveText(/\d+ hostile/);
    await expect(page.locator('[data-readout="defenses"]')).toHaveText(/\d+%/);
    const danger = page.locator('[data-severity="danger"]').first();
    await expect(danger).toContainText('Danger');
    await expect(danger.locator('[data-severity-icon]')).toHaveCount(1);
  });
});
