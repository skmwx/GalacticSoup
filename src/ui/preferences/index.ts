/**
 * Presentation preferences kept outside campaign state
 * (Technical Specification 3.1, 12.3).
 */
export {
  AUDIO_CHANNEL_NAMES,
  browserStorage,
  CONFIRMATION_NAMES,
  CONTRAST_MODES,
  DEFAULT_CONFIRMATIONS,
  DEFAULT_DISPLAY,
  DEFAULT_PREFERENCES,
  loadPreferences,
  MOTION_MODES,
  parsePreferences,
  PREFERENCES_STORAGE_KEY,
  PREFERENCES_VERSION,
  savePreferences,
  SCALE_STEPS,
} from './preferences';
export type {
  AudioChannelName,
  AudioPreferences,
  CategoryPreference,
  ConfirmationName,
  ContrastMode,
  DisplayPreferences,
  MotionMode,
  PreferenceStorage,
  Preferences,
} from './preferences';
export { applyDisplayPreferences } from './display';
export { PreferencesProvider, usePreferences } from './PreferencesProvider';
export type { PreferencesProviderProps, PreferencesValue } from './PreferencesProvider';
export { REDUCED_MOTION_QUERY, usePrefersReducedMotion, useReducedMotion } from './useReducedMotion';
