import type { JSX } from 'react';

import type { CombatData, EncounterData, SiteData } from '@protocol';

import { ActionButton, commandAvailability, type ActionRunner } from '../actions';
import { SubstitutedExplanation } from '../common/Explanation';
import { formatDistanceKm, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import styles from './Space.module.css';
import { describeSubject, subjectName } from './tactical';

/**
 * Locks held and locks in progress (Functional Specification 9.2, 19.1).
 *
 * A lock in progress shows how long it has left and the lock-time formula
 * with the scan resolution and signature it was computed from, so the player
 * can see why a small target takes longer. A lock whose target has left lock
 * range says so while the grace period runs. Choosing a lock selects its
 * target, which is how the weapons are pointed at it.
 *
 * @implements FUNC-9.2, FUNC-19.1, FUNC-19.6, TECH-12.3, MVP-AC-03, MVP-AC-04
 */

export interface LocksPanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly combat: CombatData | null;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
  readonly selectedId: string | null;
  onSelect(objectId: string): void;
}

export function LocksPanel({
  data,
  runner,
  combat,
  site,
  encounter,
  selectedId,
  onSelect,
}: LocksPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const locks = combat?.locks ?? [];
  const shipId = combat?.shipId ?? null;

  return (
    <section className={styles['panel']} aria-labelledby="locks-heading" data-panel="locks">
      <h3 id="locks-heading" className={styles['panelHeading']}>
        {translate('tactical.locks.heading')}
      </h3>
      {combat === null || combat.shipId === null ? null : (
        <p className={styles['muted']}>
          {translate('tactical.locks.summary', {
            held: locks.length,
            maximum: combat.maxLockedTargets,
            range: formatDistanceKm(combat.maxLockRangeKm, locale),
          })}
        </p>
      )}
      {locks.length === 0 ? (
        <p className={styles['muted']}>{translate('tactical.locks.none')}</p>
      ) : (
        <ul className={styles['plainList']}>
          {locks.map((lock) => {
            const name = describeSubject(subjectName(lock.targetId, site, encounter, shipId), translate);
            const unlock = commandAvailability(lock.commands, 'targeting.unlock');
            return (
              <li key={lock.targetId} className={styles['weaponRow']} data-lock={lock.targetId} data-lock-status={lock.status}>
                <button
                  type="button"
                  className={styles['objectButton']}
                  aria-pressed={lock.targetId === selectedId}
                  onClick={() => {
                    onSelect(lock.targetId);
                  }}
                >
                  <span>{name}</span>
                  <span className={styles['objectRange']}>
                    {lock.status === 'locked'
                      ? translate('combat.lock.locked')
                      : translate('tactical.locks.remaining', {
                          seconds: formatStat(Math.round((lock.remainingSeconds ?? 0) * 10) / 10, locale),
                        })}
                  </span>
                </button>
                {lock.outOfRangeSinceMs === null ? null : (
                  <p className={styles['warning']}>{translate('tactical.locks.outOfRange')}</p>
                )}
                <SubstitutedExplanation
                  trace={lock.trace}
                  label={translate('tactical.locks.explain')}
                  result={translate('tactical.seconds', {
                    seconds: formatStat(Math.round(lock.lockTimeSeconds * 100) / 100, locale),
                  })}
                />
                <ActionButton
                  actionId="targeting.unlock"
                  runner={runner}
                  available={unlock.available}
                  unavailableReason={unlock.unavailableReason}
                  label={translate('tactical.locks.unlock', { target: name })}
                  onRun={async () => {
                    await data.send('targeting.unlock', { targetId: lock.targetId });
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
