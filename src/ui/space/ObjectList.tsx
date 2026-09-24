import type { JSX } from 'react';

import type { CombatData, SiteObjectData } from '@protocol';

import { formatDistanceKm } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * Everything in the site, as a list (Functional Specification 19.2, 20;
 * Technical Specification 12.3).
 *
 * The drawing answers "where", and this answers "what". It is also how
 * selection works without a pointer: each entry is an ordinary button, so the
 * site is reachable by tab and space alone, and the current selection is
 * announced rather than implied by a highlight. Hostility, locks and ships
 * that have locked the player are written out, because the drawing's shapes
 * are not available to everyone. The context-menu key, Shift+F10 or a
 * secondary click on an entry opens the same contextual commands a secondary
 * click in the view does.
 *
 * @implements FUNC-19.2, FUNC-20, FUNC-9.1, TECH-12.3
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

  return (
    <section className={styles['panel']} aria-labelledby="objects-heading">
      <h3 id="objects-heading" className={styles['panelHeading']}>
        {translate('space.objects.heading')}
      </h3>
      {objects.length === 0 ? (
        <p className={styles['muted']}>{translate('space.objects.none')}</p>
      ) : (
        <ul className={styles['objectList']}>
          {objects.map((object) => {
            const lock = combat?.locks.find((entry) => entry.targetId === object.id) ?? null;
            const targetingYou = combat?.hostileLocks.some((entry) => entry.shipId === object.id) ?? false;
            const tags = [
              object.attitude === 'hostile' ? translate('tactical.attitude.hostile') : null,
              lock === null ? null : translate(`combat.lock.${lock.status}`),
              targetingYou ? translate('tactical.tag.targetingYou') : null,
            ].filter((tag): tag is string => tag !== null);
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
                    if (onContextMenu !== undefined && !object.player) {
                      event.preventDefault();
                      onSelect(object.id);
                      onContextMenu(object.id, event.currentTarget);
                    }
                  }}
                  onKeyDown={(event) => {
                    const opens =
                      event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
                    if (opens && onContextMenu !== undefined && !object.player) {
                      event.preventDefault();
                      onSelect(object.id);
                      onContextMenu(object.id, event.currentTarget);
                    }
                  }}
                >
                  <span>
                    {object.player ? translate('space.object.you') : translate(object.nameKey)}
                    <span className={styles['objectKind']}>
                      {' '}
                      {translate(`space.kind.${object.kind}`)}
                    </span>
                    {tags.length === 0 ? null : (
                      <span className={styles['tags']} data-tags>
                        {' '}
                        {tags.join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className={styles['objectRange']}>
                    {translate('space.distance', {
                      distance: formatDistanceKm(object.rangeFromPlayerKm, locale),
                    })}
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
