import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Automated accessibility checks run from the first phase so later interface
 * work starts from a clean baseline (Technical Specification 12.3, 15.1).
 * Keyboard-only scripted flows grow with the surfaces they cover.
 */
test.describe('shell accessibility', () => {
  test('has no automatically detectable violations [TECH-12.3]', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('exposes a document language and one top-level heading [TECH-12.3]', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('remains readable at a doubled interface scale [TECH-12.3]', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Engine status' })).toHaveText(/Engine ready/);

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--gs-ui-scale', '2');
      document.documentElement.style.setProperty('--gs-text-scale', '2');
    });

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Engine status' })).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
