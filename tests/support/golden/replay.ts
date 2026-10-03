import type { ClientGateway } from '@gateway';
import {
  EMPTY_PAYLOAD,
  isSuccess,
  type RequestPayload,
  type RequestType,
  type StateHashData,
} from '@protocol';

import type { ReplayLog, ReplayLogCheckpoint } from './recording.ts';

/**
 * Replaying a recorded campaign (Technical Specification 9.5).
 *
 * The log's commands and deltas are sent in order through whichever gateway is
 * given, and the canonical state hash is read wherever the recording read it.
 * A command must be answered as it was when recorded: accepted where it was
 * accepted, and refused with the same message key where it was refused.
 */

export interface ReplayOptions {
  /**
   * `create` starts the log's campaign from its seed; `resume` opens the
   * snapshot the gateway's store already holds.
   */
  readonly start: 'create' | 'resume';
  /** The first entry of `steps` to run; a resumed replay starts where its snapshot was taken. */
  readonly fromStep?: number;
  /** Stop once this many entries of `steps` have run. */
  readonly untilStep?: number;
  /** Runs at each checkpoint, after its hash was read. */
  readonly onCheckpoint?: (checkpoint: ReplayLogCheckpoint) => Promise<void>;
}

const TIMEOUT = { timeoutMs: 20_000 };

/** Returns the checkpoints the replay passed, with the hashes it read there. */
export async function replayLog(
  gateway: ClientGateway,
  log: ReplayLog,
  options: ReplayOptions,
): Promise<ReplayLogCheckpoint[]> {
  const send = async (type: string, payload: unknown, expectedError: string | null): Promise<void> => {
    const response = await gateway.request(type as RequestType, payload as RequestPayload<RequestType>, TIMEOUT);
    const error = isSuccess(response) ? null : response.error.messageKey;
    if (error !== expectedError) {
      throw new Error(
        `Replay diverged at ${type} ${JSON.stringify(payload)}: answered ${String(error)}, recorded ${String(expectedError)}.`,
      );
    }
  };

  if (options.start === 'create') await send('campaign.create', log.campaign, null);
  else await send('campaign.resume', EMPTY_PAYLOAD, null);

  const fromStep = options.fromStep ?? 0;
  const untilStep = options.untilStep ?? log.steps.length;
  const passed: ReplayLogCheckpoint[] = [];

  const readCheckpoints = async (afterStep: number): Promise<void> => {
    for (const recorded of log.checkpoints) {
      if (recorded.afterStep !== afterStep) continue;
      const response = await gateway.request('diagnostics.stateHash', EMPTY_PAYLOAD, TIMEOUT);
      if (!isSuccess(response)) throw new Error('The replay could not read a state hash.');
      const hash = response.data as StateHashData;
      const checkpoint: ReplayLogCheckpoint = {
        afterStep,
        label: recorded.label,
        revision: hash.revision,
        simulationTimeMs: hash.simulationTimeMs,
        stateHash: hash.stateHash ?? '',
      };
      passed.push(checkpoint);
      await options.onCheckpoint?.(checkpoint);
    }
  };

  // A resumed replay stands on a checkpoint; a created one has none before its first step.
  await readCheckpoints(fromStep);
  for (let index = fromStep; index < untilStep; index += 1) {
    const step = log.steps[index];
    if (step === undefined) break;
    if ('advanceMs' in step) {
      for (let count = 0; count < step.times; count += 1) {
        await send('time.advance', { elapsedRealMs: step.advanceMs }, null);
      }
    } else {
      await send(step.type, step.payload, step.error);
    }
    await readCheckpoints(index + 1);
  }
  return passed;
}

/** The checkpoints a replay over `[fromStep, untilStep]` is expected to pass. */
export function recordedCheckpoints(
  log: ReplayLog,
  fromStep = 0,
  untilStep = log.steps.length,
): ReplayLogCheckpoint[] {
  return log.checkpoints.filter(
    (checkpoint) => checkpoint.afterStep >= fromStep && checkpoint.afterStep <= untilStep,
  );
}
