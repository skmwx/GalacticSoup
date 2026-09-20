import {
  EMPTY_PAYLOAD,
  type CommandResultData,
  type EngineError,
  type FrameData,
  type SaveKindName,
  type SaveSlotData,
  type SessionData,
} from '@protocol';
import type { MessageKey } from '@shared';

import { type ClientGateway, EngineUnavailableError, GatewayRequestError } from './clientGateway';

/**
 * The client half of the campaign session
 * (Functional Specification 3.1, 3.4; Technical Specification 11.3).
 *
 * The engine owns the campaign and its snapshots; this owns the two things the
 * engine cannot have. It supplies the entropy a new campaign's seed is made
 * of, and it supplies the wall clock a snapshot is stamped with - including
 * the monotonic play timer that asks for a periodic autosave while simulation
 * is advancing. It holds no authoritative value: everything it publishes
 * arrived from the engine.
 *
 * It is deliberately free of React so the save policy can be tested without a
 * renderer, and so a later interface surface can subscribe to the same object.
 *
 * @implements FUNC-3.4, TECH-11.3
 */

/** Real minutes of unpaused play between interval autosaves. */
export const AUTOSAVE_INTERVAL_MS = 300_000;

export interface CampaignSessionState {
  /** True until the first `campaign.session` and `campaign.saves` answer. */
  readonly loading: boolean;
  readonly session: SessionData | null;
  /** The frame as it stood at the last refresh; time moves faster than this. */
  readonly frame: FrameData | null;
  readonly slot: SaveSlotData | null;
  /** True while a create, resume, close or reset request is in flight. */
  readonly busy: boolean;
  /** The last action failure, cleared when the next action starts. */
  readonly error: EngineError | null;
  /** A transport failure, which is not an engine answer. */
  readonly transportMessageKey: MessageKey | null;
}

export interface CampaignSessionOptions {
  readonly gateway: ClientGateway;
  /** Wall clock in milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** 128 bits of hexadecimal entropy. Defaults to the platform generator. */
  readonly createSeed?: () => string;
  readonly autosaveIntervalMs?: number;
}

export interface CampaignSession {
  readonly state: CampaignSessionState;
  subscribe(listener: (state: CampaignSessionState) => void): () => void;
  /** Re-reads the session and slot projections. */
  refresh(): Promise<void>;
  create(displayName: string): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  save(kind?: SaveKindName): Promise<void>;
  /**
   * Accounts for real time that has passed, and asks for an interval autosave
   * once enough of it has elapsed while the simulation was advancing
   * (Technical Specification 11.3). Paused time never counts.
   */
  notePlayTime(elapsedRealMs: number, paused: boolean): void;
}

const INITIAL: CampaignSessionState = {
  loading: true,
  session: null,
  frame: null,
  slot: null,
  busy: false,
  error: null,
  transportMessageKey: null,
};

export function createCampaignSession(options: CampaignSessionOptions): CampaignSession {
  const { gateway } = options;
  const now = options.now ?? defaultNow;
  const createSeed = options.createSeed ?? createCampaignSeed;
  const autosaveIntervalMs = options.autosaveIntervalMs ?? AUTOSAVE_INTERVAL_MS;

  const listeners = new Set<(state: CampaignSessionState) => void>();
  let state: CampaignSessionState = INITIAL;
  let playedMs = 0;
  let savingInterval = false;

  function publish(next: Partial<CampaignSessionState>): void {
    state = { ...state, ...next };
    for (const listener of [...listeners]) {
      listener(state);
    }
  }

  async function read(): Promise<void> {
    const session = await gateway.request('campaign.session', EMPTY_PAYLOAD);
    if (!session.ok) {
      publish({ loading: false, error: session.error });
      return;
    }
    const frame = await gateway.request('campaign.frame', EMPTY_PAYLOAD);
    const slot = await gateway.request('campaign.saves', EMPTY_PAYLOAD);
    if (!slot.ok) {
      publish({ loading: false, session: session.data, error: slot.error });
      return;
    }
    publish({
      loading: false,
      session: session.data,
      frame: frame.ok ? frame.data : null,
      slot: slot.data,
    });
  }

  /**
   * Runs one player action: clears the previous failure, reports the engine's
   * answer, and re-reads the projections whatever happened, so the interface
   * always shows what the engine now holds rather than what was expected.
   */
  async function act(run: () => Promise<void>): Promise<void> {
    publish({ busy: true, error: null, transportMessageKey: null });
    try {
      await run();
    } catch (error: unknown) {
      publish({ transportMessageKey: describeThrown(error) });
    } finally {
      try {
        await read();
      } catch (error: unknown) {
        publish({ transportMessageKey: describeThrown(error) });
      }
      publish({ busy: false });
    }
  }

  /**
   * Records a command's answer.
   *
   * An autosave trigger the engine could not fulfil itself arrives here,
   * because only the client has a wall clock to stamp the snapshot with
   * (Technical Specification 11.3).
   */
  function noteCommand(
    response: { ok: true; data: CommandResultData } | { ok: false; error: EngineError },
  ): void {
    if (!response.ok) {
      publish({ error: response.error });
      return;
    }
    playedMs = 0;
    if (response.data.autosaveRequested) {
      void requestSave('auto');
    }
  }

  /** The wall clock as whole non-negative milliseconds, as the protocol wants. */
  function stamp(): number {
    return Math.max(0, Math.trunc(now()));
  }

  async function requestSave(kind: SaveKindName): Promise<void> {
    const response = await gateway.request('campaign.save', { kind, savedAtRealMs: stamp() });
    if (!response.ok) {
      publish({ error: response.error });
      return;
    }
    publish({ slot: state.slot === null ? null : { ...state.slot, status: response.data } });
  }

  return {
    get state(): CampaignSessionState {
      return state;
    },

    subscribe(listener: (next: CampaignSessionState) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    refresh(): Promise<void> {
      return read().catch((error: unknown) => {
        publish({ loading: false, transportMessageKey: describeThrown(error) });
      });
    },

    create(displayName: string): Promise<void> {
      return act(async () => {
        noteCommand(
          await gateway.request('campaign.create', {
            displayName: displayName.trim(),
            seed: createSeed(),
            createdAtRealMs: stamp(),
          }),
        );
      });
    },

    resume(): Promise<void> {
      return act(async () => {
        noteCommand(await gateway.request('campaign.resume', EMPTY_PAYLOAD));
      });
    },

    close(): Promise<void> {
      return act(async () => {
        noteCommand(await gateway.request('campaign.close', { savedAtRealMs: stamp() }));
      });
    },

    reset(): Promise<void> {
      return act(async () => {
        noteCommand(await gateway.request('campaign.reset', EMPTY_PAYLOAD));
      });
    },

    save(kind: SaveKindName = 'manual'): Promise<void> {
      return act(async () => {
        await requestSave(kind);
      });
    },

    notePlayTime(elapsedRealMs: number, paused: boolean): void {
      if (paused || elapsedRealMs <= 0) {
        return;
      }
      if (state.session === null || state.session.campaign === null) {
        return;
      }
      playedMs += elapsedRealMs;
      if (playedMs < autosaveIntervalMs || savingInterval) {
        return;
      }
      playedMs = 0;
      savingInterval = true;
      void requestSave('auto').finally(() => {
        savingInterval = false;
      });
    },
  };
}

/**
 * 128 bits of hexadecimal entropy for a new campaign
 * (Technical Specification 9.4).
 *
 * The engine is deterministic and has no entropy of its own, so the seed is
 * made here. It is the only randomness the client ever produces, and it is
 * produced once per campaign.
 */
export function createCampaignSeed(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto;
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.trunc(Math.random() * 256);
    }
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function defaultNow(): number {
  return Date.now();
}

function describeThrown(error: unknown): MessageKey {
  if (error instanceof GatewayRequestError || error instanceof EngineUnavailableError) {
    return error.messageKey;
  }
  return 'error.gateway.transportFailed';
}
