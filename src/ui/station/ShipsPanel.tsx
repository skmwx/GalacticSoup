import type { JSX } from 'react';

import type { OwnedShipData, ShipFigureData, ShipsListData } from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { StatusMark } from '../common/StatusMark';
import {
  formatCredits,
  formatDistanceKm,
  formatQuantity,
  formatSpeedKmPerSecond,
  formatStat,
  formatVolume,
} from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { Figure } from './Figure';
import { ShipPanel } from './ShipPanel';
import { shipLabels } from './shipLabels';
import styles from './Station.module.css';
import type { PlayData } from '../frame/usePlayData';

/**
 * The player's ships (Functional Specification 6.3, 19.5-19.6; FeatureSpec02
 * 4.2, 9).
 *
 * Every owned ship is listed with which one is active, where it is, its
 * condition, insurance and whether its fit lets it undock. A ship docked here
 * can be made the active one or opened on the fitting screen; one elsewhere
 * says why it cannot. The engine answers whether each switch is possible -
 * while a fitting change is open, for instance, no switch is - and the
 * interface only shows that answer.
 *
 * A bare hull is described as such: it is a hull, not a ready-to-fight
 * upgrade, and the list says what remains to be done. The ships docked here
 * are then compared figure by figure, the better value of each row marked in
 * words as well as weight, and the active ship's full readout follows.
 *
 * @implements FUNC-6.3, FUNC-19.5, FUNC-19.6, V02-AC-03
 */

export interface ShipsPanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  /** Opens the fitting screen on one ship. */
  readonly onFit: (shipId: string) => void;
}

export function ShipsPanel({ data, runner, onFit }: ShipsPanelProps): JSX.Element {
  const translate = useTranslate();
  const list = data.ships;

  return (
    <div className={styles['detail']}>
      <section className={styles['panel']} aria-labelledby="ships-heading">
        <h3 id="ships-heading" className={styles['panelHeading']}>
          {translate('ships.heading')}
        </h3>
        {list === null ? (
          <p className={styles['muted']}>{translate('ships.loading')}</p>
        ) : list.ships.length === 0 ? (
          <p className={styles['muted']} data-no-ships>{translate('ships.none')}</p>
        ) : (
          <ShipList list={list} data={data} runner={runner} onFit={onFit} />
        )}
        {list === null ? null : <ShipComparison list={list} />}
      </section>
      <ShipPanel data={data} />
    </div>
  );
}

function ShipList({
  list,
  data,
  runner,
  onFit,
}: {
  readonly list: ShipsListData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly onFit: (shipId: string) => void;
}): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const labels = shipLabels(list.ships, translate);

  return (
    <ul className={styles['shipList']} aria-labelledby="ships-heading">
      {list.ships.map((ship) => {
        const label = labels.get(ship.id) ?? translate(ship.nameKey);
        const fitReason = !ship.local
          ? 'error.ruleViolation.shipNotLocal'
          : list.draftShipId !== null && list.draftShipId !== ship.id
            ? 'error.ruleViolation.fittingDraftOpen'
            : null;
        return (
          <li
            key={ship.id}
            className={styles['shipEntry']}
            data-ship={ship.id}
            data-active={ship.active ? 'true' : undefined}
            aria-label={label}
          >
            <p className={styles['dialogSubject']}>
              {label}
              {ship.active ? (
                <span className={styles['activeTag']} data-active-tag>
                  {' '}
                  <StatusMark kind="ok" />
                  {translate('ships.active')}
                </span>
              ) : null}
              {ship.recoveryGrant ? (
                <span className={styles['grant']}> {translate('recovery.grant')}</span>
              ) : null}
            </p>
            <p className={styles['muted']}>
              {translate('ships.classLine', {
                hullClass: translate(`ships.class.${ship.hullClass}`),
                sizes: ship.moduleSizes.map((size) => translate(`ships.size.${size}`)).join(', '),
              })}
              {' · '}
              {translate(placeKey(ship, list))}
            </p>
            <dl className={styles['figures']}>
              <Figure
                label={translate('ships.condition')}
                value={ship.layers
                  .map((layer) => translate('ships.layerCondition', {
                    layer: translate(`layer.${layer.layer}`),
                    hitPoints: formatQuantity(Math.ceil(layer.hitPoints), locale),
                    maximum: formatQuantity(Math.round(layer.maximumHitPoints), locale),
                  }))
                  .join(' · ')}
              />
              <Figure
                label={translate('ships.fitted')}
                value={formatQuantity(ship.fittedModules, locale)}
              />
              <Figure
                label={translate('ships.hold')}
                value={translate('ships.holdUse', {
                  used: formatVolume(ship.cargoUsedCubicDecimetres, locale),
                  capacity: formatVolume(ship.cargoCapacityCubicDecimetres, locale),
                })}
              />
              <Figure
                label={translate('ship.insurance')}
                value={translate(`insurance.coverage.${ship.insuranceCoverage}`)}
              />
            </dl>
            <p className={ship.undockable ? styles['muted'] : styles['warning']} data-readiness>
              <StatusMark kind={ship.undockable ? 'ok' : 'error'} />
              {translate(ship.undockable ? 'ships.undockable' : 'ships.invalidFit')}
            </p>
            {ship.fittedModules === 0 ? (
              <p className={styles['notice']} data-bare-hull>
                {translate('ships.bareHull')}
              </p>
            ) : null}
            <div className={styles['rowActions']}>
              <ActionButton
                actionId="ship.activate"
                runner={runner}
                label={translate('ships.flyNamed', { ship: label })}
                available={ship.activation.available}
                unavailableReason={ship.activation.unavailableReason}
                onRun={async () => {
                  await data.send('ship.activate', { shipId: ship.id });
                }}
              />
              <ActionButton
                actionId="ship.fit"
                runner={runner}
                label={translate('ships.fitNamed', { ship: label })}
                available={fitReason === null}
                unavailableReason={fitReason}
                onRun={() => {
                  onFit(ship.id);
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function placeKey(ship: OwnedShipData, list: ShipsListData): string {
  if (ship.location.kind !== 'station') return 'ships.place.space';
  return list.stationId !== null && ship.location.stationId === list.stationId
    ? 'ships.place.here'
    : 'ships.place.elsewhere';
}

/**
 * The ships docked here, figure by figure (Functional Specification 19.6).
 * Shown once there are two to compare.
 */
function ShipComparison({ list }: { readonly list: ShipsListData }): JSX.Element | null {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const local = list.ships.filter((ship) => ship.local);
  if (local.length < 2) return null;
  const labels = shipLabels(list.ships, translate);
  const keys = local[0]!.figures.map((figure) => figure.key);

  return (
    <div className={styles['tableWrapper']}>
      <table className={styles['table']} data-ship-comparison>
        <caption className={styles['caption']}>{translate('ships.compareCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{translate('ship.attribute')}</th>
            {local.map((ship) => (
              <th key={ship.id} scope="col" className={styles['numeric']}>
                {labels.get(ship.id)}
                {ship.active ? ` (${translate('ships.active')})` : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const row = local.map((ship) => ship.figures.find((figure) => figure.key === key));
            const first = row[0]!;
            const values = row.map((figure) => figure?.value ?? 0);
            const best = first.better === 'higher' ? Math.max(...values) : Math.min(...values);
            const differs = values.some((value) => value !== values[0]);
            return (
              <tr key={key}>
                <th scope="row">{translate(first.labelKey)}</th>
                {row.map((figure, index) => {
                  const isBest = differs && figure !== undefined && figure.value === best;
                  return (
                    <td
                      key={local[index]!.id}
                      className={styles['numeric']}
                      data-best={isBest ? 'true' : undefined}
                    >
                      {figure === undefined ? '-' : formatFigure(figure, locale)}
                      {isBest ? <span className={styles['bestTag']}> {translate('ships.best')}</span> : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatFigure(figure: ShipFigureData, locale: string): string {
  switch (figure.key) {
    case 'maxSpeedKmPerSecond':
      return formatSpeedKmPerSecond(figure.value, locale);
    case 'maxLockRangeKm':
      return formatDistanceKm(figure.value, locale);
    case 'cargoCapacityCubicDecimetres':
      return formatVolume(figure.value, locale);
    case 'referenceValueCredits':
      return formatCredits(figure.value, locale);
    default:
      return formatStat(figure.value, locale);
  }
}
