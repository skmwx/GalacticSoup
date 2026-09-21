/**
 * Clock, scheduler and ordered systems (Technical Specification 4.3, 9).
 *
 * The simulation package advances authoritative state in fixed quanta and
 * resolves scheduled boundaries in a stable order. It owns no state of its
 * own: everything it changes lives in the campaign draft it is given.
 */
export { advanceTime, MAX_BOUNDARIES_PER_QUANTUM } from './clock';
export type { AdvanceOutcome, BoundaryResolver, BoundaryResolvers, ContinuousSystem } from './clock';
export { resolveEconomyHour } from './economy';
export {
  advanceNavigation,
  DOCK_COMPLETE_BOUNDARY,
  resolveDockComplete,
  resolveWarpArrival,
  resolveWarpPrepared,
  WARP_ARRIVAL_BOUNDARY,
  WARP_PREPARED_BOUNDARY,
} from './navigation';
export type { SimulationContext } from './context';
export {
  cancelBoundariesOwnedBy,
  cancelBoundary,
  nextBoundary,
  scheduleBoundary,
  takeBoundaryDue,
} from './scheduler';
export type { ScheduleRequest } from './scheduler';
