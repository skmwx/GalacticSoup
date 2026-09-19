import type {
  CampaignDraft,
  DomainEventKind,
  DomainEventParams,
  ProjectionTopic,
} from '@engine/domain';
import type { ContentRepository } from '@engine/ports';

/**
 * What a simulation system is given (Technical Specification 9.2).
 *
 * A system reads authored content, changes the transaction draft, publishes
 * semantic events and marks the projection topics its change invalidated. It
 * never returns a value to the caller and never reaches outside this context,
 * which is what keeps one transaction the unit of commit.
 *
 * @implements TECH-9.2
 */
export interface SimulationContext {
  readonly draft: CampaignDraft;
  readonly content: ContentRepository;
  publish(kind: DomainEventKind, params?: DomainEventParams): void;
  invalidate(topic: ProjectionTopic): void;
}
