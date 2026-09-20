/**
 * Campaign aggregates, value objects and rules
 * (Technical Specification 4.3, 8).
 *
 * The domain owns authoritative state and the rules that change it. It knows
 * nothing about transports, storage or the interface, and it reaches authored
 * content only through the content port.
 */
export * from './assets';
export * from './attributes';
export * from './fitting';
export {
  authoritativeView,
  CAMPAIGN_STATE_VERSION,
  campaignStateHash,
  createCampaign,
  draftOf,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SIMULATION_TIME_MS,
} from './campaign/state';
export type {
  CampaignDraft,
  CampaignState,
  CreateCampaignInput,
  TimeState,
} from './campaign/state';
export {
  DOMAIN_EVENT_KINDS,
  isProjectionTopic,
  PROJECTION_TOPICS,
} from './campaign/events';
export type {
  DomainEvent,
  DomainEventKind,
  DomainEventParams,
  ProjectionTopic,
} from './campaign/events';
export {
  allocateEntityId,
  allocateEventOrdinal,
  OrdinalExhaustedError,
} from './campaign/allocation';
export {
  CAMPAIGN_ID_PATTERN,
  CAMPAIGN_SEED_PATTERN,
  deriveCampaignId,
  ENTITY_ID_PATTERN,
  entityIdOf,
  isCampaignId,
  isCampaignSeed,
  isEntityId,
  MAX_ORDINAL,
} from './campaign/identity';
export type { CampaignId, EntityId } from './campaign/identity';
export {
  campaignDefinitionReferences,
  readCampaignState,
} from './campaign/snapshot';
export type {
  CampaignReadFailure,
  CampaignReadResult,
  CampaignReadSuccess,
} from './campaign/snapshot';
export { validateCampaign } from './campaign/invariants';
export type { InvariantIssue } from './campaign/invariants';
export {
  compareSchedulerEntries,
  DEFAULT_BOUNDARY_PRIORITY,
  emptyScheduler,
  MAX_SCHEDULE_HORIZON_MS,
} from './campaign/scheduler';
export type { SchedulerEntry, SchedulerState } from './campaign/scheduler';
export {
  drawChance,
  drawIntegerInRange,
  drawUnitInterval,
  isRandomStreams,
  RANDOM_STREAMS,
  seedStreams,
} from './random/streams';
export type {
  MutableRandomStreams,
  RandomDrawRecord,
  RandomStreamName,
  RandomStreams,
  RandomStreamState,
} from './random/streams';
export {
  createRandomState,
  isRandomState,
  nextIntegerInRange,
  nextUint32,
  nextUnitInterval,
  UINT32_RANGE,
} from './random/xoshiro';
export type { RandomDraw, RandomState } from './random/xoshiro';
