import { useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';

import { ActionIcon, actionById, useActionShortcuts, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import { FittingPanel } from './FittingPanel';
import { HangarPanel } from './HangarPanel';
import { MarketPanel } from './MarketPanel';
import { ServicesPanel } from './ServicesPanel';
import { ShipPanel } from './ShipPanel';
import styles from './Station.module.css';
import type { StationData } from './useStationData';

/**
 * The station hub (Functional Specification 10, 19.5).
 *
 * The services are spatially and visually distinct tiles, each with its own
 * icon and its own explanation, rather than rows of one universal table. A
 * tile a station does not offer stays visible and says why, so the player
 * learns what the station is rather than what is missing from the screen.
 *
 * Which surface is open is presentation state and lives here; everything the
 * surfaces show arrived from the engine.
 *
 * @implements FUNC-10, FUNC-19.5, MVP-AC-02, TECH-12.1
 */

export interface StationScreenProps {
  readonly gateway: ClientGateway;
  readonly station: StationData;
  readonly runner: ActionRunner;
}

type PanelId =
  | 'station.hub'
  | 'station.market'
  | 'station.hangar'
  | 'station.fitting'
  | 'station.services'
  | 'station.ship';

const PANELS: readonly PanelId[] = [
  'station.hub',
  'station.market',
  'station.hangar',
  'station.fitting',
  'station.services',
  'station.ship',
];

/**
 * Which station service a surface needs before it is worth opening, or `null`
 * when it needs none. The services surface needs no single one: it offers
 * three, and each says for itself whether this station provides it.
 */
const REQUIRED_SERVICE: Readonly<Record<PanelId, string | null>> = {
  'station.hub': null,
  'station.market': 'market',
  'station.hangar': null,
  'station.fitting': 'fitting',
  'station.services': null,
  'station.ship': null,
};

export function StationScreen({ gateway, station, runner }: StationScreenProps): JSX.Element {
  const translate = useTranslate();
  const [open, setOpen] = useState<PanelId>('station.hub');

  useActionShortcuts(
    Object.fromEntries(
      PANELS.map((panel) => [
        panel,
        () => {
          setOpen(panel);
        },
      ]),
    ),
  );

  const availability = (panel: PanelId): { available: boolean; reason: string | null } => {
    const required = REQUIRED_SERVICE[panel];
    if (required === null) {
      return { available: true, reason: null };
    }
    const entry = station.services?.services.find((service) => service.service === required);
    return { available: entry?.available ?? false, reason: entry?.unavailableReason ?? null };
  };

  return (
    <section className={styles['station']} aria-labelledby="station-heading">
      <div>
        <h2 id="station-heading" className={styles['heading']}>
          {station.services === null
            ? translate('station.loading')
            : translate(station.services.nameKey)}
        </h2>
        <p className={styles['subheading']}>{translate('station.docked')}</p>
      </div>

      <nav className={styles['tabs']} aria-label={translate('station.navigation')}>
        {PANELS.map((panel) => {
          const action = actionById(panel);
          const state = availability(panel);
          return (
            <button
              key={panel}
              type="button"
              className={styles['tile']}
              data-action={panel}
              aria-current={open === panel ? 'page' : undefined}
              disabled={!state.available}
              onClick={() => {
                setOpen(panel);
              }}
            >
              <span className={styles['tileHeader']}>
                <ActionIcon icon={action.icon} />
                {translate(action.labelKey)}
              </span>
            </button>
          );
        })}
      </nav>

      {station.error === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(station.error.messageKey, station.error.params)}
        </p>
      )}
      {station.transportMessageKey === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(station.transportMessageKey)}
        </p>
      )}

      {open === 'station.hub' ? (
        <div className={styles['tiles']}>
          {PANELS.filter((panel) => panel !== 'station.hub').map((panel) => {
            const action = actionById(panel);
            const state = availability(panel);
            return (
              <button
                key={panel}
                type="button"
                className={styles['tile']}
                disabled={!state.available}
                onClick={() => {
                  setOpen(panel);
                }}
              >
                <span className={styles['tileHeader']}>
                  <ActionIcon icon={action.icon} />
                  {translate(action.labelKey)}
                </span>
                <span className={styles['tileDetail']}>
                  {state.available
                    ? action.descriptionKey === null
                      ? ''
                      : translate(action.descriptionKey)
                    : translate(state.reason ?? 'station.unavailable.service')}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {open === 'station.market' ? (
        <MarketPanel gateway={gateway} station={station} runner={runner} />
      ) : null}
      {open === 'station.hangar' ? (
        <HangarPanel gateway={gateway} station={station} runner={runner} />
      ) : null}
      {open === 'station.fitting' ? <FittingPanel station={station} runner={runner} /> : null}
      {open === 'station.services' ? (
        <ServicesPanel gateway={gateway} station={station} runner={runner} />
      ) : null}
      {open === 'station.ship' ? <ShipPanel station={station} /> : null}
    </section>
  );
}
