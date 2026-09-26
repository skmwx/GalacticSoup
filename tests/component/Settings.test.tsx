import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActionButton,
  LocalizationProvider,
  PREFERENCES_STORAGE_KEY,
  PreferencesProvider,
  SettingsPanel,
  SHORTCUT_NOTICE_MS,
  ShortcutNotice,
  ShortcutProvider,
  useActionRunner,
  useActionShortcuts,
  useReducedMotion,
  type PreferenceStorage,
  type ShortcutHandlers,
} from '@ui';

/**
 * Presentation settings, remappable shortcuts and emergency controls
 * (Functional Specification 19.2, 20; Technical Specification 12.1, 12.3).
 */

function memoryStorage(initial: string | null = null): PreferenceStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== null) values.set(PREFERENCES_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

afterEach(() => {
  const root = document.documentElement;
  root.removeAttribute('data-contrast');
  root.removeAttribute('data-motion');
  root.style.removeProperty('--gs-ui-scale');
  root.style.removeProperty('--gs-text-scale');
  vi.useRealTimers();
});

function MotionProbe(): JSX.Element {
  return <p data-testid="motion">{useReducedMotion() ? 'reduced' : 'full'}</p>;
}

function renderSettings(storage = memoryStorage()) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <LocalizationProvider>
      <PreferencesProvider storage={storage}>
        <SettingsPanel onClose={onClose} />
        <MotionProbe />
      </PreferencesProvider>
    </LocalizationProvider>,
  );
  return { user, onClose, storage };
}

/** A surface offering two shortcuts: one that acts and one that refuses. */
function Surface({ onLock, refuse }: { readonly onLock: () => void; readonly refuse: boolean }): JSX.Element {
  const runner = useActionRunner();
  const handlers: ShortcutHandlers = {
    'targeting.lock': () => {
      if (refuse) return 'error.ruleViolation.lockOutOfRange';
      onLock();
      return undefined;
    },
  };
  useActionShortcuts(handlers);
  return <ActionButton actionId="targeting.lock" runner={runner} onRun={onLock} />;
}

describe('display settings', () => {
  it('applies interface size, text size, contrast and motion at once and stores them in the browser [FUNC-20, TECH-12.3, TECH-3.1]', async () => {
    const { user, storage } = renderSettings();
    const root = document.documentElement;

    await user.selectOptions(screen.getByLabelText('Interface size'), '2');
    await user.selectOptions(screen.getByLabelText('Text size'), '1.5');
    await user.selectOptions(screen.getByLabelText('Contrast'), 'high');
    await user.selectOptions(screen.getByLabelText('Motion'), 'reduced');

    expect(root.style.getPropertyValue('--gs-ui-scale')).toBe('2');
    expect(root.style.getPropertyValue('--gs-text-scale')).toBe('1.5');
    expect(root).toHaveAttribute('data-contrast', 'high');
    expect(root).toHaveAttribute('data-motion', 'reduced');
    expect(screen.getByTestId('motion')).toHaveTextContent('reduced');
    expect(JSON.parse(storage.values.get(PREFERENCES_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 2,
      display: { uiScale: 2, textScale: 1.5, contrast: 'high', motion: 'reduced' },
    });

    await user.click(screen.getByRole('button', { name: 'Restore display defaults' }));
    expect(root.style.getPropertyValue('--gs-ui-scale')).toBe('');
    expect(root).not.toHaveAttribute('data-contrast');
    expect(screen.getByTestId('motion')).toHaveTextContent('full');
  });

  it('lists the undock question as optional and the price confirmations as always asked [FUNC-20, FUNC-19.5]', async () => {
    const { user, storage } = renderSettings();
    const question = screen.getByRole('checkbox', { name: 'Ask before undocking with a warning' });
    expect(question).toBeChecked();
    await user.click(question);
    expect(JSON.parse(storage.values.get(PREFERENCES_STORAGE_KEY) ?? '{}').confirmations)
      .toEqual({ undockWithWarnings: false });
    expect(screen.getByText(/Always asked: the total price/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore default confirmations' }));
    expect(question).toBeChecked();
  });

  it('closes on Escape, as a non-modal panel [TECH-12.3]', async () => {
    const { user, onClose } = renderSettings();
    screen.getByLabelText('Contrast').focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('remapping shortcuts', () => {
  it('binds the next key pressed, and names the action that lost it [FUNC-20, FUNC-19.2, TECH-12.3]', async () => {
    const { user } = renderSettings();
    const keys = screen.getByRole('region', { name: 'Keyboard shortcuts' });

    await user.click(within(keys).getByRole('button', { name: 'Change key for Lock target' }));
    const capture = within(keys).getByRole('button', { name: 'Press the new key for Lock target' });
    expect(capture).toHaveFocus();
    await user.keyboard('z');
    expect(within(keys).getByText('Lock target now uses Z.')).toBeInTheDocument();

    await user.click(within(keys).getByRole('button', { name: 'Change key for Lock target' }));
    await user.keyboard('s');
    expect(within(keys).getByText('Lock target now uses S. Stop had it and now has no key.')).toBeInTheDocument();
    const stopRow = keys.querySelector('[data-binding="movement.stop"]');
    expect(stopRow).toHaveTextContent('No key');
  });

  it('refuses a key the page needs and keeps the old key on Escape [FUNC-20, TECH-12.3]', async () => {
    const { user } = renderSettings();
    const keys = screen.getByRole('region', { name: 'Keyboard shortcuts' });
    const row = (): Element | null => keys.querySelector('[data-binding="targeting.lock"]');

    await user.click(within(keys).getByRole('button', { name: 'Change key for Lock target' }));
    await user.keyboard('{Enter}');
    expect(within(keys).getByText('Enter cannot be a shortcut: the page needs it.')).toBeInTheDocument();
    expect(row()).toHaveTextContent('L');

    await user.click(within(keys).getByRole('button', { name: 'Change key for Lock target' }));
    await user.keyboard('{Escape}');
    expect(within(keys).getByText('Lock target keeps its key.')).toBeInTheDocument();
    expect(row()).toHaveTextContent('L');

    await user.click(within(keys).getByRole('button', { name: 'Remove key for Lock target' }));
    expect(row()).toHaveTextContent('No key');
    await user.click(within(keys).getByRole('button', { name: 'Restore default keys' }));
    expect(row()).toHaveTextContent('L');
  });
});

describe('shortcut dispatch', () => {
  function renderSurface(options: { refuse?: boolean; stored?: string } = {}) {
    const onLock = vi.fn();
    render(
      <LocalizationProvider>
        <PreferencesProvider storage={memoryStorage(options.stored ?? null)}>
          <ShortcutProvider>
            <Surface onLock={onLock} refuse={options.refuse ?? false} />
            <ShortcutNotice />
          </ShortcutProvider>
        </PreferencesProvider>
      </LocalizationProvider>,
    );
    return onLock;
  }

  it('follows the player\'s binding on the key, the button and its announced shortcut [FUNC-20, TECH-12.3]', () => {
    const onLock = renderSurface({ stored: JSON.stringify({ version: 2, bindings: { 'targeting.lock': 'z' } }) });
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(onLock).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'z' });
    expect(onLock).toHaveBeenCalledTimes(1);
    const button = screen.getByRole('button', { name: /^Lock target/ });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Z');
    expect(within(button).getByText('Z')).toBeInTheDocument();
  });

  it('says why a refused key did nothing, and that a key not offered here is not available [FUNC-20, MVP-AC-10]', () => {
    vi.useFakeTimers();
    renderSurface({ refuse: true });
    const notice = screen.getByRole('status');
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(notice).toHaveTextContent('Lock target (L): That target is beyond maximum lock range.');

    fireEvent.keyDown(document.body, { key: 'm' });
    expect(notice).toHaveTextContent('Market (M): Not available here.');

    act(() => {
      vi.advanceTimersByTime(SHORTCUT_NOTICE_MS);
    });
    expect(notice).toBeEmptyDOMElement();
  });

  it('ignores keys typed into a field, pressed with a modifier or held down, but lets pause through a list box [FUNC-20, TECH-12.3]', () => {
    const onLock = vi.fn();
    const onPause = vi.fn();
    function Page(): JSX.Element {
      useActionShortcuts({
        'targeting.lock': () => {
          onLock();
        },
        'time.toggle': () => {
          onPause();
        },
      });
      return (
        <>
          <input aria-label="Name" />
          <select aria-label="Range"><option>1</option></select>
        </>
      );
    }
    render(
      <LocalizationProvider>
        <PreferencesProvider storage={null}>
          <ShortcutProvider>
            <Page />
          </ShortcutProvider>
        </PreferencesProvider>
      </LocalizationProvider>,
    );
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'l' });
    fireEvent.keyDown(document.body, { key: 'l', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'l', repeat: true });
    fireEvent.keyDown(screen.getByLabelText('Range'), { key: 'l' });
    expect(onLock).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Range'), { key: 'p' });
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

describe('emergency controls while a command is pending', () => {
  it('keeps pause, stop and retreat usable while another command is in flight [TECH-12.1, FUNC-20]', async () => {
    const user = userEvent.setup();
    const ran: string[] = [];
    function Controls(): JSX.Element {
      const runner = useActionRunner();
      const [never] = useState(() => new Promise<void>(() => undefined));
      return (
        <>
          <ActionButton actionId="navigation.warp" runner={runner} onRun={() => never} />
          {['time.toggle', 'movement.stop', 'navigation.retreat'].map((id) => (
            <ActionButton key={id} actionId={id} runner={runner} onRun={() => { ran.push(id); }} />
          ))}
        </>
      );
    }
    render(
      <LocalizationProvider>
        <Controls />
      </LocalizationProvider>,
    );
    await user.click(screen.getByRole('button', { name: /^Warp/ }));
    expect(screen.getByRole('button', { name: /^Warp/ })).toBeDisabled();

    for (const name of [/^Pause|^Resume|^Time/, /^Stop/, /^Retreat/]) {
      const button = screen.getAllByRole('button', { name }).at(0);
      expect(button).toBeEnabled();
      await user.click(button as HTMLElement);
    }
    expect(ran).toEqual(['time.toggle', 'movement.stop', 'navigation.retreat']);
  });
});
