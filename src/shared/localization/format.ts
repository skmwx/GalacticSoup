import type { MessageParams, MessageParamValue } from './types';

/**
 * Named-parameter substitution for message templates.
 *
 * `{name}` is replaced by the matching parameter. `{{` and `}}` are literal
 * braces. Numbers are formatted for the supplied locale; the caller keeps the
 * unrounded engine value and decides the presentation form before calling.
 *
 * @implements TECH-12.5
 */

const TOKEN_PATTERN = /\{\{|\}\}|\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export interface FormatResult {
  readonly text: string;
  /** Placeholders that had no matching parameter, in order of appearance. */
  readonly missingParameters: readonly string[];
  /** Parameters that the template never used, sorted by name. */
  readonly unusedParameters: readonly string[];
}

export function formatMessage(
  template: string,
  params: MessageParams = {},
  locale = 'en',
): FormatResult {
  const missingParameters: string[] = [];
  const used = new Set<string>();

  const text = template.replace(TOKEN_PATTERN, (match, name?: string) => {
    if (name === undefined) {
      return match === '{{' ? '{' : '}';
    }
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      if (!missingParameters.includes(name)) {
        missingParameters.push(name);
      }
      return match;
    }
    used.add(name);
    return formatValue(params[name] as MessageParamValue, locale);
  });

  const unusedParameters = Object.keys(params)
    .filter((name) => !used.has(name))
    .sort();

  return { text, missingParameters, unusedParameters };
}

function formatValue(value: MessageParamValue, locale: string): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Intl.NumberFormat(locale).format(value) : String(value);
  }
  return String(value);
}
