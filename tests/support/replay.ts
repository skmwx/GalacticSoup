import type { ClientGateway } from '@gateway';
import {
  EMPTY_PAYLOAD,
  isSuccess,
  type RequestPayload,
  type RequestType,
  type StateHashData,
} from '@protocol';

/**
 * The deterministic replay harness (Technical Specification 9.5).
 *
 * A script is a starting campaign plus an ordered list of elapsed simulation
 * deltas and commands. Running the same script against the same content must
 * reach the same serialised authoritative state, whichever transport carried
 * the requests. The harness records the canonical state hash at each
 * checkpoint so a divergence is located at the step that caused it rather
 * than at the end.
 *
 * A run starts either by creating a campaign from a seed or by resuming the
 * snapshot the store already holds, so a script split across a close and a
 * reopen can be compared with the same script run straight through.
 */

export type ReplayStep =
  | { readonly advanceMs: number }
  | { readonly command: string; readonly payload: Record<string, unknown> };

export interface ReplayScript {
  readonly displayName: string;
  readonly seed: string;
  readonly createdAtRealMs: number;
  readonly steps: readonly ReplayStep[];
  /** Record a hash after every this many steps. Defaults to every step. */
  readonly checkpointEvery?: number;
  /**
   * Where the run starts: a new campaign from the seed, or the snapshot the
   * gateway's store already holds (Technical Specification 11.4).
   */
  readonly start?: 'create' | 'resume';
}

export interface ReplayCheckpoint {
  readonly step: number;
  readonly revision: number;
  readonly simulationTimeMs: number;
  readonly stateHash: string;
}

export interface ReplayRun {
  readonly checkpoints: readonly ReplayCheckpoint[];
  readonly finalHash: string;
  readonly finalRevision: number;
  readonly simulationTimeMs: number;
}

export async function runReplay(gateway: ClientGateway, script: ReplayScript): Promise<ReplayRun> {
  const checkpointEvery = script.checkpointEvery ?? 1;
  const checkpoints: ReplayCheckpoint[] = [];
  let sequence = 0;

  const send = async (type: string, payload: Record<string, unknown>): Promise<void> => {
    sequence += 1;
    const response = await gateway.request(
      type as RequestType,
      payload as RequestPayload<RequestType>,
      { timeoutMs: 10_000 },
    );
    if (!isSuccess(response)) {
      throw new Error(
        `Replay step ${String(sequence)} (${type}) failed: ${JSON.stringify(response.error)}`,
      );
    }
  };

  if (script.start === 'resume') {
    await send('campaign.resume', {});
  } else {
    await send('campaign.create', {
      displayName: script.displayName,
      seed: script.seed,
      createdAtRealMs: script.createdAtRealMs,
    });
  }

  for (const [index, step] of script.steps.entries()) {
    if ('advanceMs' in step) {
      await send('time.advance', { elapsedRealMs: step.advanceMs });
    } else {
      await send(step.command, step.payload);
    }

    if ((index + 1) % checkpointEvery === 0) {
      checkpoints.push({ step: index + 1, ...(await readHash(gateway)) });
    }
  }

  const final = await readHash(gateway);
  return {
    checkpoints,
    finalHash: final.stateHash,
    finalRevision: final.revision,
    simulationTimeMs: final.simulationTimeMs,
  };
}

async function readHash(
  gateway: ClientGateway,
): Promise<{ revision: number; simulationTimeMs: number; stateHash: string }> {
  const response = await gateway.request('diagnostics.stateHash', EMPTY_PAYLOAD, {
    timeoutMs: 10_000,
  });
  if (!isSuccess(response)) {
    throw new Error(`The replay harness could not read a state hash: ${JSON.stringify(response)}`);
  }
  const data = response.data as StateHashData;
  if (data.stateHash === null) {
    throw new Error('The replay harness read a state hash with no campaign open.');
  }
  return {
    revision: data.revision,
    simulationTimeMs: data.simulationTimeMs,
    stateHash: data.stateHash,
  };
}
