/**
 * React views, SVG renderers, input and accessibility
 * (Technical Specification 4.3, 12).
 */
export { AppShell } from './shell/AppShell';
export type { AppShellProps } from './shell/AppShell';
export { CompatibilityFailure } from './shell/CompatibilityFailure';
export type { CompatibilityFailureProps } from './shell/CompatibilityFailure';
export { useEngineStatus } from './shell/useEngineStatus';
export type { EngineStatus } from './shell/useEngineStatus';
export {
  catalogFor,
  CATALOGS,
  DEFAULT_LOCALE,
  LocalizationProvider,
  useLocalizer,
  useTranslate,
} from './localization';
export type { LocalizationProviderProps } from './localization';
export { GLOBAL_STYLES_HREF } from './styles/globalStyles';
