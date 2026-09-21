/**
 * Domain-to-view-model builders (Technical Specification 4.3, 7.3).
 *
 * Every value the interface reads is produced here. Nothing in this package
 * changes state, consumes randomness or advances time.
 */
export * from './assets';
export * from './economy';
export { combatProjection, objectLockCommands } from './combat';
export { destinationsProjection, siteProjection } from './navigation';
export { encounterProjection, wreckContentsProjection } from './encounter';
export { itemDataOf } from './items';
export { comparisonProjection } from './comparison';
export {
  fittingDraftProjection,
  shipProjection,
  undockValidityProjection,
} from './ship';
export {
  frameProjection,
  sessionProjection,
  stateHashProjection,
  timeControlProjection,
} from './session';
