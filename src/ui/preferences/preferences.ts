import {
  NOTIFICATION_CATEGORY_NAMES,
  type NotificationCategoryName,
} from '@protocol';

import { isBindableKey, isRemappableAction, type BindingOverrides } from '../actions/bindings';

/**
 * Presentation preferences (Functional Specification 19.7, 20; Technical
 * Specification 3.1, 12.3).
 *
 * How large the interface and its text are, which contrast and motion it
 * uses, which optional confirmations it asks, which key triggers which
 * action, whether a notification category is shown or heard and how loud each
 * audio channel is are the player's, not the campaign's: they live in
 * `localStorage` and never in a snapshot, so resetting a campaign keeps them
 * and two campaigns share them.
 *
 * The stored value is untrusted. Anything missing, malformed or out of range
 * falls back to its default one field at a time, so a damaged entry costs the
 * player one setting rather than all of them. That same reading migrates an
 * older version: version 1 (Phase 18) held only sound and alert settings, so
 * its values carry over and the groups added in version 2 - display,
 * confirmations and key bindings - start at their defaults.
 *
 * @implements FUNC-19.7, FUNC-20, TECH-3.1, TECH-12.3
 */

export const PREFERENCES_VERSION = 2;
export const PREFERENCES_STORAGE_KEY = 'galactic-soup.preferences';

export const AUDIO_CHANNEL_NAMES = ['alert', 'interface', 'effects'] as const;
export type AudioChannelName = (typeof AUDIO_CHANNEL_NAMES)[number];

/** The interface and text scales offered, as multipliers of the base size. */
export const SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;

/** `system` follows the browser's `prefers-contrast`; the others override it. */
export const CONTRAST_MODES = ['system', 'standard', 'high'] as const;
export type ContrastMode = (typeof CONTRAST_MODES)[number];

/** `system` follows the browser's `prefers-reduced-motion`; the others override it. */
export const MOTION_MODES = ['system', 'full', 'reduced'] as const;
export type MotionMode = (typeof MOTION_MODES)[number];

/**
 * Confirmations the player may switch off. Confirming a price before any
 * purchase, sale or station service, and deleting the campaign, are always
 * asked and are therefore not listed (Functional Specification 10, 11.2, 19.5).
 */
export const CONFIRMATION_NAMES = ['undockWithWarnings'] as const;
export type ConfirmationName = (typeof CONFIRMATION_NAMES)[number];

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

export interface DisplayPreferences {
  /** Multiplies spacing, controls and icons; one of `SCALE_STEPS`. */
  readonly uiScale: number;
  /** Multiplies text, independently of `uiScale`; one of `SCALE_STEPS`. */
  readonly textScale: number;
  readonly contrast: ContrastMode;
  readonly motion: MotionMode;
}

export interface Preferences {
  readonly version: number;
  readonly display: DisplayPreferences;
  /** True asks the confirmation before the action. */
  readonly confirmations: Readonly<Record<ConfirmationName, boolean>>;
  /** Only the keys the player changed; the registry supplies the rest. */
  readonly bindings: BindingOverrides;
  readonly audio: AudioPreferences;
  readonly notifications: Readonly<Record<NotificationCategoryName, CategoryPreference>>;
}

export const DEFAULT_DISPLAY: DisplayPreferences = {
  uiScale: 1,
  textScale: 1,
  contrast: 'system',
  motion: 'system',
};

export const DEFAULT_CONFIRMATIONS: Readonly<Record<ConfirmationName, boolean>> = {
  undockWithWarnings: true,
};

export const DEFAULT_PREFERENCES: Preferences = {
  version: PREFERENCES_VERSION,
  display: DEFAULT_DISPLAY,
  confirmations: DEFAULT_CONFIRMATIONS,
  bindings: {},
  audio: {
    enabled: true,
    master: 0.6,
    channels: { alert: 1, interface: 0.7, effects: 0.7 },
  },
  notifications: Object.fromEntries(
    NOTIFICATION_CATEGORY_NAMES.map((category) => [category, { visible: true, sound: true }]),
  ) as Record<NotificationCategoryName, CategoryPreference>,
};

/**
 * Reads a stored value of any version field by field, defaulting whatever
 * does not validate.
 */
export function parsePreferences(value: unknown): Preferences {
  const stored = record(value) ? value : {};
  const display = record(stored['display']) ? stored['display'] : {};
  const confirmations = record(stored['confirmations']) ? stored['confirmations'] : {};
  const bindings = record(stored['bindings']) ? stored['bindings'] : {};
  const audio = record(stored['audio']) ? stored['audio'] : {};
  const channels = record(audio['channels']) ? audio['channels'] : {};
  const categories = record(stored['notifications']) ? stored['notifications'] : {};
  return {
    version: PREFERENCES_VERSION,
    display: {
      uiScale: scale(display['uiScale'], DEFAULT_DISPLAY.uiScale),
      textScale: scale(display['textScale'], DEFAULT_DISPLAY.textScale),
      contrast: oneOf(display['contrast'], CONTRAST_MODES, DEFAULT_DISPLAY.contrast),
      motion: oneOf(display['motion'], MOTION_MODES, DEFAULT_DISPLAY.motion),
    },
    confirmations: Object.fromEntries(CONFIRMATION_NAMES.map((name) => [
      name,
      bool(confirmations[name], DEFAULT_CONFIRMATIONS[name]),
    ])) as Record<ConfirmationName, boolean>,
    bindings: Object.fromEntries(
      Object.entries(bindings)
        .filter(([actionId, key]) =>
          isRemappableAction(actionId) && (key === null || (typeof key === 'string' && isBindableKey(key))))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ) as Record<string, string | null>,
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
function scale(value: unknown, fallback: number): number {
  return typeof value === 'number' && (SCALE_STEPS as readonly number[]).includes(value) ? value : fallback;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
