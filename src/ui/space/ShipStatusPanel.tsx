import type { JSX } from 'react';

import type { CombatData } from '@protocol';

import { SubstitutedExplanation } from '../common/Explanation';
import { useTooltip } from '../common/Tooltip';
import { formatPercent, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { DefenseLayers } from './DefenseLayers';
import styles from './Space.module.css';

/**
 * The player's own ship in a fight
 * (Functional Specification 9.7-9.8, 19.1, 19.7; MVP review 02).
 *
 * Layers and capacitor decide whether to stay. Under the capacitor bar sits
 * how many seconds it lasts at the current use, or that it is stable; the
 * whole sentence is in a tooltip. The details add its recent change, what the
 * repeating modules draw and the recharge, and the calculation, because
 * "unstable" is not an explanation. Who has locked the ship is shown beside
 * each target in the Navigation panel's local view, not here.
 *
 * @implements FUNC-9.7, FUNC-9.8, FUNC-19.1, FUNC-19.7, MVP-AC-04
 */

export interface ShipStatusPanelProps {
  readonly combat: CombatData | null;
}

export function ShipStatusPanel({ combat }: ShipStatusPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const capacitor = combat?.capacitor ?? null;

  return (
    <section className={styles['panel']} aria-labelledby="status-heading" data-panel="status">
      <h3 id="status-heading" className={styles['panelHeading']}>
        {translate('tactical.status.heading')}
      </h3>

      {combat?.defenses === null || combat === null ? (
        <p className={styles['muted']}>{translate('tactical.status.none')}</p>
      ) : (
        <div data-readout="defenses"><DefenseLayers defenses={combat.defenses} label={translate('tactical.status.resistances')} /></div>
      )}

      {capacitor === null ? null : (
        <div className={styles['capacitor']} data-capacitor="true" data-readout="capacitor">
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
          <CapacitorOutlook
            stable={capacitor.stable || capacitor.enduranceSeconds === null}
            seconds={capacitor.enduranceSeconds}
          />
          <details className={styles['disclosure']}>
            <summary>{translate('cockpit.capacitorDetails')}</summary>
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
          </dl>
          </details>
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

    </section>
  );
}

/**
 * How long the capacitor lasts, under its bar: the seconds alone, or Stable,
 * with the whole sentence in a tooltip and for assistive technology.
 */
function CapacitorOutlook({ stable, seconds }: { readonly stable: boolean; readonly seconds: number | null }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const rounded = formatStat(Math.round((seconds ?? 0) * 10) / 10, locale);
  const tooltip = useTooltip({
    description: stable
      ? translate('tactical.capacitorStable')
      : translate('tactical.capacitorEndurance', { seconds: rounded }),
  });
  return (
    <p
      {...tooltip.anchorProps}
      className={styles['capacitorOutlook']}
      data-capacitor-outlook={stable ? 'stable' : 'draining'}
      tabIndex={0}
    >
      <span aria-hidden="true">
        {stable ? translate('tactical.capacitorStableShort') : translate('tactical.seconds', { seconds: rounded })}
      </span>
      {tooltip.element}
    </p>
  );
}

function signed(value: number, locale: string): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) {
    return formatStat(0, locale);
  }
  return `${rounded > 0 ? '+' : '−'}${formatStat(Math.abs(rounded), locale)}`;
}
