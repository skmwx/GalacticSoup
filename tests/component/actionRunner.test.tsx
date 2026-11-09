import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  ACTIONS,
  ActionButton,
  actionById,
  defaultShortcuts,
  LocalizationProvider,
  useActionRunner,
  type ActionRunner,
} from '@ui';

/**
 * The action registry and the rule that runs one action once
 * (Technical Specification 12.1, 12.3).
 *
 * A control with a command in flight must not submit it again: the engine
 * would treat a second request id as a second command. Every station control
 * shares this rule rather than guarding itself.
 */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = () => {
      settle();
    };
  });
  return { promise, resolve };
}

describe('the action registry', () => {
  it('gives every action a label, an icon and a remapping category [TECH-12.3]', () => {
    for (const action of ACTIONS) {
      expect(action.id.length).toBeGreaterThan(0);
      expect(action.labelKey.length).toBeGreaterThan(0);
      expect(action.icon.length).toBeGreaterThan(0);
      expect(action.category.length).toBeGreaterThan(0);
    }
  });

  it('registers each id once and each shortcut once [TECH-12.3]', () => {
    const ids = ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);

    const shortcuts = ACTIONS.flatMap((action) =>
      action.shortcut === null ? [] : [action.shortcut],
    );
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(defaultShortcuts().size).toBe(shortcuts.length);
  });

  it('refuses to describe an action nobody registered [TECH-12.3]', () => {
    expect(() => actionById('station.teleport')).toThrow(/station\.teleport/);
  });
});

describe('the action runner', () => {
  it('refuses a second start while the first is in flight [TECH-12.1]', async () => {
    const { result } = renderHook(() => useActionRunner());
    const first = deferred();
    const work = vi.fn(() => first.promise);

    act(() => {
      expect(result.current.run('market.buy', work)).toBe(true);
    });
    expect(result.current.isPending('market.buy')).toBe(true);

    act(() => {
      expect(result.current.run('market.buy', work)).toBe(false);
    });
    expect(work).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await first.promise;
    });

    expect(result.current.isPending('market.buy')).toBe(false);
  });

  it('keeps a different action free while one is in flight [TECH-12.1]', async () => {
    const { result } = renderHook(() => useActionRunner());
    const held = deferred();

    act(() => {
      result.current.run('market.buy', () => held.promise);
    });
    act(() => {
      expect(result.current.run('market.sell', () => Promise.resolve())).toBe(true);
    });

    expect(result.current.isPending('market.buy')).toBe(true);
    await waitFor(() => {
      expect(result.current.isPending('market.sell')).toBe(false);
    });

    await act(async () => {
      held.resolve();
      await held.promise;
    });
  });

  it('frees the action again after the command fails [TECH-12.1]', async () => {
    const { result } = renderHook(() => useActionRunner());

    await act(async () => {
      result.current.run('repair.confirm', () => Promise.reject(new Error('refused')));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isPending('repair.confirm')).toBe(false);
    });
  });
});

describe('an action button', () => {
  function Harness({ work }: { readonly work: () => Promise<void> }) {
    const runner: ActionRunner = useActionRunner();
    return (
      <LocalizationProvider>
        <ActionButton actionId="market.buy" runner={runner} onRun={work} />
      </LocalizationProvider>
    );
  }

  it('cannot be submitted twice while its command is running [TECH-12.1]', async () => {
    const held = deferred();
    const work = vi.fn(() => held.promise);
    render(<Harness work={work} />);
    const user = userEvent.setup();

    const button = screen.getByRole('button', { name: /Buy/ });
    await user.click(button);

    await waitFor(() => {
      expect(button).toBeUnavailable();
    });
    expect(work).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.resolve();
      await held.promise;
    });
    await waitFor(() => {
      expect(button).not.toBeUnavailable();
    });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('stays visible and says why when it is unavailable [FUNC-22.10]', () => {
    function Unavailable() {
      const runner = useActionRunner();
      return (
        <LocalizationProvider>
          <ActionButton
            actionId="market.buy"
            runner={runner}
            available={false}
            unavailableReason="market.unavailable.insufficientCredits"
            onRun={() => Promise.resolve()}
          />
        </LocalizationProvider>
      );
    }
    render(<Unavailable />);

    const button = screen.getByRole('button', { name: /Buy/ });
    expect(button).toBeUnavailable();
    expect(screen.getByText(/wallet does not have enough credits/)).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription(/wallet does not have enough credits/);
  });
});

/**
 * Disabled reasons as tooltips and the icon-only presentation
 * (Technical Specification 12.3; Functional Specification 22.10).
 *
 * An unavailable control keeps keyboard focus and explains itself on hover and
 * focus, in a tooltip outside the layout, while refusing activation by pointer
 * and keyboard alike.
 */
describe('a disabled-reason tooltip', () => {
  const MARKET = 'Market';
  const REASON = /wallet does not have enough credits/;

  function Refused({ work, display }: { readonly work: () => Promise<void>; readonly display?: 'full' | 'icon' }) {
    const runner = useActionRunner();
    return (
      <LocalizationProvider>
        <ActionButton
          actionId="market.buy"
          runner={runner}
          available={false}
          unavailableReason="market.unavailable.insufficientCredits"
          label="Buy Fusion S"
          display={display ?? 'full'}
          onRun={work}
        />
        <button type="button">Next</button>
      </LocalizationProvider>
    );
  }

  const popup = (): HTMLElement | null => document.body.querySelector('[data-tooltip]');

  it('refuses pointer and keyboard activation while unavailable [TECH-12.3]', async () => {
    const work = vi.fn(() => Promise.resolve());
    render(<Refused work={work} />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: /Buy Fusion S/ });

    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(work).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('can be reached by keyboard and shows its reason on focus [FUNC-22.10]', async () => {
    render(<Refused work={() => Promise.resolve()} />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: /Buy Fusion S/ });

    expect(popup()).toBeNull();
    await user.tab();
    expect(button).toHaveFocus();
    expect(popup()).toHaveTextContent(REASON);
    // The popup is presentation; the description is announced once, from the control.
    expect(popup()).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveAccessibleDescription(REASON);

    await user.tab();
    expect(popup()).toBeNull();
  });

  it('shows its reason on hover, outside the layout, and Escape dismisses it [FUNC-22.10]', async () => {
    const { container } = render(<Refused work={() => Promise.resolve()} />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: /Buy Fusion S/ });

    await user.hover(button);
    const shown = popup();
    expect(shown).toHaveTextContent(REASON);
    // Drawn in a portal, not beside the control.
    expect(container.contains(shown)).toBe(false);

    button.focus();
    await user.keyboard('{Escape}');
    expect(popup()).toBeNull();
    expect(button).toHaveFocus();
  });

  it('dismisses on Escape without swallowing it, so a surrounding dialog still closes [TECH-12.3]', async () => {
    const onDocumentEscape = vi.fn();
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDocumentEscape();
    };
    document.addEventListener('keydown', listener, true);
    try {
      render(<Refused work={() => Promise.resolve()} />);
      const user = userEvent.setup();
      await user.tab();
      expect(popup()).not.toBeNull();
      await user.keyboard('{Escape}');
      expect(popup()).toBeNull();
      expect(onDocumentEscape).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', listener, true);
    }
  });

  it('shows one tooltip at a time when focus and pointer are on different controls [TECH-12.3]', async () => {
    function Two() {
      const runner = useActionRunner();
      return (
        <LocalizationProvider>
          <ActionButton
            actionId="market.buy"
            runner={runner}
            available={false}
            unavailableReason="market.unavailable.insufficientCredits"
            onRun={() => undefined}
          />
          <ActionButton
            actionId="market.sell"
            runner={runner}
            available={false}
            unavailableReason="shortcut.noSelection"
            onRun={() => undefined}
          />
        </LocalizationProvider>
      );
    }
    render(<Two />);
    const user = userEvent.setup();

    await user.tab();
    expect(document.body.querySelectorAll('[data-tooltip]')).toHaveLength(1);
    expect(popup()).toHaveTextContent(REASON);

    await user.hover(screen.getByRole('button', { name: /Sell/ }));
    expect(document.body.querySelectorAll('[data-tooltip]')).toHaveLength(1);
    expect(popup()).toHaveTextContent(/Select something/);
  });

  it('gives an icon-only control its full name and puts name and shortcut in the tooltip [TECH-12.3]', async () => {
    function IconOnly() {
      const runner = useActionRunner();
      return (
        <LocalizationProvider>
          <ActionButton actionId="station.market" runner={runner} display="icon" onRun={() => undefined} />
        </LocalizationProvider>
      );
    }
    render(<IconOnly />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: MARKET });

    // No visible label or shortcut badge on the button itself.
    expect(button).toHaveTextContent('');
    expect(button.querySelector('kbd')).toBeNull();
    expect(button).toHaveAttribute('aria-keyshortcuts', 'M');

    await user.hover(button);
    expect(popup()).toHaveTextContent(MARKET);
    expect(popup()?.querySelector('kbd')).toHaveTextContent('M');
  });

  it('keeps an icon-only control unavailable with its reason in the tooltip [FUNC-22.10]', async () => {
    const work = vi.fn(() => Promise.resolve());
    render(<Refused work={work} display="icon" />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Buy Fusion S' });

    expect(button).toHaveAccessibleDescription(REASON);
    await user.hover(button);
    expect(popup()).toHaveTextContent('Buy Fusion S');
    expect(popup()).toHaveTextContent(REASON);
    await user.click(button);
    expect(work).not.toHaveBeenCalled();
  });
});

