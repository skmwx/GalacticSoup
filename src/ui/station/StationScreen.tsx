import { useEffect, useId, useRef, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';

import { ActionIcon, actionById, keyLabel, useActionShortcuts, useBindings, type ActionRunner } from '../actions';
import { TooltipButton } from '../common/TooltipButton';
import { GuidedBadge, GuidedHint } from '../guidance';
import { useTranslate } from '../localization';
import { DeparturePanel } from './DeparturePanel';
import { FittingPanel } from './FittingPanel';
import { HangarPanel } from './HangarPanel';
import { LossReport } from './LossReport';
import { MarketPanel } from './MarketPanel';
import { NoShipNotice } from './NoShipNotice';
import { ServicesPanel } from './ServicesPanel';
import { ShipReadiness } from './ShipReadiness';
import { ShipPanel } from './ShipPanel';
import { SortieSummary } from './SortieSummary';
import styles from './Station.module.css';
import { STATION_PANELS, type StationPanelId } from './panels';
import { useStationNavigation } from './useStationNavigation';
import type { PlayData } from '../frame/usePlayData';

/**
 * The station hub (Functional Specification 10, 19.5).
 *
 * The left rail is the one way between the station's surfaces: each is a
 * distinct entry with its own icon and shortcut. An entry a station does not
 * offer stays visible and says why in its tooltip, so the player learns what
 * the station is rather than what is missing from the screen, without the
 * refusal reflowing the rail.
 *
 * The Overview does not repeat the rail. It carries what a returning pilot
 * acts on: any loss, the last sortie, and the priced repair, resupply and
 * insurance operations, which have no surface of their own. The old Services
 * shortcut still works and brings the player to them.
 *
 * Which surface is open is presentation state and lives here (or with the
 * caller); everything the surfaces show arrived from the engine. Leaving the
 * fitting screen with an open draft goes through `useStationNavigation`.
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
  /** The open surface, when the caller holds it; otherwise the station keeps its own. */
  readonly panel?: StationPanelId;
  readonly onPanelChange?: (panel: StationPanelId) => void;
  /** The surface the guidance's current step is carried out on, marked on its tile. */
  readonly guidedSurface?: string | null;
}

export type { StationPanelId } from './panels';

type PanelId = StationPanelId;

const PANELS: readonly PanelId[] = STATION_PANELS;

/**
 * Which station service a surface needs before it is worth opening, or `null`
 * when it needs none.
 */
const REQUIRED_SERVICE: Readonly<Record<PanelId, string | null>> = {
  'station.hub': null,
  'station.market': 'market',
  'station.hangar': null,
  'station.fitting': 'fitting',
  'station.ship': null,
  'station.departure': null,
};

export function StationScreen({
  gateway,
  data,
  runner,
  simulationTimeMs,
  panel: controlledPanel,
  onPanelChange,
  guidedSurface = null,
}: StationScreenProps): JSX.Element {
  const translate = useTranslate();
  const [ownPanel, setOwnPanel] = useState<PanelId>('station.hub');
  // Leaving the fitting screen may first ask about unapplied changes. A caller
  // that holds the open surface guards its own changes (it also hears the
  // guidance), so the station's guard is used only when it holds it itself.
  const ownNavigation = useStationNavigation({ data, runner, panel: ownPanel, setPanel: setOwnPanel });
  const open = controlledPanel ?? ownPanel;
  const setOpen = onPanelChange ?? ownNavigation.request;
  const guidedHintId = useId();

  const shipless = data.assets !== null && data.assets.activeShipId === null;
  const report = data.loss?.report ?? null;
  const lastOutcome = data.encounter?.lastOutcome ?? null;
  // The loss is the latest thing that happened until a later sortie resolves.
  const lossIsRecent =
    report !== null && (lastOutcome === null || report.destroyedAtMs >= lastOutcome.resolvedAtMs);
  const openMarket = (): void => {
    setOpen('station.market');
  };
  // The Services shortcut predates the services moving onto the Overview; it
  // now opens the Overview and puts focus on them.
  const servicesHeading = useRef<HTMLHeadingElement | null>(null);
  const [focusServices, setFocusServices] = useState(false);
  useEffect(() => {
    if (focusServices && open === 'station.hub' && servicesHeading.current !== null) {
      servicesHeading.current.focus();
      servicesHeading.current.scrollIntoView?.({ block: 'nearest' });
      setFocusServices(false);
    }
  }, [focusServices, open]);

  const bindings = useBindings();
  useActionShortcuts(
    {
      ...Object.fromEntries(
        PANELS.map((panel) => [
          panel,
          () => {
            const state = availability(panel);
            if (!state.available) {
              return state.reason ?? 'station.unavailable.service';
            }
            setOpen(panel);
            return undefined;
          },
        ]),
      ),
      'station.services': () => {
        setOpen('station.hub');
        setFocusServices(true);
        return undefined;
      },
    },
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
      {guidedSurface === null ? null : <GuidedHint id={guidedHintId} />}
      <div className={styles['rail']}>
      <nav className={styles['tabs']} aria-label={translate('station.navigation')}>
        {PANELS.map((panel) => {
          const action = actionById(panel);
          const state = availability(panel);
          const key = bindings.byAction.get(panel) ?? null;
          return (
            <TooltipButton
              key={panel}
              className={styles['tile']}
              data-action={panel}
              data-guided={guidedSurface === panel ? 'true' : undefined}
              aria-describedby={guidedSurface === panel ? guidedHintId : undefined}
              aria-current={open === panel ? 'page' : undefined}
              aria-keyshortcuts={key === null ? undefined : keyLabel(key)}
              unavailable={!state.available}
              reason={translate(state.reason ?? 'station.unavailable.service')}
              onClick={() => {
                setOpen(panel);
              }}
            >
              <span className={styles['tileHeader']}>
                <ActionIcon icon={action.icon} />
                {translate(action.labelKey)}
                {key === null ? null : (
                  <kbd className={styles['tabKey']} aria-hidden="true">{keyLabel(key)}</kbd>
                )}
              </span>
              {guidedSurface === panel && open !== panel ? <GuidedBadge /> : null}
            </TooltipButton>
          );
        })}
      </nav>
        <ShipReadiness data={data} onInspect={() => { setOpen('station.ship'); }} />
      </div>
      <div className={styles['stationContent']}>
      <div className={styles['visuallyHidden']}>
        <h2 id="station-heading" className={styles['heading']}>
          {data.services === null
            ? translate('station.loading')
            : translate(data.services.nameKey)}
        </h2>
        <p className={styles['subheading']}>{translate('station.docked')}</p>
      </div>



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
        <ServicesPanel ref={servicesHeading} gateway={gateway} data={data} runner={runner} />
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
      {open === 'station.ship' ? <ShipPanel data={data} /> : null}
      {open === 'station.departure' ? (
        <DeparturePanel data={data} runner={runner} simulationTimeMs={simulationTimeMs} />
      ) : null}
      {ownNavigation.dialog}
      </div>
    </section>
  );
}
