import type { JSX } from 'react';

import type { ShipData, UndockValidityData } from '@protocol';

import { AttributeExplanation } from '../common/Explanation';
import { formatPercent, formatQuantity, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { Figure } from './Figure';
import styles from './Station.module.css';
import type { PlayData } from '../frame/usePlayData';

/**
 * The active ship (Functional Specification 8.2, 8.5, 19.6).
 *
 * Every number here is a derived statistic the engine calculated, and every
 * one of them travels with the trace that produced it, so the screen can
 * explain a value instead of asserting it. Violations and warnings are shown
 * with the constraint they break, because "you cannot undock" is not an
 * explanation on its own.
 *
 * The ship's insurance cover is shown with it, and a hull the recovery
 * service supplied says in words that it has no sale or insurance value
 * (Functional Specification 9.12). A pilot with no ship is told how to get
 * one rather than left waiting for a ship to load.
 *
 * @implements FUNC-8.2, FUNC-8.5, FUNC-19.6, FUNC-9.12, MVP-AC-04, MVP-AC-08
 */

export interface ShipPanelProps {
  readonly data: PlayData;
}

export function ShipPanel({ data }: ShipPanelProps): JSX.Element {
  const translate = useTranslate();
  const ship = data.ship;
  const shipless = data.assets !== null && data.assets.activeShipId === null;

  return (
    <section className={styles['panel']} aria-labelledby="ship-heading">
      <h3 id="ship-heading" className={styles['panelHeading']}>
        {translate('ship.heading')}
      </h3>

      {shipless ? (
        <p className={styles['warning']} data-no-ship>
          {translate('ship.noShip')}
        </p>
      ) : ship === null ? (
        <p className={styles['muted']}>{translate('ship.loading')}</p>
      ) : (
        <>
          <ShipSummary ship={ship} />
          {data.undock === null ? null : <UndockStatus validity={data.undock} />}
          <ShipAttributes ship={ship} />
        </>
      )}
    </section>
  );
}

/**
 * The compact picture of a ship: identity, layered defences, capacitor,
 * weapons and the resources its fit commits. The fitting screen renders the
 * same component for the ship a draft would produce, so a preview and the real
 * thing are described identically.
 */
export function ShipSummary({ ship }: { readonly ship: ShipData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <div className={styles['detail']}>
      <div>
        <p className={styles['dialogSubject']}>
          {translate(ship.nameKey)}
          {ship.recoveryGrant ? (
            <span className={styles['grant']} data-recovery-grant-label>
              {' '}
              {translate('recovery.grant')}
            </span>
          ) : null}
        </p>
        <p className={styles['muted']}>{translate(ship.descriptionKey)}</p>
        {ship.recoveryGrant ? (
          <p className={styles['muted']} data-recovery-grant-ship>
            {translate('ship.recoveryGrant')}
          </p>
        ) : null}
      </div>

      <dl className={styles['figures']}>
        <Figure
          label={translate('ship.insurance')}
          value={translate(`insurance.coverage.${ship.insuranceCoverage}`)}
        />
        <Figure
          label={translate('ship.power')}
          value={translate('ship.resourceUse', {
            used: formatStat(ship.power.used, locale),
            available: formatStat(ship.power.available, locale),
          })}
        />
        <Figure
          label={translate('ship.processing')}
          value={translate('ship.resourceUse', {
            used: formatStat(ship.processing.used, locale),
            available: formatStat(ship.processing.available, locale),
          })}
        />
        <Figure
          label={translate('ship.capacitor')}
          value={translate('ship.capacitorDetail', {
            charge: formatStat(ship.capacitor.charge, locale),
            capacity: formatStat(ship.capacitor.capacity, locale),
            drain: formatStat(ship.capacitor.drainPerSecond, locale),
          })}
        />
        <Figure
          label={translate('ship.capacitorStability')}
          value={
            ship.capacitor.stable
              ? translate('ship.capacitorStable')
              : ship.capacitor.enduranceSeconds === null
                ? translate('ship.capacitorUnstable')
                : translate('ship.capacitorEndurance', {
                    seconds: formatStat(ship.capacitor.enduranceSeconds, locale),
                  })
          }
        />
      </dl>

      <div className={styles['tableWrapper']}>
        <table className={styles['table']}>
          <caption className={styles['caption']}>{translate('ship.layersCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{translate('ship.layer')}</th>
              <th scope="col">{translate('ship.hitPoints')}</th>
              {ship.layers[0]?.resistances.map((resistance) => (
                <th key={resistance.damageType} scope="col">
                  {translate(`damage.${resistance.damageType}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ship.layers.map((layer) => (
              <tr key={layer.layer}>
                <th scope="row">{translate(`layer.${layer.layer}`)}</th>
                <td className={styles['numeric']}>
                  {formatQuantity(layer.hitPoints, locale)} /{' '}
                  {formatQuantity(layer.maximumHitPoints, locale)}
                </td>
                {layer.resistances.map((resistance) => (
                  <td key={resistance.damageType} className={styles['numeric']}>
                    {formatPercent(resistance.value, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ship.weapons.length === 0 ? (
        <p className={styles['muted']}>{translate('ship.noWeapons')}</p>
      ) : (
        <div className={styles['tableWrapper']}>
          <table className={styles['table']}>
            <caption className={styles['caption']}>{translate('ship.weaponsCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{translate('fitting.slot')}</th>
                <th scope="col">{translate('ship.optimalRange')}</th>
                <th scope="col">{translate('ship.falloff')}</th>
                <th scope="col">{translate('ship.tracking')}</th>
                <th scope="col">{translate('ship.volley')}</th>
                <th scope="col">{translate('ship.damagePerSecond')}</th>
                <th scope="col">{translate('ship.magazine')}</th>
              </tr>
            </thead>
            <tbody>
              {ship.weapons.map((weapon) => (
                <tr key={`${weapon.slot.kind}:${String(weapon.slot.index)}`}>
                  <th scope="row">
                    {translate(`slot.${weapon.slot.kind}`)} {weapon.slot.index + 1}
                  </th>
                  <td className={styles['numeric']}>
                    {translate('ship.kilometres', {
                      value: formatStat(weapon.optimalRangeKm, locale),
                    })}
                  </td>
                  <td className={styles['numeric']}>
                    {translate('ship.kilometres', {
                      value: formatStat(weapon.falloffKm, locale),
                    })}
                  </td>
                  <td className={styles['numeric']}>
                    {formatStat(weapon.trackingRadiansPerSecond, locale)}
                  </td>
                  <td className={styles['numeric']}>{formatStat(weapon.volleyDamage, locale)}</td>
                  <td className={styles['numeric']}>
                    {formatStat(weapon.damagePerSecond, locale)}
                  </td>
                  <td className={styles['numeric']}>
                    {formatQuantity(weapon.loadedRounds, locale)} /{' '}
                    {formatQuantity(weapon.magazineSize, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ship.violations.length === 0 ? null : (
        <ul className={styles['issues']}>
          {ship.violations.map((issue) => (
            <li key={`${issue.code}:${issue.slot?.index ?? 'fit'}`} className={styles['error']}>
              {translate(issue.messageKey, issue.params)}
            </li>
          ))}
        </ul>
      )}

      {ship.warnings.length === 0 ? null : (
        <ul className={styles['issues']}>
          {ship.warnings.map((issue) => (
            <li key={`${issue.code}:${issue.slot?.index ?? 'fit'}`} className={styles['warning']}>
              {translate(issue.messageKey, issue.params)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UndockStatus({ validity }: { readonly validity: UndockValidityData }): JSX.Element {
  const translate = useTranslate();

  return (
    <p
      className={validity.undockable ? styles['ok'] : styles['error']}
      role="status"
      aria-label={translate('ship.undockStatus')}
    >
      {validity.undockable
        ? translate('ship.undockable')
        : translate(validity.unavailableReason ?? 'fitting.undock.invalidFit')}
    </p>
  );
}

function ShipAttributes({ ship }: { readonly ship: ShipData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <div className={styles['tableWrapper']}>
      <table className={styles['table']}>
        <caption className={styles['caption']}>{translate('ship.attributesCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{translate('ship.attribute')}</th>
            <th scope="col">{translate('ship.base')}</th>
            <th scope="col">{translate('ship.value')}</th>
            <th scope="col">{translate('ship.explanation')}</th>
          </tr>
        </thead>
        <tbody>
          {ship.attributes.map((attribute) => (
            <tr key={attribute.attribute}>
              <th scope="row">{translate(attribute.labelKey)}</th>
              <td className={styles['numeric']}>{formatStat(attribute.base, locale)}</td>
              <td className={styles['numeric']}>{formatStat(attribute.value, locale)}</td>
              <td>
                <AttributeExplanation
                  steps={attribute.steps}
                  base={attribute.base}
                  value={attribute.value}
                  clamped={attribute.clamped}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
