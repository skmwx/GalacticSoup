/**
 * Domain-to-view-model builders (Technical Specification 4.3, 7.3).
 *
 * Every value the interface reads is produced here. Nothing in this package
 * changes state, consumes randomness or advances time.
 */
export * from './assets';
export {
  frameProjection,
  sessionProjection,
  stateHashProjection,
  timeControlProjection,
} from './session';
