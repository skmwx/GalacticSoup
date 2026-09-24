import { useState, type JSX } from 'react';

import type { CombatData, CombatEventData, EncounterData, SiteData } from '@protocol';

import { formatSimulationDuration } from '../format/duration';
import { formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Space.module.css';
import {
  COMBAT_LOG_FILTERS,
  damageBreakdown,
  damageTotal,
  describeSubject,
  matchesFilter,
  subjectName,
  type CombatLogFilter,
} from './tactical';

/**
 * What happened, summarised (Functional Specification 19.3, 20).
 *
 * The engine already groups repeated hits and repairs, so each entry is a
 * cause rather than a line of arithmetic: who hit whom, how often, and how
 * much of the damage survived resistances, by type. It can be filtered to
 * what was taken, what was dealt, repairs or losses, and it shows the most
 * recent entries first.
 *
 * @implements FUNC-19.3, FUNC-20, TECH-10.3, MVP-AC-04
 */

export interface CombatLogProps {
  readonly combat: CombatData | null;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
}

/** How many entries the panel shows; the engine keeps its own bounded history. */
const VISIBLE_ENTRIES = 12;

export function CombatLog({ combat, site, encounter }: CombatLogProps): JSX.Element {
  const translate = useTranslate();
  const [filter, setFilter] = useState<CombatLogFilter>('all');
  const shipId = combat?.shipId ?? null;
  const events = [...(combat?.events ?? [])]
    .filter((event) => matchesFilter(event, filter, shipId))
    .reverse()
    .slice(0, VISIBLE_ENTRIES);

  return (
    <section className={styles['panel']} aria-labelledby="log-heading" data-panel="log">
      <h3 id="log-heading" className={styles['panelHeading']}>
        {translate('tactical.log.heading')}
      </h3>
      <label className={styles['field']}>
        {translate('tactical.log.filter')}
        <select
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as CombatLogFilter);
          }}
        >
          {COMBAT_LOG_FILTERS.map((option) => (
            <option key={option} value={option}>
              {translate(`tactical.log.filter.${option}`)}
            </option>
          ))}
        </select>
      </label>
      {events.length === 0 ? (
        <p className={styles['muted']}>{translate('tactical.log.none')}</p>
      ) : (
        <ol className={styles['log']}>
          {events.map((event) => (
            <LogEntry
              key={`${event.kind}:${String(event.firstAtMs)}:${eventSubject(event)}`}
              event={event}
              site={site}
              encounter={encounter}
              shipId={shipId}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function eventSubject(event: CombatEventData): string {
  return event.kind === 'damage' ? `${event.sourceId}>${event.targetId}:${event.slotKey}` : event.shipId;
}

interface LogEntryProps {
  readonly event: CombatEventData;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
  readonly shipId: string | null;
}

function LogEntry({ event, site, encounter, shipId }: LogEntryProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const name = (id: string): string => describeSubject(subjectName(id, site, encounter, shipId), translate);
  const at = formatSimulationDuration(event.lastAtMs);

  if (event.kind === 'damage') {
    const incoming = event.targetId === shipId;
    const applied = damageTotal(event.appliedDamage);
    return (
      <li data-event="damage" data-direction={incoming ? 'incoming' : 'outgoing'} className={incoming ? styles['warning'] : undefined}>
        {translate(incoming ? 'tactical.log.damageIncoming' : 'tactical.log.damage', {
          at,
          source: name(event.sourceId),
          target: name(event.targetId),
          count: event.count,
          applied: formatStat(Math.round(applied * 10) / 10, locale),
          raw: formatStat(Math.round(damageTotal(event.rawDamage) * 10) / 10, locale),
          types: damageBreakdown(event.appliedDamage)
            .map((entry) => `${translate(`damage.${entry.damageType}`)} ${formatStat(Math.round(entry.amount * 10) / 10, locale)}`)
            .join(' · '),
        })}
      </li>
    );
  }
  if (event.kind === 'repair') {
    return (
      <li data-event="repair">
        {translate('tactical.log.repair', {
          at,
          ship: name(event.shipId),
          count: event.count,
          amount: formatStat(Math.round(event.repairedHitPoints * 10) / 10, locale),
          layer: translate(`layer.${event.layer}`),
        })}
      </li>
    );
  }
  return (
    <li data-event="destruction" className={styles['strong']}>
      {translate('tactical.log.destruction', { at, ship: name(event.shipId) })}
    </li>
  );
}
