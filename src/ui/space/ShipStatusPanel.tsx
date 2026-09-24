import type { JSX } from 'react';

import type { CombatData, EncounterData, SiteData } from '@protocol';

import { SubstitutedExplanation } from '../common/Explanation';
import { formatPercent, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { DefenseLayers } from './DefenseLayers';
import styles from './Space.module.css';
import { describeSubject, subjectName } from './tactical';

/**
 * The player's own ship in a fight
 * (Functional Specification 9.7-9.8, 19.1, 19.7).
 *
 * Layers, capacitor and who has locked the ship are the three things that
 * decide whether to stay. Capacitor shows its recent change, what the
 * repeating modules will draw and, when that is more than recharge, how long
 * it lasts - with the calculation, because "unstable" is not an explanation.
 *
 * @implements FUNC-9.7, FUNC-9.8, FUNC-19.1, FUNC-19.7, MVP-AC-04
 */

export interface ShipStatusPanelProps {
  readonly combat: CombatData | null;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
}

export function ShipStatusPanel({ combat, site, encounter }: ShipStatusPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const capacitor = combat?.capacitor ?? null;
  const shipId = combat?.shipId ?? null;

  return (
    <section className={styles['panel']} aria-labelledby="status-heading" data-panel="status">
      <h3 id="status-heading" className={styles['panelHeading']}>
        {translate('tactical.status.heading')}
      </h3>

      {combat?.defenses === null || combat === null ? (
        <p className={styles['muted']}>{translate('tactical.status.none')}</p>
      ) : (
        <DefenseLayers defenses={combat.defenses} label={translate('tactical.status.resistances')} />
      )}

      {capacitor === null ? null : (
        <div className={styles['capacitor']} data-capacitor="true">
          <p className={styles['layer']}>
            <span className={styles['layerName']}>{translate('tactical.capacitor')}</span>
            <span className={styles['layerValue']}>
              {translate('tactical.capacitorValue', {
                charge: formatStat(Math.round(capacitor.charge), locale),
                capacity: formatStat(Math.round(capacitor.capacity), locale),
                percent: formatPercent(
                  capacitor.capacity > 0 ? capacitor.charge / capacitor.capacity : 0,
                  locale,
                ),
              })}
            </span>
            <span className={styles['bar']} aria-hidden="true">
              <span
                className={styles['barFill']}
                data-layer-fill="capacitor"
                style={{
                  width: `${String(
                    capacitor.capacity > 0
                      ? Math.round((capacitor.charge / capacitor.capacity) * 1000) / 10
                      : 0,
                  )}%`,
                }}
              />
            </span>
          </p>
          <dl className={styles['readouts']}>
            <dt>{translate('tactical.capacitorRecent')}</dt>
            <dd>
              {translate('tactical.perSecond', {
                value: signed(capacitor.recentNetChangePerSecond, locale),
              })}
            </dd>
            <dt>{translate('tactical.capacitorUse')}</dt>
            <dd>
              {translate('tactical.perSecond', {
                value: formatStat(capacitor.projectedUsePerSecond, locale),
              })}
            </dd>
            <dt>{translate('tactical.capacitorRecharge')}</dt>
            <dd>
              {translate('tactical.perSecond', {
                value: formatStat(capacitor.rechargePerSecond, locale),
              })}
            </dd>
            <dt>{translate('tactical.capacitorOutlook')}</dt>
            <dd data-capacitor-outlook={capacitor.stable ? 'stable' : 'draining'}>
              {capacitor.stable || capacitor.enduranceSeconds === null
                ? translate('tactical.capacitorStable')
                : translate('tactical.capacitorEndurance', {
                    seconds: formatStat(Math.round(capacitor.enduranceSeconds * 10) / 10, locale),
                  })}
            </dd>
          </dl>
          {capacitor.stable ? null : (
            <SubstitutedExplanation
              trace={capacitor.enduranceTrace}
              label={translate('explain.show')}
              result={translate('tactical.seconds', {
                seconds: formatStat(capacitor.enduranceTrace.displayResult, locale),
              })}
            />
          )}
        </div>
      )}

      {combat === null || combat.shipId === null ? null : (
        <div data-hostile-locks={String(combat.hostileLocks.length)}>
          <p className={styles['subheadingSmall']}>{translate('tactical.targetedBy')}</p>
          {combat.hostileLocks.length === 0 ? (
            <p className={styles['muted']}>{translate('tactical.targetedByNone')}</p>
          ) : (
            <ul className={styles['plainList']}>
              {combat.hostileLocks.map((lock) => (
                <li key={lock.shipId} className={styles['warning']} data-hostile-lock={lock.status}>
                  {translate(`tactical.hostileLock.${lock.status}`, {
                    ship: describeSubject(subjectName(lock.shipId, site, encounter, shipId), translate),
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function signed(value: number, locale: string): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) {
    return formatStat(0, locale);
  }
  return `${rounded > 0 ? '+' : '−'}${formatStat(Math.abs(rounded), locale)}`;
}
