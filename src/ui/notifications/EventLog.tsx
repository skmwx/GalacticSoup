import { useId, useState, type JSX } from 'react';

import {
  NOTIFICATION_CATEGORY_NAMES,
  type NotificationCategoryName,
  type NotificationsData,
} from '@protocol';

import { formatSimulationDuration } from '../format/duration';
import { useTranslate } from '../localization';
import styles from './Notifications.module.css';
import { SeverityIcon } from './SeverityIcon';
import { notificationText, SEVERITY_RANK } from './text';

/**
 * The event log (Functional Specification 19.3, 20).
 *
 * A short, grouped account of what happened - the same history the
 * notifications came from - newest first and filterable by urgency and by
 * category. Repeats are one line with a count, so the log explains outcomes
 * rather than scrolling every number past the player. Hidden categories are
 * still recorded here.
 *
 * @implements FUNC-19.3, FUNC-20, FUNC-19.7
 */

type SeverityFilter = 'all' | 'warnings' | 'danger';

const MINIMUM_RANK: Readonly<Record<SeverityFilter, number>> = { all: 0, warnings: 2, danger: 3 };

export function EventLog({
  notifications,
  locale,
}: {
  readonly notifications: NotificationsData | null;
  readonly locale: string;
}): JSX.Element {
  const translate = useTranslate();
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [category, setCategory] = useState<NotificationCategoryName | 'all'>('all');
  const severityId = useId();
  const categoryId = useId();
  const entries = (notifications?.entries ?? []).filter((entry) =>
    SEVERITY_RANK[entry.severity] >= MINIMUM_RANK[severity] &&
    (category === 'all' || entry.category === category));

  return (
    <section className={styles['panel']} aria-labelledby={`${severityId}-heading`} data-event-log>
      <h3 id={`${severityId}-heading`} className={styles['heading']}>{translate('notifications.log.heading')}</h3>
      <p className={styles['muted']}>{translate('notifications.log.detail')}</p>
      <div className={styles['filters']}>
        <label htmlFor={severityId}>{translate('notifications.log.severity')}</label>
        <select
          id={severityId}
          value={severity}
          onChange={(event) => {
            setSeverity(event.target.value as SeverityFilter);
          }}
        >
          <option value="all">{translate('notifications.log.severity.all')}</option>
          <option value="warnings">{translate('notifications.log.severity.warnings')}</option>
          <option value="danger">{translate('notifications.log.severity.danger')}</option>
        </select>
        <label htmlFor={categoryId}>{translate('notifications.log.category')}</label>
        <select
          id={categoryId}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as NotificationCategoryName | 'all');
          }}
        >
          <option value="all">{translate('notifications.log.category.all')}</option>
          {NOTIFICATION_CATEGORY_NAMES.map((name) => (
            <option key={name} value={name}>{translate(`notifications.category.${name}`)}</option>
          ))}
        </select>
      </div>
      {entries.length === 0 ? (
        <p className={styles['muted']}>{translate('notifications.log.empty')}</p>
      ) : (
        <ol className={styles['log']}>
          {entries.map((entry) => (
            <li key={entry.id} className={styles[entry.severity]} data-log-entry={entry.definitionId}>
              <span className={styles['time']}>{formatSimulationDuration(entry.lastAtMs)}</span>
              <SeverityIcon severity={entry.severity} className={styles['icon']} />
              <span className={styles['level']}>{translate(`notifications.level.${entry.severity}`)}</span>
              <span className={styles['message']}>{notificationText(entry, translate, locale)}</span>
              {entry.count > 1 ? (
                <span className={styles['count']}>{translate('notifications.count', { count: entry.count })}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
