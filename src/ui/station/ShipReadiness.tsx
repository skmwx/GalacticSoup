import type { JSX } from 'react';

import type { PlayData } from '../frame/usePlayData';
import { formatPercent } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Station.module.css';

/** The real ship's condition, alongside station navigation rather than above it. */
export function ShipReadiness({ data, onInspect }: {
  readonly data: PlayData;
  readonly onInspect: () => void;
}): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const ship = data.ship;
  return (
    <section className={styles['readiness']} aria-labelledby="readiness-heading">
      <h3 id="readiness-heading">{translate('cockpit.readiness')}</h3>
      {ship === null ? <p>{translate(data.assets?.activeShipId === null ? 'cockpit.noShip' : 'ship.loading')}</p> : <>
        <p className={styles['muted']}>{translate('cockpit.activeHull', { hull: translate(ship.nameKey) })}</p>
        <dl>
          {ship.layers.map((layer) => <div key={layer.layer}>
            <dt>{translate(`layer.${layer.layer}`)}</dt>
            <dd>{formatPercent(layer.maximumHitPoints > 0 ? layer.hitPoints / layer.maximumHitPoints : 0, locale)}</dd>
            <span className={styles['bar']} aria-hidden="true"><span className={styles['barFill']} style={{ width: `${Math.max(0, Math.min(100, layer.maximumHitPoints > 0 ? layer.hitPoints / layer.maximumHitPoints * 100 : 0))}%` }} /></span>
          </div>)}
          <div><dt>{translate('tactical.capacitor')}</dt><dd>{formatPercent(ship.capacitor.capacity > 0 ? ship.capacitor.charge / ship.capacitor.capacity : 0, locale)}</dd></div>
        </dl>
        {data.undock?.undockable === false ? <p className={styles['warning']}>{translate('cockpit.checkFit')}</p> : null}
        <button type="button" onClick={onInspect}>{translate('cockpit.inspectShip')}</button>
      </>}
    </section>
  );
}
