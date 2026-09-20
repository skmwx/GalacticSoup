import { useCallback, type JSX } from 'react';

import type { CampaignSession, CampaignSessionState, ClientGateway } from '@gateway';

import { useActionRunner } from '../actions';
import { ContentTextProvider } from '../localization';
import { StationScreen } from '../station/StationScreen';
import { useStationData } from '../station/useStationData';
import { CampaignFrame } from './CampaignFrame';
import styles from './PlayScreen.module.css';
import { useSimulationClock } from './useSimulationClock';

/**
 * Everything the player sees while a campaign is open
 * (Functional Specification 19.1, 19.5).
 *
 * It composes the persistent frame, the authoritative clock and the station
 * surfaces, and it owns the two things they share: the action runner that
 * stops a command being submitted twice, and the store that re-reads the
 * projections a command invalidated.
 *
 * @implements FUNC-19.1, FUNC-19.5, TECH-12.1
 */

export interface PlayScreenProps {
  readonly gateway: ClientGateway;
  readonly session: CampaignSession;
  readonly sessionState: CampaignSessionState;
}

export function PlayScreen({ gateway, session, sessionState }: PlayScreenProps): JSX.Element {
  const runner = useActionRunner();
  const campaignId = sessionState.session?.campaign?.campaignId ?? null;
  const station = useStationData({ gateway, session, campaignId });

  const onPlayTime = useCallback(
    (elapsedRealMs: number) => {
      session.notePlayTime(elapsedRealMs, sessionState.session?.time.paused ?? true);
    },
    [session, sessionState.session?.time.paused],
  );

  const clock = useSimulationClock({
    gateway,
    active: campaignId !== null,
    initialSimulationTimeMs: sessionState.frame?.simulationTimeMs ?? 0,
    paused: sessionState.session?.time.paused ?? true,
    onInvalidations: station.applyInvalidations,
    onPlayTime,
  });

  return (
    <ContentTextProvider gateway={gateway}>
      <div className={styles['play']}>
        <CampaignFrame
          session={session}
          sessionState={sessionState}
          station={station}
          runner={runner}
          simulationTimeMs={clock.simulationTimeMs}
        />
        <StationScreen gateway={gateway} station={station} runner={runner} />
      </div>
    </ContentTextProvider>
  );
}
