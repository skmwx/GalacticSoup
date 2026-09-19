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
 * @implements TECH-12.5
 */

const LocalizationContext = createContext<Localizer | null>(null);

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

  return (
    <LocalizationContext.Provider value={localizer}>{children}</LocalizationContext.Provider>
  );
}

export function useLocalizer(): Localizer {
  const localizer = useContext(LocalizationContext);
  if (localizer === null) {
    throw new Error('useLocalizer must be used inside a LocalizationProvider.');
  }
  return localizer;
}

/** Convenience binding for the common case of resolving a single message. */
export function useTranslate(): (key: MessageKey, params?: MessageParams) => string {
  const localizer = useLocalizer();
  return useMemo(() => localizer.translate.bind(localizer), [localizer]);
}
