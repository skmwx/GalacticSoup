import type { NotificationDefinition } from '@engine/ports';

import type { CampaignDraft } from '../campaign/state';

import {
  NOTIFICATION_HISTORY_LIMIT,
  NOTIFICATION_SITE_MEMORY_LIMIT,
  type NotificationParamValue,
  type NotificationRecord,
} from './types';

/**
 * Raising and grouping notifications (Functional Specification 19.7;
 * Technical Specification 12.4).
 *
 * A raise inside its definition's group window joins the latest entry with the
 * same group key: the count grows, the parameters become the latest ones and
 * any accumulating parameter - credits paid, units taken - is summed. The
 * entry moves to the end, so the history stays ordered by latest raise.
 *
 * @implements FUNC-19.7, TECH-12.4
 */

export interface NotificationRaise {
  readonly definition: NotificationDefinition;
  readonly atMs: number;
  /** Distinguishes groups within one definition, such as one item per loot entry. */
  readonly groupSubject: string;
  readonly subjectIds: readonly string[];
  readonly params: Readonly<Record<string, NotificationParamValue>>;
  /** Parameters that add up when repeats are grouped. */
  readonly accumulate: readonly string[];
}

export function groupKeyOf(definitionId: string, groupSubject: string): string {
  return groupSubject === '' ? definitionId : `${definitionId}|${groupSubject}`;
}

/** Whether a once-per-site notification has already been raised in this visit. */
export function raisedThisSite(draft: CampaignDraft, groupKey: string): boolean {
  return draft.notifications.raisedThisSite.includes(groupKey);
}

/** The player changed site: every once-per-site notification may be raised again. */
export function forgetSiteNotifications(draft: CampaignDraft): void {
  if (draft.notifications.raisedThisSite.length > 0) {
    draft.notifications = { ...draft.notifications, raisedThisSite: [] } as CampaignDraft['notifications'];
  }
}

/** Records one raise and returns the entry it created or joined. */
export function raiseNotification(draft: CampaignDraft, raise: NotificationRaise): NotificationRecord {
  const state = draft.notifications;
  const sequence = state.sequence + 1;
  const groupKey = groupKeyOf(raise.definition.id, raise.groupSubject);
  const windowMs = raise.definition.groupWindowSeconds * 1000;
  const entries: NotificationRecord[] = [...state.entries];
  const index = findLastIndex(entries, (entry) => entry.groupKey === groupKey);
  const previous = index === -1 ? undefined : entries[index];

  let record: NotificationRecord;
  if (previous !== undefined && windowMs > 0 && raise.atMs - previous.lastAtMs <= windowMs) {
    const params: Record<string, NotificationParamValue> = { ...raise.params };
    for (const name of raise.accumulate) {
      const before = previous.params[name];
      const now = raise.params[name];
      if (typeof before === 'number' && typeof now === 'number') params[name] = before + now;
    }
    record = {
      ...previous,
      sequence,
      params,
      subjectIds: mergeSubjects(previous.subjectIds, raise.subjectIds),
      lastAtMs: raise.atMs,
      count: previous.count + 1,
    };
    entries.splice(index, 1);
  } else {
    record = {
      id: sequence,
      sequence,
      definitionId: raise.definition.id,
      groupKey,
      subjectIds: [...raise.subjectIds],
      params: { ...raise.params },
      firstAtMs: raise.atMs,
      lastAtMs: raise.atMs,
      count: 1,
    };
  }
  entries.push(record);
  if (entries.length > NOTIFICATION_HISTORY_LIMIT) {
    entries.splice(0, entries.length - NOTIFICATION_HISTORY_LIMIT);
  }

  const remembered = raise.definition.repeat === 'oncePerSite' && !state.raisedThisSite.includes(groupKey)
    ? [...state.raisedThisSite, groupKey].slice(-NOTIFICATION_SITE_MEMORY_LIMIT)
    : state.raisedThisSite;

  // The draft's type is deeply mutable; the records are replaced, never edited.
  draft.notifications = { sequence, entries, raisedThisSite: remembered } as CampaignDraft['notifications'];
  return record;
}

/** Subject ids in first-seen order, without repeats, kept short. */
function mergeSubjects(before: readonly string[], added: readonly string[]): string[] {
  const merged = [...before];
  for (const id of added) if (!merged.includes(id)) merged.push(id);
  return merged.slice(-MAX_SUBJECTS);
}

export const MAX_SUBJECTS = 16;

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) return index;
  }
  return -1;
}
