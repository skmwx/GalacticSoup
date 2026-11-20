import { expect, test, type Page } from '@playwright/test';

import { audit } from '../support/axe.ts';
import { openCheckpoint } from '../support/checkpoint/browser.ts';

/**
 * The combat surfaces under automated audit
 * (Technical Specification 12.2, 12.3; Functional Specification 19.3, 20).
 *
 * A fight fills the space view with status, weapons, modules, locks, the
 * encounter roster and the log, and a secondary click adds a menu over the
 * drawing. Each of those must pass the same audit as the station, carry its
 * states in words as well as colour, and stay usable at a doubled scale.
 *
 * Every case begins in the middle of a fight, so each opens the same saved
 * fight (Test Suite Optimization Plan phases 3 and 7): the scout locked, the
 * autocannon firing at it and the booster running, paused. It was reached
 * headlessly and is opened through the start screen and the worker; the
 * helper first checks the fight's status is shown in words - the site, the
 * paused clock, the lock and the weapon firing at the scout. Flying there and
 * locking through the interface are the command cases' evidence
 * (`tests/browser/combat.spec.ts`).
 *
 * The audit uses the axe tags the station and presentation audits share
 * (`tests/support/axe.ts`), so this is also the fight audit at the standard
 * presentation (Test Suite Optimization Plan phase 10a).
 */

/** Opens the saved fight with the scout, paused. */
async function inAFight(page: Page, baseURL: string | undefined): Promise<void> {
  await openCheckpoint(page, 'scout-fight', baseURL);
}

test.describe('combat accessibility', () => {
  test('passes an automated audit in the middle of a fight [TECH-12.3, FUNC-19.3]', async ({ page, baseURL }) => {
    await inAFight(page, baseURL);

    // Open every weapon and module entry, then every explanation, so their contents are audited too.
    const closed = page.locator('[data-panel="equipment"] button[aria-expanded="false"]');
    while ((await closed.count()) > 0) {
      await closed.first().click();
    }
    // Only the explanations on screen: one inside a hidden view (such as a
    // destination's drop chances) cannot be clicked and is not what the pilot sees.
    for (const summary of await page.locator('summary').all()) {
      if (await summary.isVisible()) await summary.click();
    }
    await audit(page);
  });

  test('passes an audit with the context menu open, and closes it with Escape [TECH-12.3, FUNC-20]', async ({
    page,
    baseURL,
  }) => {
    await inAFight(page, baseURL);

    const entry = page.getByRole('region', { name: 'In this site' }).getByRole('button', { name: /Pirate Scout/ });
    await entry.focus();
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('group', { name: 'Commands for Pirate Scout' });
    await expect(menu).toBeVisible();
    await audit(page);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(entry).toBeFocused();
  });

  test('names hostility, locks and threats in words, not only colour [TECH-12.2, FUNC-9.1]', async ({ page, baseURL }) => {
    await inAFight(page, baseURL);

    const entry = page.getByRole('region', { name: 'In this site' }).getByRole('button', { name: /Pirate Scout/ });
    await expect(entry).toContainText('Hostile');
    await expect(entry).toContainText('Locked');
    // The drawing's hostile and lock states are shapes, not only strokes.
    await expect(page.locator('[data-layer="objects"] [data-hostile="true"]')).toHaveCount(1);
    await expect(page.locator('[data-layer="objects"] [data-lock-marker="locked"]')).toHaveCount(1);
  });

  test('stays usable at a doubled interface scale in a fight [TECH-12.3]', async ({ page, baseURL }) => {
    await inAFight(page, baseURL);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--gs-ui-scale', '2');
      document.documentElement.style.setProperty('--gs-text-scale', '2');
    });

    await expect(page.getByRole('region', { name: 'Weapons' })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
