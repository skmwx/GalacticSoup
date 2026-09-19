import type { SchedulerEntry } from '@engine/domain';
import type { TimeRules } from '@engine/ports';

import type { SimulationContext } from './context';
import { takeBoundaryDue } from './scheduler';

/**
 * The authoritative clock and quantum loop
 * (Technical Specification 9.1, 9.2).
 *
 * Simulation time advances only from elapsed real deltas the main thread
 * delivers while a campaign is open and not paused. A single delta is capped,
 * multiplied by the selected rate and accumulated into fixed quanta; anything
 * the browser failed to deliver on time - a suspended tab, a changed system
 * clock - is simply not delivered and is therefore never replayed as
 * catch-up. Offline progress is zero because nothing offline produces a delta
 * (Functional Specification 22.12).
 *
 * @implements TECH-9.1, TECH-9.2, FUNC-3.3, FUNC-22.12
 */

/** A boundary resolver, keyed by the boundary kind it owns. */
export type BoundaryResolver = (context: SimulationContext, entry: SchedulerEntry) => void;

export type BoundaryResolvers = Readonly<Record<string, BoundaryResolver>>;

/**
 * Guard against a resolver that keeps scheduling work at the same instant.
 * Remaining entries stay queued rather than hanging the worker.
 */
export const MAX_BOUNDARIES_PER_QUANTUM = 1024;

export interface AdvanceOutcome {
  /** Real milliseconds accepted after the per-delta cap. */
  readonly acceptedMs: number;
  /** Real milliseconds discarded because the delta exceeded the cap. */
  readonly discardedMs: number;
  readonly quanta: number;
  readonly boundariesResolved: number;
  /** Whether anything in the draft changed and the transaction must commit. */
  readonly changed: boolean;
}

const NOTHING: AdvanceOutcome = {
  acceptedMs: 0,
  discardedMs: 0,
  quanta: 0,
  boundariesResolved: 0,
  changed: false,
};

export function advanceTime(
  context: SimulationContext,
  elapsedRealMs: number,
  resolvers: BoundaryResolvers,
): AdvanceOutcome {
  const rules: TimeRules = context.content.rules.time;
  const time = context.draft.time;

  const delivered = Number.isFinite(elapsedRealMs) ? Math.floor(Math.max(0, elapsedRealMs)) : 0;
  const accepted = Math.min(delivered, rules.maxFrameDeltaMs);
  const discarded = delivered - accepted;

  if (time.paused || accepted === 0) {
    return { ...NOTHING, acceptedMs: accepted, discardedMs: discarded };
  }

  // Simulation time is whole milliseconds, so the scaled delta is rounded once
  // here rather than accumulating a fractional remainder that two engines
  // could round differently (Technical Specification 5.2).
  time.accumulatorMs += Math.round(accepted * time.rate);

  let quanta = 0;
  let boundaries = 0;
  while (time.accumulatorMs >= rules.simulationQuantumMs) {
    const target = time.simulationTimeMs + rules.simulationQuantumMs;
    boundaries += resolveThrough(context, target, resolvers);
    time.simulationTimeMs = target;
    time.accumulatorMs -= rules.simulationQuantumMs;
    quanta += 1;
  }

  if (quanta > 0) {
    context.invalidate('frame');
  }

  return {
    acceptedMs: accepted,
    discardedMs: discarded,
    quanta,
    boundariesResolved: boundaries,
    changed: true,
  };
}

/**
 * Resolves every boundary due at or before `targetMs`, in scheduler order.
 * Simulation time moves to each boundary before it resolves, so a system
 * always reads the instant its work completed rather than the quantum edge.
 */
function resolveThrough(
  context: SimulationContext,
  targetMs: number,
  resolvers: BoundaryResolvers,
): number {
  let resolved = 0;

  while (resolved < MAX_BOUNDARIES_PER_QUANTUM) {
    const entry = takeBoundaryDue(context.draft, targetMs);
    if (entry === null) {
      return resolved;
    }

    context.draft.time.simulationTimeMs = Math.max(
      context.draft.time.simulationTimeMs,
      entry.dueAtMs,
    );

    const resolver = resolvers[entry.kind];
    if (resolver === undefined) {
      // A queued boundary whose system is not installed. Dropping it silently
      // would hide a content or migration fault, so it is reported.
      context.publish('scheduler.boundaryUnhandled', {
        kind: entry.kind,
        entryId: entry.entryId,
      });
    } else {
      resolver(context, entry);
      context.publish('scheduler.boundaryResolved', {
        kind: entry.kind,
        entryId: entry.entryId,
      });
    }

    resolved += 1;
  }

  return resolved;
}
