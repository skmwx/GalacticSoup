import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * The automated accessibility audit the station, presentation and combat
 * surfaces share (Technical Specification 12.3; Test Suite Optimization Plan
 * phase 10a): WCAG 2.1 A and AA, and the WCAG 2.2 AA rules such as the
 * pointer-target size, with the same tags wherever one surface is audited.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/** Fails with axe's own report when the page as it stands has any violation. */
export async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  expect(results.violations).toEqual([]);
}

/** The interface does not scroll sideways: everything fits the window's width. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
}
