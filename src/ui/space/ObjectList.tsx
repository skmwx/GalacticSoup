import type { JSX } from 'react';

import type { SiteObjectData } from '@protocol';

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
 * announced rather than implied by a highlight.
 *
 * @implements FUNC-19.2, FUNC-20, TECH-12.3
 */

export interface ObjectListProps {
  readonly objects: readonly SiteObjectData[];
  readonly selectedId: string | null;
  onSelect(objectId: string): void;
}

export function ObjectList({ objects, selectedId, onSelect }: ObjectListProps): JSX.Element {
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
          {objects.map((object) => (
            <li key={object.id}>
              <button
                type="button"
                className={styles['objectButton']}
                aria-pressed={object.id === selectedId}
                data-object-entry={object.id}
                data-kind={object.kind}
                onClick={() => {
                  onSelect(object.id);
                }}
              >
                <span>
                  {object.player ? translate('space.object.you') : translate(object.nameKey)}
                  <span className={styles['objectKind']}>
                    {' '}
                    {translate(`space.kind.${object.kind}`)}
                  </span>
                </span>
                <span className={styles['objectRange']}>
                  {translate('space.distance', {
                    distance: formatDistanceKm(object.rangeFromPlayerKm, locale),
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
