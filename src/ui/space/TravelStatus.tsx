import type { JSX } from 'react';

import type { LocationData, TravelStatusData } from '@protocol';

import { formatSimulationDuration } from '../format/duration';
import { useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * What the ship is doing between sites (Functional Specification 7.3, 7.4,
 * 19.1).
 *
 * Warp and docking are engine state machines with phases and a scheduled
 * completion. The remaining time is the difference between the completion the
 * projection carries and the clock the engine last answered with, so the
 * countdown stops the moment the simulation is paused.
 *
 * @implements FUNC-7.3, FUNC-7.4, FUNC-19.1, MVP-AC-03
 */

export interface TravelStatusProps {
  readonly travel: TravelStatusData | null;
  readonly location: LocationData | null;
  readonly simulationTimeMs: number;
}

export function TravelStatus({
  travel,
  location,
  simulationTimeMs,
}: TravelStatusProps): JSX.Element | null {
  const translate = useTranslate();
  if (travel === null) {
    return location?.kind === 'warp' ? (
      <p className={styles['travel']} role="status">
        {translate('space.travel.inWarp')}
      </p>
    ) : null;
  }

  const remainingMs =
    travel.completionAtMs === null ? null : Math.max(0, travel.completionAtMs - simulationTimeMs);
  const phase = translate(`space.travel.${travel.kind}.${travel.phase}`);

  return (
    <p className={styles['travel']} role="status" data-travel={`${travel.kind}.${travel.phase}`}>
      {remainingMs === null
        ? phase
        : translate('space.travel.remaining', {
            phase,
            remaining: formatSimulationDuration(remainingMs),
          })}
    </p>
  );
}
