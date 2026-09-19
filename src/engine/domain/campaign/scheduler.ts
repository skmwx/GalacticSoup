/**
 * Scheduler state (Technical Specification 9.2).
 *
 * Long-duration work is a queue entry, never a host timer. An entry is due at
 * a simulation timestamp and is resolved by the system that owns its kind.
 * Ordering is total and stable: due time, then event priority, then the
 * insertion ordinal, so two entries due at the same instant always resolve in
 * the same order in every run and in a future Java engine.
 *
 * The operations that add, cancel and take entries live in the simulation
 * package; the shape and the ordering live here because campaign state owns
 * them and the campaign invariants check them.
 *
 * @implements TECH-9.2
 */
import { compareStable } from '@shared';

import type { EntityId } from './identity';

export interface SchedulerEntry {
  readonly entryId: EntityId;
  /** Which system resolves this boundary. */
  readonly kind: string;
  /** Simulation timestamp in milliseconds. Never a real timestamp. */
  readonly dueAtMs: number;
  /** Lower values resolve first among entries due at the same instant. */
  readonly priority: number;
  /** Allocated when the entry was inserted; breaks a remaining tie. */
  readonly insertionOrdinal: number;
  /** The entity whose work this is, or `null` for a world boundary. */
  readonly ownerId: EntityId | null;
}

export interface SchedulerState {
  readonly entries: readonly SchedulerEntry[];
  readonly nextInsertionOrdinal: number;
}

/** Default priority for a boundary whose system states no preference. */
export const DEFAULT_BOUNDARY_PRIORITY = 100;

/**
 * A boundary further ahead than this is a defect, and it is how the campaign
 * invariants detect a real epoch timestamp used as a completion condition
 * (Technical Specification 15.3, check 12). One simulated year.
 */
export const MAX_SCHEDULE_HORIZON_MS = 31_536_000_000;

export function emptyScheduler(): SchedulerState {
  return { entries: [], nextInsertionOrdinal: 1 };
}

/** Total order: due time, priority, insertion ordinal, then entry id. */
export function compareSchedulerEntries(a: SchedulerEntry, b: SchedulerEntry): number {
  if (a.dueAtMs !== b.dueAtMs) {
    return a.dueAtMs - b.dueAtMs;
  }
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  if (a.insertionOrdinal !== b.insertionOrdinal) {
    return a.insertionOrdinal - b.insertionOrdinal;
  }
  return compareStable(a.entryId, b.entryId);
}
