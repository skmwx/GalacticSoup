import {
  allocateEntityId,
  compareSchedulerEntries,
  DEFAULT_BOUNDARY_PRIORITY,
  type CampaignDraft,
  type EntityId,
  type SchedulerEntry,
  type SchedulerState,
} from '@engine/domain';

/**
 * Scheduler operations (Technical Specification 9.2).
 *
 * The queue is kept sorted on insertion, so taking the next boundary is a
 * shift and the stored order is the resolution order a save reproduces
 * exactly. Sorting on read would be equally correct but would let an
 * unsorted save look healthy.
 *
 * No gameplay timer uses a host timer: a repeating action schedules its next
 * boundary only after the current one resolves, which is the responsibility of
 * the system that owns the boundary kind.
 *
 * @implements TECH-9.2
 */

export interface ScheduleRequest {
  /** Which system resolves this boundary. */
  readonly kind: string;
  /** Simulation timestamp in whole milliseconds. */
  readonly dueAtMs: number;
  readonly priority?: number;
  readonly ownerId?: EntityId | null;
}

export function scheduleBoundary(draft: CampaignDraft, request: ScheduleRequest): SchedulerEntry {
  if (!Number.isSafeInteger(request.dueAtMs) || request.dueAtMs < draft.time.simulationTimeMs) {
    throw new RangeError('A boundary must be due at a whole millisecond that is not in the past.');
  }

  const entry: SchedulerEntry = {
    entryId: allocateEntityId(draft),
    kind: request.kind,
    dueAtMs: request.dueAtMs,
    priority: request.priority ?? DEFAULT_BOUNDARY_PRIORITY,
    insertionOrdinal: draft.scheduler.nextInsertionOrdinal,
    ownerId: request.ownerId ?? null,
  };

  draft.scheduler.nextInsertionOrdinal += 1;
  draft.scheduler.entries.splice(insertionIndex(draft.scheduler.entries, entry), 0, { ...entry });
  return entry;
}

/** Removes one entry. Returns whether it was queued. */
export function cancelBoundary(draft: CampaignDraft, entryId: EntityId): boolean {
  const index = draft.scheduler.entries.findIndex((entry) => entry.entryId === entryId);
  if (index < 0) {
    return false;
  }
  draft.scheduler.entries.splice(index, 1);
  return true;
}

/** Removes every entry owned by one entity, for example a destroyed ship. */
export function cancelBoundariesOwnedBy(draft: CampaignDraft, ownerId: EntityId): number {
  const before = draft.scheduler.entries.length;
  const kept = draft.scheduler.entries.filter((entry) => entry.ownerId !== ownerId);
  draft.scheduler.entries.length = 0;
  draft.scheduler.entries.push(...kept);
  return before - kept.length;
}

export function nextBoundary(scheduler: SchedulerState): SchedulerEntry | null {
  return scheduler.entries[0] ?? null;
}

/** Takes the next boundary when it is due at or before `throughMs`. */
export function takeBoundaryDue(draft: CampaignDraft, throughMs: number): SchedulerEntry | null {
  const entry = draft.scheduler.entries[0];
  if (entry === undefined || entry.dueAtMs > throughMs) {
    return null;
  }
  draft.scheduler.entries.shift();
  return { ...entry };
}

function insertionIndex(entries: readonly SchedulerEntry[], entry: SchedulerEntry): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const candidate = entries[middle];
    if (candidate !== undefined && compareSchedulerEntries(candidate, entry) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
