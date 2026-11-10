import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';
import { createDirectGateway } from '@gateway/direct';
import type { LocalizationIssue } from '@shared';
import {
  GameRoot,
  LocalizationProvider,
  PREFERENCES_STORAGE_KEY,
  PreferencesProvider,
  usePreferences,
  type PreferenceStorage,
} from '@ui';

import { shippedContent } from '../support/content.ts';
import { openGameMenu, openSettings } from '../support/gameMenu.ts';

/**
 * The campaign surface (Functional Specification 3.1, 3.4; MVP-AC-01).
 *
 * Before a campaign is open the screen offers start and resume; once one is
 * open the persistent frame owns saving, closing and resetting. Each case acts
 * on the surface the way a player would and then asserts what the engine holds.
 */

function renderGame(
  options: { store?: MemorySaveStore; onIssue?: (issue: LocalizationIssue) => void } = {},
) {
  const store = options.store ?? createMemorySaveStore();
  const gateway = createDirectGateway({
    host: createEngineHost({ content: shippedContent(), saves: store }),
    defaultTimeoutMs: 5_000,
  });

  const result = render(
    <LocalizationProvider {...(options.onIssue === undefined ? {} : { onIssue: options.onIssue })}>
      <GameRoot gateway={gateway} />
    </LocalizationProvider>,
  );

  return { ...result, gateway, store, user: userEvent.setup() };
}

async function startCampaign(
  harness: ReturnType<typeof renderGame>,
  name = 'Vela Trask',
): Promise<void> {
  const field = await screen.findByLabelText('Pilot name');
  await harness.user.type(field, name);
  await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
  await screen.findByText(name);
}

describe('campaign surface', () => {
  it('offers a new campaign when nothing is saved [MVP-AC-01, FUNC-3.1]', async () => {
    const harness = renderGame();

    expect(await screen.findByLabelText('Pilot name')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start campaign' });
    expect(start).toBeUnavailable();
    // The reason is a tooltip on the control, not text beside it [FUNC-22.10].
    expect(start).toHaveAccessibleDescription('Enter a pilot name to start.');
    expect(screen.queryByRole('button', { name: 'Resume campaign' })).not.toBeInTheDocument();

    // Neither the button nor implicit form submission starts a nameless campaign.
    await harness.user.click(start);
    await harness.user.type(screen.getByLabelText('Pilot name'), '   {Enter}');
    expect(screen.getByRole('button', { name: 'Start campaign' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pilot name')).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('starts a campaign and reports it saved [MVP-AC-01, FUNC-3.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    expect(screen.getByText('Vela Trask')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Campaign save status' })).toHaveTextContent(
        'Saved at revision 1.',
      );
    });
    expect(harness.store.saveIds()).toHaveLength(1);

    harness.gateway.dispose();
  });

  it('shows the saved campaign after it is closed, and resumes it [MVP-AC-01]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    await openGameMenu(harness.user, true);
    await harness.user.click(screen.getByRole('button', { name: /Close campaign/ }));

    const resume = await screen.findByRole('button', { name: 'Resume campaign' });
    expect(screen.getByText(/Saved campaign: Vela Trask/)).toBeInTheDocument();
    expect(screen.getByText('Starting a new campaign replaces the saved one.')).toBeVisible();

    await harness.user.click(resume);

    expect(await screen.findByText('Vela Trask')).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('asks before discarding a campaign [FUNC-3.4, TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    await openGameMenu(harness.user, true);
    await harness.user.click(screen.getByRole('button', { name: /Reset campaign/ }));
    expect(
      screen.getByText(/Resetting deletes this campaign and every save of it/),
    ).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.getByText('Vela Trask')).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: /Reset campaign/ }));
    await harness.user.click(screen.getByRole('button', { name: /Delete this campaign/ }));

    expect(await screen.findByLabelText('Pilot name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume campaign' })).not.toBeInTheDocument();
    expect(harness.store.saveIds()).toEqual([]);

    harness.gateway.dispose();
  });

  it('saves on request and says so [FUNC-3.4]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    await openGameMenu(harness.user, true);
    await harness.user.click(screen.getByRole('button', { name: /Save now/ }));

    await waitFor(() => {
      expect(harness.store.saveIds().some((id) => id.includes(':manual:'))).toBe(true);
    });
    // The write is asynchronous, so the status settles a moment after the
    // command answered.
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Campaign save status' })).toHaveTextContent(
        'Saved at revision',
      );
    });

    harness.gateway.dispose();
  });

  it('warns when storage is nearly full or impermanent [TECH-11.1]', async () => {
    const harness = renderGame({
      store: createMemorySaveStore({
        persistence: false,
        storage: { persistent: false, usageBytes: 99, quotaBytes: 100 },
      }),
    });
    await startCampaign(harness);

    expect(await screen.findByText(/Local storage is nearly full/)).toBeInTheDocument();
    expect(screen.getByText(/has not promised to keep the campaign/)).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('explains why an action was refused [FUNC-22.10]', async () => {
    const store = createMemorySaveStore();
    const gateway = createDirectGateway({
      host: createEngineHost({ content: shippedContent(), saves: store }),
      defaultTimeoutMs: 5_000,
    });
    render(
      <LocalizationProvider>
        <GameRoot gateway={gateway} />
      </LocalizationProvider>,
    );
    await screen.findByLabelText('Pilot name');

    // Someone else opened a campaign on this engine; the panel's next action
    // is refused and must say why.
    await gateway.request('campaign.create', {
      displayName: 'Another Pilot',
      seed: '0123456789abcdef0123456789abcdef',
      createdAtRealMs: 1_700_000_000_000,
    });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Pilot name'), 'Vela');
    await user.click(screen.getByRole('button', { name: 'Start campaign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/A campaign is already open/);

    gateway.dispose();
  });

  it('announces the save state in a live region [TECH-12.3]', async () => {
    const harness = renderGame();
    const status = await screen.findByRole('status', { name: 'Campaign save status' });

    expect(status).toHaveAttribute('aria-live', 'polite');

    harness.gateway.dispose();
  });

  it('renders every string from the catalogue [TECH-12.5]', async () => {
    const onIssue = vi.fn();
    const harness = renderGame({ onIssue });
    await startCampaign(harness);
    await openGameMenu(harness.user, true);
    await harness.user.click(screen.getByRole('button', { name: /Reset campaign/ }));

    expect(onIssue).not.toHaveBeenCalled();

    harness.gateway.dispose();
  });

  it('is operable with the keyboard alone [TECH-12.3]', async () => {
    const harness = renderGame();
    const field = await screen.findByLabelText('Pilot name');

    field.focus();
    await harness.user.keyboard('Keyboard Pilot');
    // Submitting the form from the field is how a keyboard user starts.
    await harness.user.keyboard('{Enter}');

    expect(await screen.findByText('Keyboard Pilot')).toBeInTheDocument();

    harness.gateway.dispose();
  });
});

/**
 * One header, the game menu behind the settings icon, and one Settings
 * destination with one effective set of preferences (MVP UI review 01,
 * phase UIR1-02; Functional Specification 19.1, 20; Technical Specification 12.3).
 */
describe('game menu and settings', () => {
  function memoryStorage(): PreferenceStorage & { values: Map<string, string> } {
    const values = new Map<string, string>();
    return {
      values,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
  }

  function renderWithStorage(storage: PreferenceStorage) {
    const gateway = createDirectGateway({
      host: createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() }),
      defaultTimeoutMs: 5_000,
    });
    const result = render(
      <LocalizationProvider>
        <GameRoot gateway={gateway} preferenceStorage={storage} />
      </LocalizationProvider>,
    );
    return { ...result, gateway, user: userEvent.setup() };
  }

  afterEach(() => {
    const root = document.documentElement;
    root.removeAttribute('data-contrast');
    root.removeAttribute('data-motion');
    root.style.removeProperty('--gs-ui-scale');
    root.style.removeProperty('--gs-text-scale');
  });

  it('offers Settings from an icon-only game menu before a campaign is open [FUNC-20, TECH-12.3]', async () => {
    const harness = renderWithStorage(memoryStorage());
    const trigger = await screen.findByRole('button', { name: 'Game menu' });
    // Icon only: the name is the accessible label and the tooltip, not visible text.
    expect(trigger).toHaveAttribute('aria-label', 'Game menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveTextContent('Game menu');

    await harness.user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await harness.user.click(screen.getByRole('button', { name: /^Settings/ }));

    const settings = screen.getByRole('region', { name: 'Settings' });
    expect(within(settings).getByRole('heading', { name: 'Settings' })).toHaveFocus();
    // Alerts and sound are one group of Settings.
    expect(within(settings).getByRole('region', { name: 'Alerts and sound' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await harness.user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    harness.gateway.dispose();
  });

  it('keeps every previous menu entry, closes on Escape and outside presses, and drops a pending reset [FUNC-19.1, FUNC-3.4, TECH-12.3]', async () => {
    const harness = renderGame();
    await startCampaign(harness);
    expect(screen.queryByRole('button', { name: /Save now/ })).not.toBeInTheDocument();

    await openGameMenu(harness.user, true);
    const menu = screen.getByRole('group', { name: 'Game menu' });
    for (const name of [/^Hide guidance/, /Save now/, /Close campaign/, /Reset campaign/, /^Settings/]) {
      expect(within(menu).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Campaign details')).toBeInTheDocument();

    await harness.user.click(screen.getByRole('button', { name: /Reset campaign/ }));
    expect(screen.getByRole('button', { name: /Delete this campaign/ })).toBeInTheDocument();
    await harness.user.keyboard('{Escape}');
    const trigger = screen.getByRole('button', { name: 'Game menu' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Save now/ })).not.toBeInTheDocument();

    // Reopened, the half-finished reset is gone and nothing was deleted.
    await openGameMenu(harness.user, true);
    expect(screen.queryByRole('button', { name: /Delete this campaign/ })).not.toBeInTheDocument();
    expect(harness.store.saveIds().length).toBeGreaterThan(0);

    await harness.user.click(screen.getByText('Borrell Harbour', { selector: 'h2' }));
    expect(screen.queryByRole('button', { name: /Save now/ })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    harness.gateway.dispose();
  });

  it('names the system and its danger while docked, from the station projection [FUNC-19.1, MVP-AC-03]', async () => {
    const harness = renderGame();
    await startCampaign(harness);

    expect(await screen.findByText('Docked at Borrell Harbour')).toBeInTheDocument();
    expect(screen.getByText('Borrell — danger 1')).toBeInTheDocument();

    harness.gateway.dispose();
  });

  it('applies a change made in Settings during play at once, through the one preference state [FUNC-20, TECH-12.3, TECH-3.1]', async () => {
    const storage = memoryStorage();
    const harness = renderWithStorage(storage);
    const field = await screen.findByLabelText('Pilot name');
    await harness.user.type(field, 'Vela Trask');
    await harness.user.click(screen.getByRole('button', { name: 'Start campaign' }));
    await screen.findByRole('heading', { level: 2, name: 'Borrell Harbour' });

    await openSettings(harness.user);
    const settings = screen.getByRole('region', { name: 'Settings' });
    await harness.user.selectOptions(within(settings).getByLabelText('Text size'), '1.5');
    expect(document.documentElement.style.getPropertyValue('--gs-text-scale')).toBe('1.5');

    // A binding changed in Settings is the one the play screen dispatches.
    const keys = within(settings).getByRole('region', { name: 'Keyboard shortcuts' });
    await harness.user.click(within(keys).getByRole('button', { name: 'Change key for Market' }));
    await harness.user.keyboard('z');
    await harness.user.click(within(settings).getByRole('button', { name: 'Close settings' }));
    expect(screen.getByRole('button', { name: 'Game menu' })).toHaveFocus();

    const market = within(screen.getByRole('navigation', { name: 'Station services' }))
      .getByRole('button', { name: /^Market/ });
    expect(market).not.toHaveAttribute('aria-current', 'page');
    await harness.user.keyboard('z');
    expect(market).toHaveAttribute('aria-current', 'page');

    // Notification visibility and sound live in the same stored set.
    await openSettings(harness.user);
    await harness.user.click(screen.getByRole('checkbox', { name: 'Play sounds' }));
    expect(JSON.parse(storage.values.get(PREFERENCES_STORAGE_KEY) ?? '{}')).toMatchObject({
      display: { textScale: 1.5 },
      audio: { enabled: false },
      bindings: { 'station.market': 'z' },
    });
    harness.unmount();
    harness.gateway.dispose();

    // Reopened, the game reads the same choices back.
    const again = renderWithStorage(storage);
    await screen.findByLabelText('Pilot name');
    expect(document.documentElement.style.getPropertyValue('--gs-text-scale')).toBe('1.5');
    again.gateway.dispose();
  });

  it('keeps one effective preference state when providers are nested [TECH-12.3]', async () => {
    const outer = memoryStorage();
    const inner = memoryStorage();
    function Probe(): JSX.Element {
      const { preferences, update } = usePreferences();
      return (
        <button type="button" onClick={() => {
          update((current) => ({ ...current, audio: { ...current.audio, enabled: false } }));
        }}
        >
          {preferences.audio.enabled ? 'sound on' : 'sound off'}
        </button>
      );
    }
    render(
      <PreferencesProvider storage={outer}>
        <Probe />
        <PreferencesProvider storage={inner}>
          <Probe />
        </PreferencesProvider>
      </PreferencesProvider>,
    );
    const user = userEvent.setup();
    const [first, second] = screen.getAllByRole('button');
    await user.click(second!);
    expect(first).toHaveTextContent('sound off');
    expect(second).toHaveTextContent('sound off');
    expect(outer.values.size).toBe(1);
    expect(inner.values.size).toBe(0);
  });
});
