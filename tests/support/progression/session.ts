import { createMemorySaveStore, type MemorySaveStore } from '@adapters/persistence';
import { createEngineHost, createSaveService, ENGINE_VERSION, type CampaignState, type ContentRepository } from '@engine';
import {
  EMPTY_PAYLOAD,
  PROTOCOL_VERSION,
  type CommandResultData,
  type EngineResponse,
  type DomainEventData,
} from '@protocol';

/**
 * A campaign opened in an engine host the way the game opens one
 * (Technical Specification 11.4, 16).
 *
 * A scenario starts from a campaign state assembled through the real commands,
 * writes it as a snapshot and resumes it, so everything that follows - the
 * sortie, the fight, the return - is protocol requests over the same host the
 * worker runs. Nothing in a scenario reaches past the protocol once the host is
 * open, so a scenario can only do what the interface could.
 *
 * Every time advance keeps the events it produced, which is what a scenario
 * reports when it explains why a fight went the way it did.
 */

/** One real-time step, the most a single frame may deliver (Technical Specification 9.1). */
export const STEP_MS = 250;

export interface ScenarioSession {
  ask<TData>(type: string, payload?: unknown): Promise<EngineResponse<TData>>;
  data<TData>(type: string, payload?: unknown): Promise<TData>;
  /** Advances real time in whole steps and returns the events it produced. */
  advance(elapsedRealMs: number): Promise<readonly DomainEventData[]>;
  /** Simulation time the last answer reported. */
  readonly simulationTimeMs: number;
  /** Every event every advance produced, oldest first. */
  readonly events: readonly DomainEventData[];
  /** Where the host keeps its snapshots, for a test that reads one back. */
  readonly saves: MemorySaveStore;
}

export async function openSession(state: CampaignState, content: ContentRepository): Promise<ScenarioSession> {
  const saves = createMemorySaveStore();
  const service = createSaveService({
    store: saves,
    content,
    engineVersion: ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  });
  await service.save(state, 'auto', 1_700_000_000_000);
  await service.drain();

  const host = createEngineHost({ content, saves });
  let ordinal = 0;
  let simulationTimeMs = state.time.simulationTimeMs;
  const events: DomainEventData[] = [];

  const ask = async <TData>(type: string, payload: unknown = EMPTY_PAYLOAD): Promise<EngineResponse<TData>> => {
    ordinal += 1;
    return (await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `scenario-${String(ordinal)}`,
      type,
      payload,
    })) as EngineResponse<TData>;
  };
  const data = async <TData>(type: string, payload?: unknown): Promise<TData> => {
    const response = await ask<TData>(type, payload ?? EMPTY_PAYLOAD);
    if (!response.ok) throw new Error(`${type} failed: ${response.error.messageKey}`);
    return response.data;
  };

  const resumed = await ask('campaign.resume');
  if (!resumed.ok) throw new Error(`The scenario campaign did not resume: ${resumed.error.messageKey}`);

  return {
    ask,
    data,
    async advance(elapsedRealMs: number): Promise<readonly DomainEventData[]> {
      const produced: DomainEventData[] = [];
      for (let elapsed = 0; elapsed < elapsedRealMs; elapsed += STEP_MS) {
        const result = await data<CommandResultData>('time.advance', {
          elapsedRealMs: Math.min(STEP_MS, elapsedRealMs - elapsed),
        });
        simulationTimeMs = result.simulationTimeMs;
        produced.push(...result.events);
      }
      events.push(...produced);
      return produced;
    },
    get simulationTimeMs(): number {
      return simulationTimeMs;
    },
    get events(): readonly DomainEventData[] {
      return events;
    },
    saves,
  };
}
