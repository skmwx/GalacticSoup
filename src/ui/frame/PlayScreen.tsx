import { useCallback, type JSX } from 'react';

import type { CampaignSession, CampaignSessionState, ClientGateway } from '@gateway';

import { useActionRunner } from '../actions';
import { ContentTextProvider, useTranslate } from '../localization';
import { SpaceScreen } from '../space/SpaceScreen';
import { StationScreen } from '../station/StationScreen';
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
 * @implements FUNC-19.1, FUNC-19.2, FUNC-19.5, FUNC-3.4, TECH-11.3, TECH-12.1
 */

export interface PlayScreenProps {
  readonly gateway: ClientGateway;
  readonly session: CampaignSession;
  readonly sessionState: CampaignSessionState;
}

export function PlayScreen({ gateway, session, sessionState }: PlayScreenProps): JSX.Element {
  const translate = useTranslate();
  const runner = useActionRunner();
  const campaignId = sessionState.session?.campaign?.campaignId ?? null;
  const data = usePlayData({ gateway, session, campaignId });
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
      <div className={styles['play']}>
        <CampaignFrame
          session={session}
          sessionState={sessionState}
          data={data}
          runner={runner}
          simulationTimeMs={clock.simulationTimeMs}
        />
        {data.location === null ? (
          <p role="status">{translate('play.loading')}</p>
        ) : data.docked ? (
          <StationScreen
            gateway={gateway}
            data={data}
            runner={runner}
            simulationTimeMs={clock.simulationTimeMs}
          />
        ) : (
          <SpaceScreen
            data={data}
            runner={runner}
            gateway={gateway}
            simulationTimeMs={clock.simulationTimeMs}
            paused={paused}
          />
        )}
      </div>
    </ContentTextProvider>
  );
}
