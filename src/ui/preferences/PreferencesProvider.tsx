import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { applyDisplayPreferences } from './display';
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
 * shows, plays or listens for, never what happens.
 *
 * The outermost provider owns the preferences and applies the display ones to
 * the document. A provider nested inside it passes the outer one through,
 * unless it is given storage of its own - which a test does to keep its
 * preferences apart - in which case it owns that set and leaves the document
 * to the outer one.
 */

export interface PreferencesValue {
  readonly preferences: Preferences;
  update(change: (current: Preferences) => Preferences): void;
  restoreDefaults(): void;
}

const FALLBACK: PreferencesValue = {
  preferences: DEFAULT_PREFERENCES,
  update: () => undefined,
  restoreDefaults: () => undefined,
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

export interface PreferencesProviderProps {
  readonly children: ReactNode;
  /** Overrides the browser's storage; `null` keeps preferences in memory only. */
  readonly storage?: PreferenceStorage | null;
}

export function PreferencesProvider({ children, storage }: PreferencesProviderProps): JSX.Element {
  const outer = useContext(PreferencesContext);
  if (outer !== null && storage === undefined) {
    return <>{children}</>;
  }
  return (
    <OwnPreferences storage={storage === undefined ? browserStorage() : storage} applyToDocument={outer === null}>
      {children}
    </OwnPreferences>
  );
}

function OwnPreferences({
  children,
  storage,
  applyToDocument,
}: {
  readonly children: ReactNode;
  readonly storage: PreferenceStorage | null;
  readonly applyToDocument: boolean;
}): JSX.Element {
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences(storage));

  const update = useCallback((change: (current: Preferences) => Preferences) => {
    setPreferences((current) => {
      const next = change(current);
      savePreferences(storage, next);
      return next;
    });
  }, [storage]);

  const restoreDefaults = useCallback(() => {
    savePreferences(storage, DEFAULT_PREFERENCES);
    setPreferences(DEFAULT_PREFERENCES);
  }, [storage]);

  // Applied before paint, so a scaled or high-contrast interface never
  // flashes at its defaults.
  const useApply = typeof document === 'undefined' ? useEffect : useLayoutEffect;
  useApply(() => {
    if (applyToDocument && typeof document !== 'undefined') {
      applyDisplayPreferences(document.documentElement, preferences.display);
    }
  }, [applyToDocument, preferences.display]);

  const value = useMemo(() => ({ preferences, update, restoreDefaults }), [preferences, update, restoreDefaults]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  return useContext(PreferencesContext) ?? FALLBACK;
}
