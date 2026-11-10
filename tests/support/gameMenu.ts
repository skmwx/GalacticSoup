import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Opens the game menu the way a player does, for component tests: the
 * icon-only trigger, then optionally the Campaign management disclosure.
 * Browser tests use `cockpit.ts` instead.
 */
export async function openGameMenu(user: UserEvent, management = false): Promise<void> {
  const trigger = await screen.findByRole('button', { name: 'Game menu' });
  if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger);
  if (management) {
    const summary = screen.getByText('Campaign management', { exact: true });
    if (!(summary.parentElement?.hasAttribute('open') ?? false)) await user.click(summary);
  }
}

/** Settings is the game menu's last entry. */
export async function openSettings(user: UserEvent): Promise<void> {
  await openGameMenu(user);
  await user.click(screen.getByRole('button', { name: /^Settings/ }));
}
