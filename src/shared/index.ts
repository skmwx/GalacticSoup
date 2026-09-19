/**
 * Dependency-free primitives shared by every layer
 * (Technical Specification 4.3).
 */
export { formatMessage } from './localization/format';
export type { FormatResult } from './localization/format';
export { createLocalizer } from './localization/localizer';
export type { Localizer, LocalizerOptions } from './localization/localizer';
export type {
  LocalizationIssue,
  LocalizationIssueHandler,
  MessageCatalog,
  MessageKey,
  MessageParams,
  MessageParamValue,
} from './localization/types';
