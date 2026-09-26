import { describe, expect, it } from 'vitest';

import { NOTIFICATION_CATEGORY_NAMES } from '@protocol';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  notificationParams,
  parsePreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
  type PreferenceStorage,
} from '@ui';

/**
 * Presentation preferences and notification text (Functional Specification
 * 19.7; Technical Specification 3.1, 12.3-12.5).
 */

function storage(text: string | null, failWrites = false): PreferenceStorage & { written: string | null } {
  const store = {
    written: null as string | null,
    getItem: () => text,
    setItem: (_key: string, value: string) => {
      if (failWrites) throw new Error('QuotaExceededError');
      store.written = value;
    },
  };
  return store;
}

describe('preferences', () => {
  it('defaults every category to shown and heard, with sound on [FUNC-19.7, TECH-12.3]', () => {
    expect(Object.keys(DEFAULT_PREFERENCES.notifications).sort()).toEqual([...NOTIFICATION_CATEGORY_NAMES].sort());
    expect(Object.values(DEFAULT_PREFERENCES.notifications).every((entry) => entry.visible && entry.sound)).toBe(true);
    expect(DEFAULT_PREFERENCES.audio.enabled).toBe(true);
  });

  it('keeps what validates and defaults the rest, one field at a time [TECH-3.1, TECH-14]', () => {
    const parsed = parsePreferences({
      version: 1,
      audio: { enabled: false, master: 2, channels: { alert: 0.25, interface: 'loud' } },
      notifications: { combat: { visible: false, sound: 'yes' }, pirates: { visible: false } },
    });
    expect(parsed.audio.enabled).toBe(false);
    expect(parsed.audio.master).toBe(DEFAULT_PREFERENCES.audio.master);
    expect(parsed.audio.channels).toEqual({ alert: 0.25, interface: 0.7, effects: 0.7 });
    expect(parsed.notifications.combat).toEqual({ visible: false, sound: true });
    expect(parsed.notifications).not.toHaveProperty('pirates');
  });

  it('survives missing, corrupt and refused storage [TECH-3.1]', () => {
    expect(loadPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(storage(null))).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(storage('{not json'))).toEqual(DEFAULT_PREFERENCES);
    expect(() => {
      savePreferences(storage(null, true), DEFAULT_PREFERENCES);
    }).not.toThrow();
  });

  it('round-trips through storage under its own key [TECH-3.1]', () => {
    const store = storage(null);
    const changed = {
      ...DEFAULT_PREFERENCES,
      notifications: { ...DEFAULT_PREFERENCES.notifications, station: { visible: false, sound: false } },
    };
    savePreferences(store, changed);
    expect(PREFERENCES_STORAGE_KEY).toBe('galactic-soup.preferences');
    expect(loadPreferences(storage(store.written))).toEqual(changed);
  });
});

describe('notification text', () => {
  const translate = (key: string) => (key === 'content.name.scout' ? 'Pirate Scout' : `[${key}]`);

  it('resolves name keys first and formats amounts for the locale [TECH-12.4, TECH-12.5]', () => {
    expect(notificationParams({
      params: { attackerKey: 'content.name.scout', credits: 12000, quantity: 1500, percent: 8.3, side: 'sell' },
    }, translate, 'en')).toEqual({
      attacker: 'Pirate Scout',
      credits: '12,000',
      quantity: '1,500',
      percent: '8.3',
      side: 'sell',
    });
  });
});
