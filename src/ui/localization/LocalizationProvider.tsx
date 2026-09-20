import { createContext, useContext, useMemo, type JSX, type ReactNode } from 'react';

import {
  createLocalizer,
  type Localizer,
  type LocalizationIssueHandler,
  type MessageKey,
  type MessageParams,
} from '@shared';

import { catalogFor, DEFAULT_LOCALE } from './catalog';

/**
 * Makes the active localizer available to the interface
 * (Technical Specification 12.5).
 *
 * The settings travel beside the localizer so a nested provider - the one that
 * layers authored content text under the interface's own messages - can build
 * a second localizer for the same locale and the same issue handler without
 * the caller passing them twice.
 *
 * @implements TECH-12.5
 */

export const LocalizationContext = createContext<Localizer | null>(null);

export interface LocalizationSettings {
  readonly locale: string;
  readonly onIssue?: LocalizationIssueHandler;
}

export const LocalizationSettingsContext = createContext<LocalizationSettings>({
  locale: DEFAULT_LOCALE,
});

export interface LocalizationProviderProps {
  readonly children: ReactNode;
  readonly locale?: string;
  readonly onIssue?: LocalizationIssueHandler;
}

export function LocalizationProvider({
  children,
  locale = DEFAULT_LOCALE,
  onIssue,
}: LocalizationProviderProps): JSX.Element {
  const localizer = useMemo(
    () =>
      createLocalizer({
        locale,
        catalog: catalogFor(locale),
        ...(onIssue === undefined ? {} : { onIssue }),
      }),
    [locale, onIssue],
  );

  const settings = useMemo<LocalizationSettings>(
    () => ({ locale, ...(onIssue === undefined ? {} : { onIssue }) }),
    [locale, onIssue],
  );

  return (
    <LocalizationSettingsContext.Provider value={settings}>
      <LocalizationContext.Provider value={localizer}>{children}</LocalizationContext.Provider>
    </LocalizationSettingsContext.Provider>
  );
}

export function useLocalizer(): Localizer {
  const localizer = useContext(LocalizationContext);
  if (localizer === null) {
    throw new Error('useLocalizer must be used inside a LocalizationProvider.');
  }
  return localizer;
}

export function useLocalizationSettings(): LocalizationSettings {
  return useContext(LocalizationSettingsContext);
}

/** Convenience binding for the common case of resolving a single message. */
export function useTranslate(): (key: MessageKey, params?: MessageParams) => string {
  const localizer = useLocalizer();
  return useMemo(() => localizer.translate.bind(localizer), [localizer]);
}
