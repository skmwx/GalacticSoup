import { useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';

import { ActionIcon, actionById, useActionShortcuts, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import { DeparturePanel } from './DeparturePanel';
import { FittingPanel } from './FittingPanel';
import { HangarPanel } from './HangarPanel';
import { LossReport } from './LossReport';
import { MarketPanel } from './MarketPanel';
import { NoShipNotice } from './NoShipNotice';
import { ServicesPanel } from './ServicesPanel';
import { ShipPanel } from './ShipPanel';
import { SortieSummary } from './SortieSummary';
import styles from './Station.module.css';
import type { PlayData } from '../frame/usePlayData';

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
 * After a loss the hub leads with what the player most needs: a notice when
 * they have no ship and how to get one, then the loss report while the loss
 * is the latest outcome. Once a later sortie has resolved, the report moves
 * below the services, collapsed but still reachable (Functional Specification
 * 9.12, 20).
 *
 * @implements FUNC-10, FUNC-19.5, FUNC-9.12, MVP-AC-02, MVP-AC-08, TECH-12.1
 */

export interface StationScreenProps {
  readonly gateway: ClientGateway;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  /** The clock the engine last answered with, for countdowns such as a wreck's. */
  readonly simulationTimeMs: number;
}

type PanelId =
  | 'station.hub'
  | 'station.market'
  | 'station.hangar'
  | 'station.fitting'
  | 'station.services'
  | 'station.ship'
  | 'station.departure';

const PANELS: readonly PanelId[] = [
  'station.hub',
  'station.market',
  'station.hangar',
  'station.fitting',
  'station.services',
  'station.ship',
  'station.departure',
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
  'station.departure': null,
};

export function StationScreen({
  gateway,
  data,
  runner,
  simulationTimeMs,
}: StationScreenProps): JSX.Element {
  const translate = useTranslate();
  const [open, setOpen] = useState<PanelId>('station.hub');

  const shipless = data.assets !== null && data.assets.activeShipId === null;
  const report = data.loss?.report ?? null;
  const lastOutcome = data.encounter?.lastOutcome ?? null;
  // The loss is the latest thing that happened until a later sortie resolves.
  const lossIsRecent =
    report !== null && (lastOutcome === null || report.destroyedAtMs >= lastOutcome.resolvedAtMs);
  const openMarket = (): void => {
    setOpen('station.market');
  };

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
    const entry = data.services?.services.find((service) => service.service === required);
    return { available: entry?.available ?? false, reason: entry?.unavailableReason ?? null };
  };

  return (
    <section className={styles['station']} aria-labelledby="station-heading">
      <div>
        <h2 id="station-heading" className={styles['heading']}>
          {data.services === null
            ? translate('station.loading')
            : translate(data.services.nameKey)}
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

      {data.error === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(data.error.messageKey, data.error.params)}
        </p>
      )}
      {data.transportMessageKey === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(data.transportMessageKey)}
        </p>
      )}

      {open === 'station.hub' && shipless ? (
        <NoShipNotice data={data} runner={runner} onOpenMarket={openMarket} />
      ) : null}

      {open === 'station.hub' && report !== null && lossIsRecent ? (
        <LossReport
          report={report}
          data={data}
          runner={runner}
          simulationTimeMs={simulationTimeMs}
          recent
        />
      ) : null}

      {open === 'station.hub' ? <SortieSummary encounter={data.encounter} assets={data.assets} /> : null}

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

      {open === 'station.hub' && report !== null && !lossIsRecent ? (
        <LossReport
          report={report}
          data={data}
          runner={runner}
          simulationTimeMs={simulationTimeMs}
          recent={false}
        />
      ) : null}

      {open === 'station.market' ? (
        <MarketPanel gateway={gateway} data={data} runner={runner} />
      ) : null}
      {open === 'station.hangar' ? (
        <HangarPanel gateway={gateway} data={data} runner={runner} />
      ) : null}
      {open === 'station.fitting' ? <FittingPanel data={data} runner={runner} /> : null}
      {open === 'station.services' ? (
        <ServicesPanel gateway={gateway} data={data} runner={runner} />
      ) : null}
      {open === 'station.ship' ? <ShipPanel data={data} /> : null}
      {open === 'station.departure' ? (
        <DeparturePanel data={data} runner={runner} simulationTimeMs={simulationTimeMs} />
      ) : null}
    </section>
  );
}
