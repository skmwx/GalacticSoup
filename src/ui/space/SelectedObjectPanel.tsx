import type { JSX, ReactNode } from 'react';

import type { CombatData, EncounterData, SiteObjectData } from '@protocol';

import type { ActionRunner } from '../actions';
import { formatCredits, formatDistanceKm, formatSpeedKmPerSecond, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { DefenseLayers } from './DefenseLayers';
import { ObjectCommands } from './ObjectCommands';
import styles from './Space.module.css';

/**
 * What is selected, and what is known about it
 * (Functional Specification 9.3, 19.3).
 *
 * Identity, attitude and range come first; for another ship, the relative
 * motion that decides whether a turret can track it, whether it is locked,
 * its defensive layers and the modules it is visibly running. Every value is
 * one the engine published. Anything it did not publish is marked unknown
 * rather than replaced with false precision.
 *
 * @implements FUNC-9.3, FUNC-19.3, MVP-AC-04
 */

export interface SelectedObjectPanelProps {
  readonly object: SiteObjectData | null;
  readonly combat: CombatData | null;
  readonly encounter: EncounterData | null;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly rangeKm: number;
  readonly closestKm: number;
  readonly canFire: boolean;
  readonly fireReason: string | null;
  onFire(): Promise<void>;
}

export function SelectedObjectPanel({
  object,
  combat,
  encounter,
  data,
  runner,
  rangeKm,
  closestKm,
  canFire,
  fireReason,
  onFire,
}: SelectedObjectPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  if (object === null) {
    return (
      <section className={styles['panel']} aria-labelledby="selected-heading">
        <h3 id="selected-heading" className={styles['panelHeading']}>
          {translate('space.selected.heading')}
        </h3>
        <p className={styles['muted']}>{translate('space.selected.none')}</p>
      </section>
    );
  }

  const npc = encounter?.instance?.npcs.find((candidate) => candidate.shipId === object.id) ?? null;
  const motion = combat?.motion.find((entry) => entry.targetId === object.id) ?? null;
  const lock = combat?.locks.find((entry) => entry.targetId === object.id) ?? null;
  const defenses = combat?.targetDefenses.find((entry) => entry.shipId === object.id) ?? null;
  const hostileLock = combat?.hostileLocks.find((entry) => entry.shipId === object.id) ?? null;
  const otherShip = object.kind === 'ship' && !object.player;

  return (
    <section
      className={styles['panel']}
      aria-labelledby="selected-heading"
      data-selected-object={object.id}
      data-attitude={object.attitude}
    >
      <h3 id="selected-heading" className={styles['panelHeading']}>
        {translate('space.selected.heading')}
      </h3>
      <p className={styles['objectKind']} data-selected-name>
        {object.player ? translate('space.object.you') : translate(object.nameKey)}
      </p>
      <dl className={styles['readouts']}>
        <dt>{translate('space.selected.kind')}</dt>
        <dd>{translate(`space.kind.${object.kind}`)}</dd>
        <dt>{translate('tactical.attitude')}</dt>
        <dd data-attitude-label={object.attitude}>{translate(`tactical.attitude.${object.attitude}`)}</dd>
        {npc === null ? null : (
          <>
            <dt>{translate('tactical.role')}</dt>
            <dd>{translate(`role.${npc.role}`)}</dd>
            <dt>{translate('tactical.bounty')}</dt>
            <dd>{translate('credits.amount', { credits: formatCredits(npc.bountyCredits, locale) })}</dd>
          </>
        )}
        <dt>{translate('space.selected.range')}</dt>
        <dd>
          {translate('space.distance', {
            distance: formatDistanceKm(object.rangeFromPlayerKm, locale),
          })}
        </dd>
        <dt>{translate('space.selected.speed')}</dt>
        <dd>
          {translate('space.speed', {
            speed: formatSpeedKmPerSecond(Math.hypot(object.velocity.x, object.velocity.y), locale),
          })}
        </dd>
        {motion === null ? null : (
          <>
            <Row label={translate('tactical.motion.closing')}>
              {translate('space.speed', {
                speed: formatSpeedKmPerSecond(motion.closingSpeedKmPerSecond, locale),
              })}
            </Row>
            <Row label={translate('tactical.motion.transverse')}>
              {translate('space.speed', {
                speed: formatSpeedKmPerSecond(motion.transverseVelocityKmPerSecond, locale),
              })}
            </Row>
            <Row label={translate('tactical.motion.angular')}>
              {translate('tactical.radiansPerSecond', {
                value: formatStat(motion.angularVelocityRadiansPerSecond, locale),
              })}
            </Row>
            <Row label={translate('tactical.motion.signature')}>
              {translate('tactical.metres', { value: formatStat(motion.signatureRadiusMetres, locale) })}
            </Row>
          </>
        )}
        {otherShip ? (
          <>
            <dt>{translate('tactical.lockState')}</dt>
            <dd data-lock-state={lock?.status ?? 'none'}>
              {lock === null
                ? motion !== null && !motion.withinLockRange
                  ? translate('combat.lock.outOfRange')
                  : translate('tactical.lockNone')
                : lock.status === 'locked'
                  ? translate('combat.lock.locked')
                  : translate('tactical.locks.remaining', {
                      seconds: formatStat(Math.round((lock.remainingSeconds ?? 0) * 10) / 10, locale),
                    })}
            </dd>
            <dt>{translate('tactical.targetingYou')}</dt>
            <dd data-targeting-you={hostileLock?.status ?? 'none'}>
              {hostileLock === null
                ? translate('tactical.targetingYou.no')
                : translate(`tactical.targetingYou.${hostileLock.status}`)}
            </dd>
            <dt>{translate('tactical.running')}</dt>
            <dd>
              {defenses === null
                ? translate('space.selected.unknown')
                : defenses.activeEffects.length === 0
                  ? translate('tactical.runningNothing')
                  : defenses.activeEffects.map((effect) => translate(effect.nameKey)).join(', ')}
            </dd>
          </>
        ) : null}
        {defenses === null ? (
          <>
            <dt>{translate('space.selected.defenses')}</dt>
            <dd>{translate('space.selected.unknown')}</dd>
          </>
        ) : null}
      </dl>
      {defenses === null ? null : (
        <DefenseLayers
          defenses={defenses}
          label={translate('tactical.selected.resistances', { name: translate(object.nameKey) })}
        />
      )}
      <ObjectCommands
        object={object}
        data={data}
        runner={runner}
        variant="panel"
        rangeKm={rangeKm}
        closestKm={closestKm}
        canFire={canFire}
        fireReason={fireReason}
        onFire={onFire}
      />
    </section>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
