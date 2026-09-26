import type { NotificationData, NotificationSeverityName } from '@protocol';
import type { MessageKey, MessageParams } from '@shared';

import { formatCredits, formatQuantity, formatStat } from '../format/numbers';

/**
 * Turns a semantic notification into the sentence the player reads
 * (Technical Specification 12.4, 12.5).
 *
 * The engine sends a message key and named parameters. A parameter whose name
 * ends in `Key` is itself a message key - a ship's, an item's, a site's name -
 * and is resolved first and substituted under the name without the suffix.
 * Credits, quantities and percentages are formatted for the locale here, at
 * the last step, from the unrounded values the engine sent.
 */

type Translate = (key: MessageKey, params?: MessageParams) => string;

export function notificationParams(
  entry: Pick<NotificationData, 'params'>,
  translate: Translate,
  locale: string,
): MessageParams {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(entry.params)) {
    if (name.endsWith('Key') && typeof value === 'string') {
      params[name.slice(0, -3)] = translate(value);
    } else if (typeof value === 'number') {
      params[name] = name === 'credits' ? formatCredits(value, locale)
        : name === 'quantity' || name === 'rounds' ? formatQuantity(value, locale)
          : formatStat(value, locale);
    } else {
      params[name] = String(value);
    }
  }
  return params;
}

export function notificationText(entry: NotificationData, translate: Translate, locale: string): string {
  return translate(entry.messageKey, notificationParams(entry, translate, locale));
}

/** Most urgent first; the order sound and placement both follow. */
export const SEVERITY_RANK: Readonly<Record<NotificationSeverityName, number>> = {
  danger: 3,
  warning: 2,
  opportunity: 1,
  informational: 0,
};
