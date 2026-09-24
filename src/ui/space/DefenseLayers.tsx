import type { JSX } from 'react';

import type { DefenseStateData } from '@protocol';

import { formatPercent, formatQuantity } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * Shield, armour and hull, and what resists what
 * (Functional Specification 9.7, 19.1, 19.3).
 *
 * Each layer is a labelled value first and a bar second: the bar is a picture
 * of the number beside it, hidden from assistive technology, and a layer that
 * is running out is marked with a word as well as a colour. Resistances are
 * the ones the engine derived, shown per damage type so the player can see
 * which charge a layer shrugs off.
 *
 * @implements FUNC-9.7, FUNC-19.1, FUNC-19.3, MVP-AC-04
 */

export interface DefenseLayersProps {
  readonly defenses: DefenseStateData;
  /** Names the table of resistances for assistive technology. */
  readonly label: string;
}

/** Below this share a layer is reported as low, in words as well as colour. */
const LOW_FRACTION = 0.25;

export function DefenseLayers({ defenses, label }: DefenseLayersProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const damageTypes = Object.keys(defenses.layers[0]?.resistances ?? {});

  return (
    <div className={styles['defenses']} data-defenses={defenses.shipId}>
      <ul className={styles['layers']}>
        {defenses.layers.map((layer) => {
          const low = layer.fractionRemaining < LOW_FRACTION;
          return (
            <li
              key={layer.layer}
              className={styles['layer']}
              data-layer-name={layer.layer}
              data-low={low ? 'true' : 'false'}
            >
              <span className={styles['layerName']}>{translate(`layer.${layer.layer}`)}</span>
              <span className={styles['layerValue']}>
                {translate('tactical.layerValue', {
                  current: formatQuantity(layer.currentHitPoints, locale),
                  maximum: formatQuantity(layer.maximumHitPoints, locale),
                  percent: formatPercent(layer.fractionRemaining, locale),
                })}
                {low ? ` ${translate('tactical.layerLow')}` : ''}
              </span>
              <span className={styles['bar']} aria-hidden="true">
                <span
                  className={styles['barFill']}
                  data-layer-fill={layer.layer}
                  style={{ width: `${String(Math.round(layer.fractionRemaining * 1000) / 10)}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <details className={styles['disclosure']}>
        <summary>{translate('tactical.resistances')}</summary>
        <table className={styles['resistances']} aria-label={label}>
          <thead>
            <tr>
              <th scope="col">{translate('ship.layer')}</th>
              {damageTypes.map((type) => (
                <th key={type} scope="col">
                  {translate(`damage.${type}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defenses.layers.map((layer) => (
              <tr key={layer.layer}>
                <th scope="row">{translate(`layer.${layer.layer}`)}</th>
                {damageTypes.map((type) => (
                  <td key={type}>{formatPercent(layer.resistances[type] ?? 0, locale)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
