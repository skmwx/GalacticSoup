import type { JSX } from 'react';

import type { BookmarkDestinationData, LocationData, TravelStatusData } from '@protocol';

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
 * A warp aimed at the player's own wreck says so, because it arrives beside
 * the wreck rather than at the site's centre (Functional Specification 5.4,
 * 9.12). The engine keeps the bookmark on the warp only while the wreck
 * exists; one that expired on the way is an ordinary warp to its site.
 *
 * @implements FUNC-7.3, FUNC-7.4, FUNC-19.1, FUNC-9.12, MVP-AC-03, MVP-AC-08
 */

export interface TravelStatusProps {
  readonly travel: TravelStatusData | null;
  readonly location: LocationData | null;
  readonly simulationTimeMs: number;
  /** The bookmarks the destinations projection offers, to name a bookmark warp. */
  readonly bookmarks?: readonly BookmarkDestinationData[];
}

export function TravelStatus({
  travel,
  location,
  simulationTimeMs,
  bookmarks = [],
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
  const bookmarkId = travel.kind === 'warp' ? travel.bookmarkId : null;
  const bookmark =
    bookmarkId === null ? null : (bookmarks.find((entry) => entry.bookmarkId === bookmarkId) ?? null);
  const stage = translate(`space.travel.${travel.kind}.${travel.phase}`);
  const phase =
    bookmarkId === null
      ? stage
      : bookmark === null
        ? translate('space.travel.toWreck', { phase: stage })
        : translate('space.travel.toBookmark', {
            phase: stage,
            site: translate(bookmark.siteNameKey),
          });

  return (
    <p
      className={styles['travel']}
      role="status"
      data-travel={`${travel.kind}.${travel.phase}`}
      {...(bookmarkId === null ? {} : { 'data-travel-bookmark': bookmarkId })}
    >
      {remainingMs === null
        ? phase
        : translate('space.travel.remaining', {
            phase,
            remaining: formatSimulationDuration(remainingMs),
          })}
    </p>
  );
}
