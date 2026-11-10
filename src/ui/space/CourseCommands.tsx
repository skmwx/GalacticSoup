import type { JSX } from 'react';

import type { SiteData } from '@protocol';

import { ActionButton, commandAvailability, type ActionRunner } from '../actions';
import { formatDistanceKm } from '../format/numbers';
import type { PlayData } from '../frame/usePlayData';
import { useLocalizer, useTranslate } from '../localization';
import type { Point } from './camera';
import styles from './Space.module.css';

/**
 * What the radar's point menu offers for a point in empty space
 * (Functional Specification 7.1, 19.2; Technical Specification 12.3).
 *
 * The point is the world position the menu was opened on, fixed at that
 * moment, so following the ship or panning while the menu is open cannot move
 * the destination. It is announced, because a keyboard user opens the menu on
 * the view's centre and moves the point with the arrow keys rather than by
 * looking. Set course is the existing move-to-point order with the engine's
 * own availability; nothing is sent until it is activated.
 *
 * @implements FUNC-7.1, FUNC-19.2, FUNC-20, TECH-12.3
 */

export interface CourseCommandsProps {
  readonly data: PlayData;
  readonly site: SiteData;
  readonly runner: ActionRunner;
  /** The chosen point, in kilometres. */
  readonly pointKm: Point;
  /** Where the player's ship is drawn, for the distance to the point. */
  readonly shipKm: Point | null;
  /** Called after the order is sent, so the menu can close. */
  onDone(): void;
}

export function CourseCommands({
  data,
  site,
  runner,
  pointKm,
  shipKm,
  onDone,
}: CourseCommandsProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const move = commandAvailability(site.commands, 'movement.moveToPoint');
  const x = formatDistanceKm(pointKm.x, locale);
  const y = formatDistanceKm(pointKm.y, locale);

  return (
    <div className={styles['courseCommands']} data-course-commands="true">
      <p className={styles['muted']} role="status" aria-live="polite" data-course-point={`${String(pointKm.x)},${String(pointKm.y)}`}>
        {shipKm === null
          ? translate('space.course.pointNoShip', { x, y })
          : translate('space.course.point', {
              x,
              y,
              distance: translate('space.distance', {
                distance: formatDistanceKm(Math.hypot(pointKm.x - shipKm.x, pointKm.y - shipKm.y), locale),
              }),
            })}
      </p>
      <ActionButton
        actionId="movement.moveToPoint"
        runner={runner}
        variant="primary"
        available={move.available}
        unavailableReason={move.unavailableReason}
        label={translate('space.course.submit')}
        onRun={async () => {
          await data.send('movement.moveToPoint', { xKm: pointKm.x, yKm: pointKm.y });
          onDone();
        }}
      />
      <p className={styles['muted']}>{translate('space.course.nudge')}</p>
    </div>
  );
}
