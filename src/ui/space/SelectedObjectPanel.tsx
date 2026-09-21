import type { JSX } from 'react';

import type { SiteObjectData } from '@protocol';

import { formatDistanceKm, formatSpeedKmPerSecond } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * What is selected, and what is known about it
 * (Functional Specification 19.3).
 *
 * The panel shows identity, kind, range and speed, which are the facts the
 * projection carries at this stage. Defensive layers, hostile effects, hit
 * chance, cycle timers and warp-disruption state arrive with the targeting and
 * damage phases; nothing here guesses at them, because unknown information is
 * marked unknown rather than replaced with false precision.
 *
 * @implements FUNC-19.3
 */

export interface SelectedObjectPanelProps {
  readonly object: SiteObjectData | null;
}

export function SelectedObjectPanel({ object }: SelectedObjectPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <section className={styles['panel']} aria-labelledby="selected-heading">
      <h3 id="selected-heading" className={styles['panelHeading']}>
        {translate('space.selected.heading')}
      </h3>
      {object === null ? (
        <p className={styles['muted']}>{translate('space.selected.none')}</p>
      ) : (
        <>
          <p className={styles['objectKind']} data-selected-name>
            {object.player ? translate('space.object.you') : translate(object.nameKey)}
          </p>
          <dl className={styles['readouts']}>
            <dt>{translate('space.selected.kind')}</dt>
            <dd>{translate(`space.kind.${object.kind}`)}</dd>
            <dt>{translate('space.selected.range')}</dt>
            <dd>
              {translate('space.distance', {
                distance: formatDistanceKm(object.rangeFromPlayerKm, locale),
              })}
            </dd>
            <dt>{translate('space.selected.speed')}</dt>
            <dd>
              {translate('space.speed', {
                speed: formatSpeedKmPerSecond(
                  Math.hypot(object.velocity.x, object.velocity.y),
                  locale,
                ),
              })}
            </dd>
            <dt>{translate('space.selected.defenses')}</dt>
            <dd>{translate('space.selected.unknown')}</dd>
          </dl>
        </>
      )}
    </section>
  );
}
