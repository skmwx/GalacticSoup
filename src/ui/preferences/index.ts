/**
 * Presentation preferences kept outside campaign state
 * (Technical Specification 3.1, 12.3).
 */
export {
  AUDIO_CHANNEL_NAMES,
  browserStorage,
  DEFAULT_PREFERENCES,
  loadPreferences,
  parsePreferences,
  PREFERENCES_STORAGE_KEY,
  PREFERENCES_VERSION,
  savePreferences,
} from './preferences';
export type {
  AudioChannelName,
  AudioPreferences,
  CategoryPreference,
  PreferenceStorage,
  Preferences,
} from './preferences';
export { PreferencesProvider, usePreferences } from './PreferencesProvider';
export type { PreferencesProviderProps, PreferencesValue } from './PreferencesProvider';
