/**
 * Localization for the interface layer (Technical Specification 12.5).
 */
export { catalogFor, CATALOGS, DEFAULT_LOCALE } from './catalog';
export {
  LocalizationProvider,
  useLocalizationSettings,
  useLocalizer,
  useTranslate,
} from './LocalizationProvider';
export type { LocalizationProviderProps, LocalizationSettings } from './LocalizationProvider';
export { ContentTextProvider } from './ContentTextProvider';
export type { ContentTextProviderProps } from './ContentTextProvider';
