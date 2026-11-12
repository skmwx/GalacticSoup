import type { JSX } from 'react';

import type { CombatData, HostileLockData, LockData, SiteObjectData } from '@protocol';

import { useTooltip } from '../common/Tooltip';
import { formatDistanceKm, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * Everything in the site, as the list targets are chosen from
 * (Functional Specification 9.2, 19.2, 20; Technical Specification 12.3).
 *
 * The drawing answers "where", and this answers "what": everything in the
 * site except the player's own ship, which keeps its marker on the radar and
 * its status in the ship rail. It sits in the Navigation panel's local view,
 * beside the orders it is the target of (MVP review 02). It is also how
 * selection works without a pointer: each entry is an ordinary button, so the
 * site is reachable by tab and space alone, and the current selection is
 * announced rather than implied by a highlight.
 *
 * Each entry carries two marks. The player's own lock is drawn as the radar
 * draws it, four corner brackets - solid when locked, dashed with the time
 * left while locking - and says so in words. A ship that has locked the player
 * carries a crosshair aimed at the player, in the danger colour and with its
 * state in words for assistive technology, so the radar's lines are not the
 * only way to see who is targeting the ship. The context-menu key, Shift+F10
 * or a secondary click on an entry opens the same contextual commands a
 * secondary click in the view does.
 *
 * @implements FUNC-19.2, FUNC-20, FUNC-9.1, FUNC-9.2, TECH-12.3
 */

export interface ObjectListProps {
  readonly objects: readonly SiteObjectData[];
  readonly combat: CombatData | null;
  readonly selectedId: string | null;
  onSelect(objectId: string): void;
  /** Opens the contextual commands of one object, anchored to its entry. */
  onContextMenu?(objectId: string, anchor: Element): void;
}

export function ObjectList({
  objects,
  combat,
  selectedId,
  onSelect,
  onContextMenu,
}: ObjectListProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  // The player's own ship is drawn on the radar and described in the ship
  // rail; listing it among what is in the site only adds a row to skip.
  const others = objects.filter((object) => !object.player);

  return (
    <section className={styles['targets']} aria-labelledby="objects-heading">
      <h4 id="objects-heading" className={styles['panelHeading']}>
        {translate('space.objects.heading')}
      </h4>
      {others.length === 0 ? (
        <p className={styles['muted']}>{translate('space.objects.none')}</p>
      ) : (
        <ul className={styles['objectList']}>
          {others.map((object) => {
            const lock = combat?.locks.find((entry) => entry.targetId === object.id) ?? null;
            const hostileLock = combat?.hostileLocks.find((entry) => entry.shipId === object.id) ?? null;
            return (
              <li key={object.id}>
                <button
                  type="button"
                  className={styles['objectButton']}
                  aria-pressed={object.id === selectedId}
                  data-object-entry={object.id}
                  data-kind={object.kind}
                  data-attitude={object.attitude}
                  onClick={() => {
                    onSelect(object.id);
                  }}
                  onContextMenu={(event) => {
                    if (onContextMenu !== undefined) {
                      event.preventDefault();
                      onSelect(object.id);
                      onContextMenu(object.id, event.currentTarget);
                    }
                  }}
                  onKeyDown={(event) => {
                    const opens =
                      event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
                    if (opens && onContextMenu !== undefined) {
                      event.preventDefault();
                      onSelect(object.id);
                      onContextMenu(object.id, event.currentTarget);
                    }
                  }}
                >
                  <span className={styles['targetName']}>
                    {translate(object.nameKey)}
                    <span className={styles['objectKind']}>
                      {' '}
                      {translate(`space.kind.${object.kind}`)}
                    </span>
                    {object.attitude === 'hostile' ? (
                      <span className={styles['tags']} data-tags>
                        {' '}
                        {translate('tactical.attitude.hostile')}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles['targetMarks']}>
                    {hostileLock === null ? null : <TargetingYouMark lock={hostileLock} />}
                    {lock === null ? null : <LockMark lock={lock} locale={locale} />}
                    <span className={styles['objectRange']}>
                      {translate('space.distance', {
                        distance: formatDistanceKm(object.rangeFromPlayerKm, locale),
                      })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The player's own lock on an entry: corner brackets and its state in words. */
function LockMark({ lock, locale }: { readonly lock: LockData; readonly locale: string }): JSX.Element {
  const translate = useTranslate();
  const locking = lock.status !== 'locked';
  const outOfRange = lock.outOfRangeSinceMs !== null;
  const tooltip = useTooltip({
    heading: outOfRange ? translate('tactical.locks.outOfRange') : null,
  });
  return (
    <span
      {...tooltip.anchorProps}
      className={styles['lockMark']}
      data-lock={lock.targetId}
      data-lock-status={lock.status}
      data-out-of-range={outOfRange ? 'true' : 'false'}
    >
      <svg className={styles['markIcon']} viewBox="0 0 16 16" aria-hidden="true" data-dashed={locking}>
        <path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" />
      </svg>
      {locking
        ? translate('tactical.locks.remaining', {
            seconds: formatStat(Math.round((lock.remainingSeconds ?? 0) * 10) / 10, locale),
          })
        : translate('combat.lock.locked')}
      {outOfRange ? <span className={styles['warning']}>{' !'}</span> : null}
      {tooltip.element}
    </span>
  );
}

/** A ship that has locked, or is locking, the player: a crosshair aimed at the player. */
function TargetingYouMark({ lock }: { readonly lock: HostileLockData }): JSX.Element {
  const translate = useTranslate();
  const label = translate(`tactical.targetingYou.${lock.status}`);
  const tooltip = useTooltip({ heading: label });
  return (
    <span
      {...tooltip.anchorProps}
      className={styles['targetingYouMark']}
      data-targeting-you={lock.status}
    >
      <svg className={styles['markIcon']} viewBox="0 0 16 16" aria-hidden="true" data-dashed={lock.status !== 'locked'}>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 0v5M8 11v5M0 8h5M11 8h5" />
      </svg>
      <span className={styles['visuallyHidden']}>{label}</span>
      {tooltip.element}
    </span>
  );
}
