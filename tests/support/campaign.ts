import { shippedContent } from './content.ts';

import {
  createCampaign,
  draftOf,
  type CampaignDraft,
  type CampaignState,
  type DomainEvent,
  type DomainEventKind,
  type DomainEventParams,
  type ProjectionTopic,
  type SimulationContext,
} from '@engine';
import type { ContentRepository } from '@engine';

/**
 * Campaign fixtures for headless engine tests.
 *
 * A draft here stands in for the one a transaction would create, so a
 * simulation system can be exercised without running a command through the
 * whole pipeline.
 */

export const TEST_SEED = '0123456789abcdef0123456789abcdef';
export const OTHER_SEED = 'fedcba9876543210fedcba9876543210';

export function testCampaign(overrides: Partial<CampaignState> = {}): CampaignState {
  const base = createCampaign({
    displayName: 'Test Pilot',
    seed: TEST_SEED,
    createdAtRealMs: 1_700_000_000_000,
    initialRate: 1,
  }, shippedContent());
  return { ...base, revision: 1, ...overrides };
}

export function testDraft(overrides: Partial<CampaignState> = {}): CampaignDraft {
  return draftOf(testCampaign(overrides));
}

export interface TestSimulation extends SimulationContext {
  readonly events: DomainEvent[];
  readonly invalidations: Set<ProjectionTopic>;
}

/**
 * A simulation context over a bare draft. Event ordinals come from the draft,
 * exactly as they do inside a transaction.
 */
export function testSimulation(
  draft: CampaignDraft,
  content: ContentRepository = shippedContent(),
): TestSimulation {
  const events: DomainEvent[] = [];
  const invalidations = new Set<ProjectionTopic>();

  return {
    draft,
    content,
    events,
    invalidations,
    publish(kind: DomainEventKind, params?: DomainEventParams): void {
      const ordinal = draft.nextEventOrdinal;
      draft.nextEventOrdinal += 1;
      events.push({
        ordinal,
        kind,
        simulationTimeMs: draft.time.simulationTimeMs,
        ...(params === undefined ? {} : { params }),
      });
    },
    invalidate(topic: ProjectionTopic): void {
      invalidations.add(topic);
    },
    requestAutosave(): void {
      // Individual simulation-system tests inspect state and events only.
    },
  };
}
