import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';

import type { CampaignSession, CampaignSessionState, ClientGateway } from '@gateway';

import { ShortcutNotice, ShortcutProvider, useActionRunner } from '../actions';
import { AudioCuesProvider, type CuePlayer } from '../audio';
import { GuidancePanel, guidedSurface } from '../guidance';
import { ContentTextProvider, useTranslate } from '../localization';
import { NotificationCenter } from '../notifications';
import { SpaceScreen } from '../space/SpaceScreen';
import { StationScreen, type StationPanelId } from '../station/StationScreen';
import { useStationNavigation } from '../station/useStationNavigation';
import { CampaignFrame } from './CampaignFrame';
import styles from './PlayScreen.module.css';
import { usePlayData } from './usePlayData';
import { useSimulationClock } from './useSimulationClock';

/**
 * Everything the player sees while a campaign is open
 * (Functional Specification 19.1, 19.2, 19.5).
 *
 * It composes the persistent frame, the authoritative clock and whichever of
 * the two play surfaces the ship's location calls for, and it owns the two
 * things they share: the action runner that stops a command being submitted
 * twice, and the store that re-reads the projections a command invalidated.
 *
 * Which screen is shown is not a choice this component makes. It is the
 * location the engine reported, so undocking and docking move the player
 * between surfaces only once the engine has said they did - including the
 * station a destroyed pilot is recovered at.
 *
 * It also answers the autosave triggers the clock's advances raise, which
 * the store coalesces with those its commands raise.
 *
 * Wherever the player is, notifications and contextual guidance share the
 * cockpit's context column. The guidance can open the station
 * surface its current step is carried out on, so which station surface is
 * open is held here rather than inside the station.
 *
 * Keyboard shortcuts are dispatched from here, through the player's own
 * bindings, and a key that cannot act right now says why on the notice line
 * beside the notifications (Functional Specification 20).
 *
 * The preferences it reads - audio, notification visibility, bindings,
 * display - are the one set the campaign root provides, so a change made in
 * Settings applies here immediately. Settings opens at the top of the working
 * area without unmounting the screen beneath it, so no station selection or
 * draft is lost by looking at them.
 *
 * @implements FUNC-19.1, FUNC-19.2, FUNC-19.5, FUNC-19.7, FUNC-3.2, FUNC-3.4, TECH-11.3, TECH-12.1, MVP-AC-10
 */

export interface PlayScreenProps {
  readonly gateway: ClientGateway;
  readonly session: CampaignSession;
  readonly sessionState: CampaignSessionState;
  /** Overrides the audio output, for tests and diagnostics. */
  readonly cuePlayer?: CuePlayer;
  /** The Settings panel while it is open. */
  readonly settings?: ReactNode;
  readonly settingsOpen?: boolean;
  readonly onToggleSettings?: () => void;
  /** The game-menu trigger, which focus returns to when Settings closes. */
  readonly menuTrigger?: RefObject<HTMLButtonElement | null>;
}

const NO_SETTINGS = (): void => undefined;

export function PlayScreen({
  gateway,
  session,
  sessionState,
  cuePlayer,
  settings = null,
  settingsOpen = false,
  onToggleSettings = NO_SETTINGS,
  menuTrigger,
}: PlayScreenProps): JSX.Element {
  const ownTrigger = useRef<HTMLButtonElement | null>(null);
  const translate = useTranslate();
  const runner = useActionRunner();
  const [tacticalSidebar, setTacticalSidebar] = useState<HTMLDivElement | null>(null);
  const [stationPanel, setStationPanel] = useState<StationPanelId>('station.hub');
  const campaignId = sessionState.session?.campaign?.campaignId ?? null;
  const data = usePlayData({ gateway, session, campaignId });
  // Every way of changing the station surface - the rail, the hub, the
  // guidance - leaves the fitting screen through one guard, so an open
  // fitting draft is applied, discarded or kept in view, never stranded.
  const stationNavigation = useStationNavigation({
    data,
    runner,
    panel: stationPanel,
    setPanel: setStationPanel,
  });

  // Arriving at a station always opens its hub, where the last sortie and any
  // loss are reported, whatever surface was open when the ship left.
  useEffect(() => {
    if (!data.docked) {
      setStationPanel('station.hub');
    }
  }, [data.docked]);
  const paused = sessionState.session?.time.paused ?? true;

  // An advance that reached a durable point asks for a save; it is answered
  // through the store, which folds a trigger raised mid-write into one more.
  const { requestAutosave } = data;
  const answerAutosave = useCallback(() => {
    void requestAutosave();
  }, [requestAutosave]);

  const onPlayTime = useCallback(
    (elapsedRealMs: number) => {
      session.notePlayTime(elapsedRealMs, paused);
    },
    [session, paused],
  );

  const clock = useSimulationClock({
    gateway,
    active: campaignId !== null,
    initialSimulationTimeMs: sessionState.frame?.simulationTimeMs ?? 0,
    paused,
    onInvalidations: data.applyInvalidations,
    onAutosaveRequested: answerAutosave,
    onPlayTime,
  });

  return (
    <ContentTextProvider gateway={gateway}>
      <AudioCuesProvider gateway={gateway} {...(cuePlayer === undefined ? {} : { player: cuePlayer })}>
        <ShortcutProvider>
          <div className={styles['play']} data-cockpit>
            <CampaignFrame
              session={session}
              sessionState={sessionState}
              data={data}
              runner={runner}
              simulationTimeMs={clock.simulationTimeMs}
              settingsOpen={settingsOpen}
              onToggleSettings={onToggleSettings}
              menuTrigger={menuTrigger ?? ownTrigger}
            />
            <ShortcutNotice className={styles['shortcutNotice']} />
            <aside className={styles['context']} aria-label={translate('play.context')}>
              <NotificationCenter
                notifications={data.notifications}
                slot={sessionState.slot}
                runner={runner}
              />
              <div className={styles['tacticalSlot']} ref={setTacticalSidebar} />
              <GuidancePanel
                data={data}
                runner={runner}
                onGoTo={data.docked ? (surface) => {
                  stationNavigation.request(surface as StationPanelId);
                } : null}
                openSurface={data.docked ? stationPanel : 'space'}
              />
            </aside>
            <div className={styles['activity']}>
              {settings}
              {data.location === null ? (
                <p role="status">{translate('play.loading')}</p>
              ) : data.docked ? (
                <StationScreen
                  gateway={gateway}
                  data={data}
                  runner={runner}
                  simulationTimeMs={clock.simulationTimeMs}
                  panel={stationPanel}
                  onPanelChange={stationNavigation.request}
                  guidedSurface={guidedSurface(data.onboarding)}
                />
              ) : (
                <SpaceScreen
                  data={data}
                  runner={runner}
                  gateway={gateway}
                  simulationTimeMs={clock.simulationTimeMs}
                  paused={paused}
                  sidebar={tacticalSidebar}
                />
              )}
              {data.docked ? stationNavigation.dialog : null}
            </div>
          </div>
        </ShortcutProvider>
      </AudioCuesProvider>
    </ContentTextProvider>
  );
}
