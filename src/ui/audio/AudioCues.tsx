import { createContext, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';

import type { ClientGateway } from '@gateway';
import type { AudioCueData, NotificationSeverityName } from '@protocol';

import { createCuePlayer, type CuePlayer } from './cuePlayer';

/**
 * The authored cues and the player that sounds them
 * (Technical Specification 12.3-12.4).
 *
 * The cues are content, so they are asked of the engine once, like the
 * message catalogue. A test or a diagnostics build may supply its own player.
 */

export interface AudioCuesValue {
  readonly player: CuePlayer;
  readonly cues: ReadonlyMap<string, AudioCueData>;
  /** The cue that speaks for a severity when a message has none of its own. */
  cueForSeverity(severity: NotificationSeverityName): AudioCueData | null;
}

const SILENT: AudioCuesValue = {
  player: { available: false, play: () => undefined },
  cues: new Map(),
  cueForSeverity: () => null,
};

const AudioCuesContext = createContext<AudioCuesValue>(SILENT);

export interface AudioCuesProviderProps {
  readonly gateway: ClientGateway;
  readonly children: ReactNode;
  readonly player?: CuePlayer;
}

export function AudioCuesProvider({ gateway, children, player }: AudioCuesProviderProps): JSX.Element {
  const [cues, setCues] = useState<readonly AudioCueData[]>([]);
  const [defaultPlayer] = useState<CuePlayer>(() => player ?? createCuePlayer());

  useEffect(() => {
    let active = true;
    void gateway.request('audio.cues', {}).then((response) => {
      if (active && response.ok) setCues(response.data.cues);
    }).catch(() => {
      // Without the cues the interface is silent; every message is still shown.
    });
    return () => {
      active = false;
    };
  }, [gateway]);

  const value = useMemo<AudioCuesValue>(() => {
    const byId = new Map(cues.map((cue) => [cue.id, cue]));
    return {
      player: player ?? defaultPlayer,
      cues: byId,
      cueForSeverity: (severity) => cues.find((cue) => cue.defaultFor === severity) ?? null,
    };
  }, [cues, player, defaultPlayer]);

  return <AudioCuesContext.Provider value={value}>{children}</AudioCuesContext.Provider>;
}

export function useAudioCues(): AudioCuesValue {
  return useContext(AudioCuesContext);
}
