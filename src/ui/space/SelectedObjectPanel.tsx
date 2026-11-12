import type { JSX, ReactNode } from 'react';

import type { CombatData, EncounterData, SiteObjectData } from '@protocol';

import { SubstitutedExplanation } from '../common/Explanation';
import { formatCredits, formatDistanceKm, formatSpeedKmPerSecond, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { DefenseLayers } from './DefenseLayers';
import styles from './Space.module.css';

/**
 * What is selected, and what is known about it
 * (Functional Specification 9.2, 9.3, 19.3; MVP review 02).
 *
 * Ordered by what a fight needs first: the target's shield, armour and hull;
 * its range; its speeds, which decide whether a turret can track it; what it
 * is running; and then the rest - type, attitude, role, bounty and the lock
 * time with its calculation. Locking, the orders and the list targets are
 * chosen from live in the Navigation panel, so this panel only describes.
 *
 * Every value is one the engine published. Anything it did not publish is
 * marked unknown rather than replaced with false precision.
 *
 * @implements FUNC-9.2, FUNC-9.3, FUNC-19.3, FUNC-19.6, MVP-AC-04
 */

export interface SelectedObjectPanelProps {
  readonly object: SiteObjectData | null;
  readonly combat: CombatData | null;
  readonly encounter: EncounterData | null;
}

export function SelectedObjectPanel({ object, combat, encounter }: SelectedObjectPanelProps): JSX.Element {
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
  const otherShip = object.kind === 'ship' && !object.player;
  const name = object.player ? translate('space.object.you') : translate(object.nameKey);

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
        {name}
      </p>

      {/* 1. Shield, armour and hull. */}
      {defenses !== null ? (
        <DefenseLayers
          defenses={defenses}
          label={translate('tactical.selected.resistances', { name })}
        />
      ) : !object.player ? (
        <dl className={styles['readouts']}>
          <Row label={translate('space.selected.defenses')}>{translate('space.selected.unknown')}</Row>
        </dl>
      ) : null}

      <dl className={styles['readouts']} data-selected-readouts>
        {/* 2. Range. */}
        <Row label={translate('space.selected.range')} section="range">
          {translate('space.distance', { distance: formatDistanceKm(object.rangeFromPlayerKm, locale) })}
        </Row>

        {/* 3. Speeds. */}
        <Row label={translate('space.selected.speed')} section="speeds">
          {translate('space.speed', {
            speed: formatSpeedKmPerSecond(Math.hypot(object.velocity.x, object.velocity.y), locale),
          })}
        </Row>
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

        {/* 4. What it is running. */}
        {otherShip ? (
          <Row label={translate('tactical.running')} section="running">
            {defenses === null
              ? translate('space.selected.unknown')
              : defenses.activeEffects.length === 0
                ? translate('tactical.runningNothing')
                : defenses.activeEffects.map((effect) => translate(effect.nameKey)).join(', ')}
          </Row>
        ) : null}

        {/* 5. The rest. */}
        <Row label={translate('space.selected.kind')} section="identity">
          {translate(`space.kind.${object.kind}`)}
        </Row>
        <dt>{translate('tactical.attitude')}</dt>
        <dd data-attitude-label={object.attitude}>{translate(`tactical.attitude.${object.attitude}`)}</dd>
        {npc === null ? null : (
          <>
            <Row label={translate('tactical.role')}>{translate(`role.${npc.role}`)}</Row>
            <Row label={translate('tactical.bounty')}>
              {translate('credits.amount', { credits: formatCredits(npc.bountyCredits, locale) })}
            </Row>
          </>
        )}
        {lock === null ? null : (
          <Row label={translate('tactical.lockTime')}>
            {translate('tactical.seconds', {
              seconds: formatStat(Math.round(lock.lockTimeSeconds * 100) / 100, locale),
            })}
          </Row>
        )}
      </dl>
      {lock === null ? null : (
        <SubstitutedExplanation
          trace={lock.trace}
          label={translate('tactical.locks.explain')}
          result={translate('tactical.seconds', {
            seconds: formatStat(Math.round(lock.lockTimeSeconds * 100) / 100, locale),
          })}
        />
      )}
    </section>
  );
}

function Row({
  label,
  section,
  children,
}: {
  readonly label: string;
  /** Marks the first row of each group, for the space between groups. */
  readonly section?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <>
      <dt data-readout-group={section}>{label}</dt>
      <dd data-readout-group={section}>{children}</dd>
    </>
  );
}
