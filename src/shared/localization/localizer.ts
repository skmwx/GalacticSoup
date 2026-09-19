import { formatMessage } from './format';
import type {
  LocalizationIssueHandler,
  MessageCatalog,
  MessageKey,
  MessageParams,
} from './types';

/**
 * Resolves message keys against one locale's catalog.
 *
 * A missing key or parameter never throws: the interface stays usable and the
 * problem is reported to `onIssue`, which tests make fatal.
 */
export interface Localizer {
  readonly locale: string;
  has(key: MessageKey): boolean;
  translate(key: MessageKey, params?: MessageParams): string;
}

export interface LocalizerOptions {
  readonly locale: string;
  readonly catalog: MessageCatalog;
  readonly onIssue?: LocalizationIssueHandler;
  /**
   * Parameters a template does not use are normally legitimate: engine errors
   * carry diagnostic values that a message may choose not to show. Tests that
   * check catalog quality can opt into reporting them.
   */
  readonly reportUnusedParameters?: boolean;
}

export function createLocalizer(options: LocalizerOptions): Localizer {
  const { locale, catalog, onIssue, reportUnusedParameters = false } = options;
  const report: LocalizationIssueHandler = onIssue ?? (() => undefined);

  return {
    locale,
    has(key) {
      return Object.prototype.hasOwnProperty.call(catalog, key);
    },
    translate(key, params) {
      if (!Object.prototype.hasOwnProperty.call(catalog, key)) {
        report({ kind: 'missing-key', locale, key });
        return key;
      }

      const template = catalog[key] as string;
      const result = formatMessage(template, params, locale);

      for (const parameter of result.missingParameters) {
        report({ kind: 'missing-parameter', locale, key, parameter });
      }
      if (reportUnusedParameters) {
        for (const parameter of result.unusedParameters) {
          report({ kind: 'unused-parameter', locale, key, parameter });
        }
      }

      return result.text;
    },
  };
}
