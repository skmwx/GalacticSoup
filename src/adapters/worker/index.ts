/**
 * Worker host and message dispatch (Technical Specification 4.3).
 *
 * The worker entry module is deliberately not re-exported here: importing it
 * has the side effect of attaching an engine to the current global scope.
 */
export { attachEngineHost } from './dispatcher';
export type { MessageEventLike, MessageTargetLike } from './dispatcher';
