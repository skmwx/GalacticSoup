import { useEffect, useRef, useState } from 'react';

import { createFrameDriver, type ClientGateway } from '@gateway';
import type { CommandResultData } from '@protocol';

/**
 * Drives and reports the authoritative clock
 * (Functional Specification 3.3; Technical Specification 9.1, 12.1).
 *
 * The engine has no clock: it advances only because the main thread measures
 * real elapsed time and sends it. This starts that driver while a campaign is
 * open and republishes what the engine answered - never a clock of its own.
 *
 * Simulation time moves every quantum, so publishing each answer would render
 * the frame sixty times a second for a display that shows whole seconds. The
 * published value is therefore throttled; the engine's value is not.
 *
 * @implements FUNC-3.3, TECH-9.1, TECH-12.1
 */

export interface SimulationClock {
  readonly simulationTimeMs: number;
  readonly revision: number;
}

export interface SimulationClockOptions {
  readonly gateway: ClientGateway;
  /** False stops the driver, which stops simulation advancing. */
  readonly active: boolean;
  /** Simulation time the campaign is already at. */
  readonly initialSimulationTimeMs: number;
  /** Receives the projection topics an advance invalidated. */
  readonly onInvalidations: (topics: readonly string[]) => void;
  /** Receives unpaused real time, for the interval autosave. */
  readonly onPlayTime: (elapsedRealMs: number) => void;
  readonly paused: boolean;
  /** Milliseconds between published updates. */
  readonly publishIntervalMs?: number;
}

const DEFAULT_PUBLISH_INTERVAL_MS = 250;

export function useSimulationClock(options: SimulationClockOptions): SimulationClock {
  const {
    gateway,
    active,
    initialSimulationTimeMs,
    onInvalidations,
    onPlayTime,
    paused,
    publishIntervalMs = DEFAULT_PUBLISH_INTERVAL_MS,
  } = options;

  const [clock, setClock] = useState<SimulationClock>({
    simulationTimeMs: initialSimulationTimeMs,
    revision: 0,
  });
  const callbacks = useRef({ onInvalidations, onPlayTime, paused });
  callbacks.current = { onInvalidations, onPlayTime, paused };

  useEffect(() => {
    setClock((previous) =>
      previous.revision === 0
        ? { ...previous, simulationTimeMs: initialSimulationTimeMs }
        : previous,
    );
  }, [initialSimulationTimeMs]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let lastPublishedAt = 0;
    let publishedTimeMs = -1;

    const driver = createFrameDriver({
      gateway,
      onAdvance: (elapsedRealMs) => {
        if (!callbacks.current.paused) {
          callbacks.current.onPlayTime(elapsedRealMs);
        }
      },
      onResult: (result: CommandResultData) => {
        if (result.invalidations.length > 0) {
          callbacks.current.onInvalidations(result.invalidations);
        }
        const now = Date.now();
        if (
          result.simulationTimeMs !== publishedTimeMs &&
          now - lastPublishedAt >= publishIntervalMs
        ) {
          lastPublishedAt = now;
          publishedTimeMs = result.simulationTimeMs;
          setClock({ simulationTimeMs: result.simulationTimeMs, revision: result.revision });
        }
      },
    });

    driver.start();
    return () => {
      driver.stop();
    };
  }, [gateway, active, publishIntervalMs]);

  return clock;
}
