/**
 * Domain events and projection invalidation (Technical Specification 7.2, 7.3).
 *
 * A committed transaction publishes what it did: semantic events for later
 * notifications and the event log, and the projection topics whose cached
 * view models are now stale. Both are transport-safe records, so the same
 * values cross a worker message today and a network response later.
 *
 * Event ordinals come from campaign state and are monotonic for the life of
 * the campaign (Technical Specification 15.3, check 11). The events
 * themselves are transaction-scoped: nothing here is stored.
 *
 * @implements TECH-7.3
 */

/** Event kinds this phase can publish. Later phases add their own. */
export const DOMAIN_EVENT_KINDS = [
  'campaign.created',
  'campaign.reset',
  'scheduler.boundaryResolved',
  'scheduler.boundaryUnhandled',
  'time.settingChanged',
] as const;

export type DomainEventKind = (typeof DOMAIN_EVENT_KINDS)[number];

export type DomainEventParams = Readonly<Record<string, string | number | boolean>>;

export interface DomainEvent {
  readonly ordinal: number;
  readonly kind: DomainEventKind;
  readonly simulationTimeMs: number;
  readonly params?: DomainEventParams;
}

/**
 * Cached view models are refreshed by topic, not by global revision, so a
 * tactical change does not force every slow screen to re-query
 * (Technical Specification 7.3).
 */
export const PROJECTION_TOPICS = ['session', 'frame'] as const;

export type ProjectionTopic = (typeof PROJECTION_TOPICS)[number];

export function isProjectionTopic(value: string): value is ProjectionTopic {
  return (PROJECTION_TOPICS as readonly string[]).includes(value);
}
