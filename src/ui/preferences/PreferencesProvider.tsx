import { createContext, useCallback, useContext, useMemo, useState, type JSX, type ReactNode } from 'react';

import {
  browserStorage,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type PreferenceStorage,
  type Preferences,
} from './preferences';

/**
 * Makes the presentation preferences available to every surface
 * (Technical Specification 12.1, 12.3).
 *
 * They are read once from local storage and written back on every change.
 * Nothing here reaches the engine: a preference changes what the interface
 * shows or plays, never what happens.
 */

export interface PreferencesValue {
  readonly preferences: Preferences;
  update(change: (current: Preferences) => Preferences): void;
  restoreDefaults(): void;
}

const PreferencesContext = createContext<PreferencesValue>({
  preferences: DEFAULT_PREFERENCES,
  update: () => undefined,
  restoreDefaults: () => undefined,
});

export interface PreferencesProviderProps {
  readonly children: ReactNode;
  /** Overrides the browser's storage; `null` keeps preferences in memory only. */
  readonly storage?: PreferenceStorage | null;
}

export function PreferencesProvider({ children, storage }: PreferencesProviderProps): JSX.Element {
  const store = storage === undefined ? browserStorage() : storage;
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences(store));

  const update = useCallback((change: (current: Preferences) => Preferences) => {
    setPreferences((current) => {
      const next = change(current);
      savePreferences(store, next);
      return next;
    });
  }, [store]);

  const restoreDefaults = useCallback(() => {
    savePreferences(store, DEFAULT_PREFERENCES);
    setPreferences(DEFAULT_PREFERENCES);
  }, [store]);

  const value = useMemo(() => ({ preferences, update, restoreDefaults }), [preferences, update, restoreDefaults]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  return useContext(PreferencesContext);
}
