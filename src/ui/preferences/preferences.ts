import {
  NOTIFICATION_CATEGORY_NAMES,
  type NotificationCategoryName,
} from '@protocol';

/**
 * Presentation preferences (Functional Specification 19.7, 20; Technical
 * Specification 3.1, 12.3).
 *
 * Whether a notification category is shown or heard and how loud each audio
 * channel is are the player's, not the campaign's: they live in `localStorage`
 * and never in a snapshot, so resetting a campaign keeps them and two
 * campaigns share them.
 *
 * The stored value is untrusted. Anything missing, malformed or out of range
 * falls back to its default one field at a time, so a damaged entry costs the
 * player one setting rather than all of them. The version lets a later change
 * migrate the shape.
 *
 * @implements FUNC-19.7, FUNC-20, TECH-3.1, TECH-12.3
 */

export const PREFERENCES_VERSION = 1;
export const PREFERENCES_STORAGE_KEY = 'galactic-soup.preferences';

export const AUDIO_CHANNEL_NAMES = ['alert', 'interface', 'effects'] as const;
export type AudioChannelName = (typeof AUDIO_CHANNEL_NAMES)[number];

export interface CategoryPreference {
  /** Raised notifications of this category appear on screen. */
  readonly visible: boolean;
  /** Raised notifications of this category play their cue. */
  readonly sound: boolean;
}

export interface AudioPreferences {
  /** False silences every cue. */
  readonly enabled: boolean;
  /** 0 through 1. */
  readonly master: number;
  readonly channels: Readonly<Record<AudioChannelName, number>>;
}

export interface Preferences {
  readonly version: number;
  readonly audio: AudioPreferences;
  readonly notifications: Readonly<Record<NotificationCategoryName, CategoryPreference>>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  version: PREFERENCES_VERSION,
  audio: {
    enabled: true,
    master: 0.6,
    channels: { alert: 1, interface: 0.7, effects: 0.7 },
  },
  notifications: Object.fromEntries(
    NOTIFICATION_CATEGORY_NAMES.map((category) => [category, { visible: true, sound: true }]),
  ) as Record<NotificationCategoryName, CategoryPreference>,
};

/** Reads a stored value field by field, defaulting whatever does not validate. */
export function parsePreferences(value: unknown): Preferences {
  const stored = record(value) ? value : {};
  const audio = record(stored['audio']) ? stored['audio'] : {};
  const channels = record(audio['channels']) ? audio['channels'] : {};
  const categories = record(stored['notifications']) ? stored['notifications'] : {};
  return {
    version: PREFERENCES_VERSION,
    audio: {
      enabled: bool(audio['enabled'], DEFAULT_PREFERENCES.audio.enabled),
      master: level(audio['master'], DEFAULT_PREFERENCES.audio.master),
      channels: Object.fromEntries(AUDIO_CHANNEL_NAMES.map((channel) => [
        channel,
        level(channels[channel], DEFAULT_PREFERENCES.audio.channels[channel]),
      ])) as Record<AudioChannelName, number>,
    },
    notifications: Object.fromEntries(NOTIFICATION_CATEGORY_NAMES.map((category) => {
      const entry = record(categories[category]) ? categories[category] : {};
      const fallback = DEFAULT_PREFERENCES.notifications[category];
      return [category, {
        visible: bool(entry['visible'], fallback.visible),
        sound: bool(entry['sound'], fallback.sound),
      }];
    })) as Record<NotificationCategoryName, CategoryPreference>,
  };
}

/** The minimal storage surface, so a test can supply its own. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's storage, or `null` where it is unavailable or refused. */
export function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadPreferences(storage: PreferenceStorage | null): Preferences {
  if (storage === null) return DEFAULT_PREFERENCES;
  try {
    const text = storage.getItem(PREFERENCES_STORAGE_KEY);
    return text === null ? DEFAULT_PREFERENCES : parsePreferences(JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Stores the preferences; a full or refused store keeps them for this session only. */
export function savePreferences(storage: PreferenceStorage | null, preferences: Preferences): void {
  if (storage === null) return;
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The preferences still apply for the rest of the session.
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function level(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}
