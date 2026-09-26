import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { AudioCueData, NotificationData, NotificationsData, SaveSlotData } from '@protocol';
import {
  AudioCuesProvider,
  ContentTextProvider,
  createRecordingCuePlayer,
  LocalizationProvider,
  NotificationCenter,
  PreferencesProvider,
  PREFERENCES_STORAGE_KEY,
  useActionRunner,
  type PreferenceStorage,
} from '@ui';

/**
 * Notifications as the player meets them (Functional Specification 19.7, 20;
 * Technical Specification 12.4; MVP-AC-10).
 *
 * The centre is driven with engine-shaped histories, so each case controls
 * exactly which entries are new: grouping, levels in words and shapes, the
 * category a player hid, the messages that cannot be hidden, the cue and its
 * rate limit, and a failing save.
 */

const CUES: readonly AudioCueData[] = [
  { id: 'cue.alert.danger', channel: 'alert', waveform: 'square', defaultFor: 'danger',
    notes: [{ frequencyHz: 880, durationMs: 100, gain: 0.3 }] },
  { id: 'cue.interface.informational', channel: 'interface', waveform: 'sine', defaultFor: 'informational',
    notes: [{ frequencyHz: 740, durationMs: 70, gain: 0.2 }] },
];

const TEXT: Readonly<Record<string, string>> = {
  'content.notify.lock': '{attacker} has locked your ship.',
  'content.notify.bounty': 'Bounty paid: {credits} ISK.',
  'content.notify.lost': 'Your {hull} was destroyed.',
  'content.notify.docked': 'Docked at {station}.',
  'content.name.scout': 'Pirate Scout',
  'content.name.hull': 'Wayfarer',
  'content.name.station': 'Borrell Harbour',
};

function fakeGateway(): ClientGateway {
  return {
    transport: 'direct',
    request: ((type: string) => Promise.resolve(
      type === 'audio.cues'
        ? { requestId: 'r', ok: true, revision: 0, data: { cues: CUES } }
        : { requestId: 'r', ok: true, revision: 0,
            data: { locale: 'en', resolvedLocale: 'en', contentVersion: 'test', messages: TEXT } },
    )) as ClientGateway['request'],
    sendEnvelope: () => Promise.reject(new Error('unused')),
    dispose: () => undefined,
  };
}

function entry(overrides: Partial<NotificationData> & Pick<NotificationData, 'id' | 'sequence'>): NotificationData {
  return {
    definitionId: 'notify.navigation.docked',
    category: 'navigation',
    severity: 'informational',
    messageKey: 'content.notify.docked',
    params: { stationKey: 'content.name.station' },
    subjectIds: [],
    firstAtMs: 1_000,
    lastAtMs: 1_000,
    count: 1,
    hideable: true,
    cueId: 'cue.interface.informational',
    ...overrides,
  };
}

const LOCK = (id: number, sequence: number, count = 1): NotificationData => entry({
  id, sequence, count, definitionId: 'notify.combat.hostile-lock', category: 'combat', severity: 'danger',
  messageKey: 'content.notify.lock', params: { attackerKey: 'content.name.scout' }, cueId: 'cue.alert.danger',
});
const BOUNTY = (id: number, sequence: number, count = 1, credits = 3_000): NotificationData => entry({
  id, sequence, count, definitionId: 'notify.encounter.bounty', category: 'encounter', severity: 'opportunity',
  messageKey: 'content.notify.bounty', params: { credits }, cueId: null,
});
const LOST = (id: number, sequence: number): NotificationData => entry({
  id, sequence, definitionId: 'notify.recovery.ship-lost', category: 'recovery', severity: 'danger',
  messageKey: 'content.notify.lost', params: { hullKey: 'content.name.hull' }, hideable: false,
  cueId: 'cue.alert.danger',
});

function history(...entries: NotificationData[]): NotificationsData {
  const sorted = [...entries].sort((a, b) => b.sequence - a.sequence);
  return { sequence: Math.max(0, ...entries.map((item) => item.sequence)), entries: sorted };
}

function memoryStorage(initial?: unknown): PreferenceStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(PREFERENCES_STORAGE_KEY, JSON.stringify(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function Centre({ notifications, slot }: { notifications: NotificationsData | null; slot: SaveSlotData | null }): JSX.Element {
  const runner = useActionRunner();
  return <NotificationCenter notifications={notifications} slot={slot} runner={runner} />;
}

function renderCentre(options: { storage?: PreferenceStorage | null } = {}) {
  const gateway = fakeGateway();
  const player = createRecordingCuePlayer();
  const storage = options.storage === undefined ? memoryStorage() : options.storage;
  const tree = (notifications: NotificationsData | null, slot: SaveSlotData | null = null) => (
    <LocalizationProvider>
      <ContentTextProvider gateway={gateway}>
        <PreferencesProvider storage={storage}>
          <AudioCuesProvider gateway={gateway} player={player}>
            <Centre notifications={notifications} slot={slot} />
          </AudioCuesProvider>
        </PreferencesProvider>
      </ContentTextProvider>
    </LocalizationProvider>
  );
  const result = render(tree(null));
  return {
    player,
    user: userEvent.setup(),
    show: async (notifications: NotificationsData | null, slot: SaveSlotData | null = null) => {
      await act(async () => {
        result.rerender(tree(notifications, slot));
        await Promise.resolve();
      });
    },
  };
}

function failedSlot(): SaveSlotData {
  return {
    slotId: 'slot-1',
    saveCount: 1,
    resumable: null,
    status: {
      state: 'failed', backend: 'memory', slotId: 'slot-1', lastSavedRevision: 1, lastSavedAtRealMs: 0,
      lastSaveKind: 'auto', pendingWrites: 0,
      storage: { persistent: null, usageBytes: null, quotaBytes: null, lowSpace: false },
      error: { code: 'QUOTA_ERROR', messageKey: 'error.saveWrite.quota' },
    },
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('notifications', () => {
  it('shows only what is new, not the history a reopened campaign already had [FUNC-19.7, TECH-12.4]', async () => {
    const centre = renderCentre();
    await centre.show(history(BOUNTY(1, 1)));
    expect(screen.queryByText(/Bounty paid/)).toBeNull();

    await centre.show(history(BOUNTY(1, 1), LOCK(2, 2)));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Danger');
    expect(alert).toHaveTextContent('Pirate Scout has locked your ship.');
    expect(alert.querySelector('[data-severity-icon="danger"]')).not.toBeNull();
    expect(screen.queryByText(/Bounty paid/)).toBeNull();
  });

  it('groups a repeat into one notification with a count and the summed amount [FUNC-19.7, TECH-12.4]', async () => {
    const centre = renderCentre();
    await centre.show(history());
    await centre.show(history(BOUNTY(1, 1)));
    await centre.show(history(BOUNTY(1, 3, 3, 12_000)));

    const toasts = screen.getAllByText(/Bounty paid/);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toHaveTextContent('Bounty paid: 12,000 ISK.');
    expect(screen.getByText('x3')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('hides a category the player turned off, but never the loss of the ship [FUNC-19.7, FUNC-20]', async () => {
    const hidden = {
      notifications: { combat: { visible: false, sound: false }, recovery: { visible: false, sound: false } },
    };
    const centre = renderCentre({ storage: memoryStorage(hidden) });
    await centre.show(history());
    await centre.show(history(LOCK(1, 1), LOST(2, 2)));

    expect(screen.queryByText(/has locked your ship/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Your Wayfarer was destroyed.');
    // Hidden is not forgotten: the event log still records it.
    await centre.user.click(screen.getByRole('button', { name: /^Event log/ }));
    const log = screen.getByRole('region', { name: 'Event log' });
    expect(within(log).getByText('Pirate Scout has locked your ship.')).toBeInTheDocument();
  });

  it('sounds the most urgent new cue at the player\'s volume, and not for a muted category [FUNC-19.7, TECH-12.3]', async () => {
    const centre = renderCentre({ storage: memoryStorage({
      audio: { enabled: true, master: 0.5, channels: { alert: 0.8, interface: 1, effects: 1 } },
      notifications: { navigation: { visible: true, sound: false } },
    }) });
    await centre.show(history());
    await centre.show(history(entry({ id: 1, sequence: 1 }), LOCK(2, 2)));

    expect(centre.player.played).toEqual([{ cueId: 'cue.alert.danger', volume: 0.4 }]);

    // A muted category is shown but silent.
    await centre.show(history(entry({ id: 1, sequence: 1 }), LOCK(2, 2), entry({ id: 3, sequence: 3 })));
    expect(centre.player.played).toHaveLength(1);
    expect(screen.getAllByText('Docked at Borrell Harbour.').length).toBeGreaterThan(0);
  });

  it('keeps a failed save on screen and sounds it once [FUNC-19.7, TECH-11.1]', async () => {
    const centre = renderCentre();
    await centre.show(history(), failedSlot());

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Saving failed/);
    expect(within(alert).queryByRole('button')).toBeNull();
    await centre.show(history(), failedSlot());
    expect(centre.player.played.filter((play) => play.cueId === 'cue.alert.danger')).toHaveLength(1);
  });

  it('filters the event log by urgency and category [FUNC-20, FUNC-19.3]', async () => {
    const centre = renderCentre();
    await centre.show(history(entry({ id: 1, sequence: 1 }), LOCK(2, 2), BOUNTY(3, 3)));
    await centre.user.click(screen.getByRole('button', { name: /^Event log/ }));
    const log = screen.getByRole('region', { name: 'Event log' });
    expect(within(log).getAllByRole('listitem')).toHaveLength(3);

    await centre.user.selectOptions(within(log).getByLabelText('Show'), 'danger');
    expect(within(log).getAllByRole('listitem')).toHaveLength(1);
    expect(within(log).getByRole('listitem')).toHaveTextContent('Pirate Scout has locked your ship.');

    await centre.user.selectOptions(within(log).getByLabelText('Show'), 'all');
    await centre.user.selectOptions(within(log).getByLabelText('About'), 'encounter');
    expect(within(log).getByRole('listitem')).toHaveTextContent('Bounty paid: 3,000 ISK.');
  });

  it('stores the settings in the browser, not the campaign, and restores the defaults [FUNC-19.7, TECH-3.1]', async () => {
    const storage = memoryStorage();
    const centre = renderCentre({ storage });
    await centre.show(history());
    await centre.user.click(screen.getByRole('button', { name: 'Alerts and sound' }));

    await centre.user.click(screen.getByRole('checkbox', { name: 'Show Combat alerts' }));
    expect(JSON.parse(storage.values.get(PREFERENCES_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 1, notifications: { combat: { visible: false, sound: true } },
    });

    await centre.user.click(screen.getByRole('button', { name: /^Restore defaults/ }));
    expect(screen.getByRole('checkbox', { name: 'Show Combat alerts' })).toBeChecked();
  });
});
