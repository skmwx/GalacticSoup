import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import {
  createEngineHost,
  DEFAULT_SLOT_ID,
  ENGINE_VERSION,
  SAVE_FORMAT_VERSION,
  type CampaignState,
  type ContentRepository,
} from '@engine';
import {
  EMPTY_PAYLOAD,
  PROTOCOL_VERSION,
  isCommandType,
  type CommandResultData,
  type DomainEventData,
  type EngineResponse,
  type StateHashData,
} from '@protocol';

import { STEP_MS, type ScenarioSession } from '../progression/session.ts';

/**
 * Recording a campaign as a replayable log
 * (Technical Specification 9.5, 15.1, 17).
 *
 * A recording is a scenario session that writes down everything that can
 * change the campaign: the creating command, every later command with the
 * answer it got, and every elapsed delta. Queries are not written down,
 * because a query changes nothing (Technical Specification 7.3). What is left
 * is the input of deterministic replay: a content identity, a starting
 * campaign, ordered deltas and commands, and the canonical state hash at
 * checkpoints along the way.
 *
 * A refused command is part of the log. It must be refused again on replay,
 * for the same reason, and must leave the campaign as it found it
 * (Technical Specification 7.2).
 *
 * The log is plain JSON with no TypeScript-only values, so a second engine can
 * be held to the same corpus.
 */

export const REPLAY_LOG_FORMAT = 'galactic-soup/replay';
export const REPLAY_LOG_VERSION = 1;

/** Elapsed real time, delivered `times` times in a row. */
export interface ReplayAdvanceStep {
  readonly advanceMs: number;
  readonly times: number;
}

export interface ReplayCommandStep {
  readonly type: string;
  readonly payload: unknown;
  /** The message key the engine refused the command with, or `null` when it accepted it. */
  readonly error: string | null;
}

export type ReplayLogStep = ReplayAdvanceStep | ReplayCommandStep;

export interface ReplayLogCheckpoint {
  /** How many entries of `steps` had run when the hash was read. */
  readonly afterStep: number;
  /** The golden state captured here, or `null` for a plain checkpoint. */
  readonly label: string | null;
  readonly revision: number;
  readonly simulationTimeMs: number;
  readonly stateHash: string;
}

export interface ReplayLogCampaign {
  readonly displayName: string;
  readonly seed: string;
  readonly createdAtRealMs: number;
}

export interface ReplayLog {
  readonly format: typeof REPLAY_LOG_FORMAT;
  readonly formatVersion: number;
  readonly protocolVersion: number;
  readonly engineVersion: string;
  readonly saveFormatVersion: number;
  readonly contentVersion: string;
  readonly contentHash: string;
  readonly campaign: ReplayLogCampaign;
  readonly steps: readonly ReplayLogStep[];
  readonly checkpoints: readonly ReplayLogCheckpoint[];
}

export interface Recording extends ScenarioSession {
  /** Reads a projection without running the watcher. */
  query<TData>(type: string, payload?: unknown): Promise<TData>;
  /** Records the canonical state hash at this point of the log. */
  mark(label: string | null): Promise<ReplayLogCheckpoint>;
  /** The authoritative state at this point, read back from a snapshot. */
  snapshot(): Promise<CampaignState>;
  /** Closes the log with a final checkpoint. */
  finish(): Promise<ReplayLog>;
}

export interface RecordingOptions {
  readonly campaign: ReplayLogCampaign;
  readonly content: ContentRepository;
  /** Runs after every recorded command and every elapsed delta. */
  readonly afterStep?: (recording: Recording) => Promise<void>;
  /** A plain checkpoint is recorded after this many commands and deltas. */
  readonly checkpointEvery?: number;
}

/** The wall-clock stamp snapshots taken while recording carry; no rule reads it. */
const RECORDING_SAVED_AT_REAL_MS = 1_700_000_000_000;

export async function startRecording(options: RecordingOptions): Promise<Recording> {
  const { content, campaign } = options;
  const checkpointEvery = options.checkpointEvery ?? 2_000;
  const saves: MemorySaveStore = createMemorySaveStore();
  const host = createEngineHost({ content, saves });

  const steps: ReplayLogStep[] = [];
  const checkpoints: ReplayLogCheckpoint[] = [];
  const events: DomainEventData[] = [];
  let ordinal = 0;
  let simulationTimeMs = 0;
  let sinceCheckpoint = 0;
  /** A checkpoint closes the run of deltas before it, so it names a whole number of steps. */
  let runOpen = false;
  let watching = false;

  const send = async <TData>(type: string, payload: unknown): Promise<EngineResponse<TData>> => {
    ordinal += 1;
    return (await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `recording-${String(ordinal)}`,
      type,
      payload,
    })) as EngineResponse<TData>;
  };

  const query = async <TData>(type: string, payload: unknown = EMPTY_PAYLOAD): Promise<TData> => {
    const response = await send<TData>(type, payload);
    if (!response.ok) throw new Error(`${type} failed: ${response.error.messageKey}`);
    return response.data;
  };

  const recordAdvance = (advanceMs: number): void => {
    const last = steps[steps.length - 1];
    if (runOpen && last !== undefined && 'advanceMs' in last && last.advanceMs === advanceMs) {
      steps[steps.length - 1] = { advanceMs, times: last.times + 1 };
    } else {
      steps.push({ advanceMs, times: 1 });
    }
    runOpen = true;
  };

  const mark = async (label: string | null): Promise<ReplayLogCheckpoint> => {
    const hash = await query<StateHashData>('diagnostics.stateHash');
    if (hash.stateHash === null) throw new Error('A checkpoint needs an open campaign.');
    const checkpoint: ReplayLogCheckpoint = {
      afterStep: steps.length,
      label,
      revision: hash.revision,
      simulationTimeMs: hash.simulationTimeMs,
      stateHash: hash.stateHash,
    };
    checkpoints.push(checkpoint);
    runOpen = false;
    sinceCheckpoint = 0;
    return checkpoint;
  };

  /** What a recorded step is followed by: the caller's watcher, then a periodic checkpoint. */
  const stepped = async (): Promise<void> => {
    sinceCheckpoint += 1;
    if (options.afterStep !== undefined && !watching) {
      watching = true;
      try {
        await options.afterStep(recording);
      } finally {
        watching = false;
      }
    }
    if (sinceCheckpoint >= checkpointEvery) await mark(null);
  };

  const ask = async <TData>(type: string, payload: unknown = EMPTY_PAYLOAD): Promise<EngineResponse<TData>> => {
    const response = await send<TData>(type, payload);
    if (!isCommandType(type)) return response;
    if (type === 'time.advance' && response.ok) {
      recordAdvance((payload as { elapsedRealMs: number }).elapsedRealMs);
      simulationTimeMs = (response.data as unknown as CommandResultData).simulationTimeMs;
    } else {
      steps.push({
        type,
        payload: structuredClone(payload),
        error: response.ok ? null : response.error.messageKey,
      });
      runOpen = false;
    }
    await stepped();
    return response;
  };

  const recording: Recording = {
    ask,
    query,
    async data<TData>(type: string, payload?: unknown): Promise<TData> {
      const response = await ask<TData>(type, payload ?? EMPTY_PAYLOAD);
      if (!response.ok) throw new Error(`${type} failed: ${response.error.messageKey}`);
      return response.data;
    },
    async advance(elapsedRealMs: number): Promise<readonly DomainEventData[]> {
      const produced: DomainEventData[] = [];
      for (let elapsed = 0; elapsed < elapsedRealMs; elapsed += STEP_MS) {
        const response = await ask<CommandResultData>('time.advance', {
          elapsedRealMs: Math.min(STEP_MS, elapsedRealMs - elapsed),
        });
        if (!response.ok) throw new Error(`time.advance failed: ${response.error.messageKey}`);
        produced.push(...response.data.events);
      }
      events.push(...produced);
      return produced;
    },
    mark,
    async snapshot(): Promise<CampaignState> {
      const before = (await saves.readManifest(DEFAULT_SLOT_ID))?.saves[0]?.sequence ?? 0;
      await query('campaign.save', { kind: 'auto', savedAtRealMs: RECORDING_SAVED_AT_REAL_MS });
      // The write is queued behind the capture; the store is in memory, so it
      // lands within a few turns of the event loop.
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const newest = (await saves.readManifest(DEFAULT_SLOT_ID))?.saves[0];
        if (newest !== undefined && newest.sequence > before) {
          const stored = (await saves.readSave(DEFAULT_SLOT_ID, newest.saveId)) as { state: unknown } | null;
          if (stored !== null) return stored.state as CampaignState;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error('The recording could not read its own snapshot back.');
    },
    async finish(): Promise<ReplayLog> {
      await mark('end');
      return {
        format: REPLAY_LOG_FORMAT,
        formatVersion: REPLAY_LOG_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        engineVersion: ENGINE_VERSION,
        saveFormatVersion: SAVE_FORMAT_VERSION,
        contentVersion: content.contentVersion,
        contentHash: content.contentHash,
        campaign,
        steps: [...steps],
        checkpoints: [...checkpoints],
      };
    },
    get simulationTimeMs(): number {
      return simulationTimeMs;
    },
    get events(): readonly DomainEventData[] {
      return events;
    },
    saves,
  };

  // The creating command is the log's header rather than one of its steps.
  await query('campaign.create', campaign);
  return recording;
}
