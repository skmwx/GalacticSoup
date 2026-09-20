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
      expect(button).toBeDisabled();
    });
    expect(work).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.resolve();
      await held.promise;
    });
    await waitFor(() => {
      expect(button).toBeEnabled();
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
    expect(button).toBeDisabled();
    expect(screen.getByText(/wallet does not have enough credits/)).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription(/wallet does not have enough credits/);
  });
});
