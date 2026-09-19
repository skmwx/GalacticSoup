import type { MessageCatalog } from '@shared';

import en from './messages/en.json';

/**
 * Shipped message catalogues (Technical Specification 12.5).
 *
 * The release contains one language. Layout must still tolerate longer
 * translations, and every player-visible string is addressed by key.
 */
export const DEFAULT_LOCALE = 'en';

export const CATALOGS: Readonly<Record<string, MessageCatalog>> = {
  en: en as MessageCatalog,
};

export function catalogFor(locale: string): MessageCatalog {
  return CATALOGS[locale] ?? (CATALOGS[DEFAULT_LOCALE] as MessageCatalog);
}
