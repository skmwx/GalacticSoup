import type { ContentRepository } from '@engine/ports';
import { isDefinitionIdIn } from '@shared';

import type { CampaignState } from '../campaign/state';

import { MAX_SUBJECTS } from './history';
import {
  NOTIFICATION_HISTORY_LIMIT,
  NOTIFICATION_SITE_MEMORY_LIMIT,
  type NotificationState,
} from './types';

/**
 * Notification-history shape and consistency (Technical Specification 13,
 * 15.3 checks 1, 2 and 11).
 *
 * The history is bounded, its sequence numbers only grow, and every entry
 * names a notification that is still authored.
 *
 * @implements TECH-15.3, TECH-13, FUNC-19.7
 */

type Report = (rule: string, path: string, detail: string) => void;

const MAX_PARAMS = 16;
const MAX_TEXT = 128;
const MAX_GROUP_KEY = 256;

export function isNotificationState(value: unknown): value is NotificationState {
  if (!shape(value, ['sequence', 'entries', 'raisedThisSite'])) return false;
  const entries = value['entries'];
  const remembered = value['raisedThisSite'];
  return count(value['sequence']) &&
    Array.isArray(entries) && entries.length <= NOTIFICATION_HISTORY_LIMIT && entries.every(entry) &&
    Array.isArray(remembered) && remembered.length <= NOTIFICATION_SITE_MEMORY_LIMIT &&
    remembered.every((key) => typeof key === 'string' && key.length > 0 && key.length <= MAX_GROUP_KEY);
}

export function validateNotifications(
  state: CampaignState,
  add: Report,
  content?: ContentRepository,
): void {
  if (!isNotificationState(state.notifications)) {
    add('notificationShape', 'notifications', 'Notification history has an unknown field, missing field or invalid value.');
    return;
  }
  const { sequence, entries } = state.notifications;
  const ids = new Set<number>();
  let previousSequence = 0;
  entries.forEach((record, index) => {
    const path = `notifications.entries[${String(index)}]`;
    const fail = (detail: string) => add('notificationConsistency', path, detail);
    if (ids.has(record.id)) fail('Two history entries share an id.');
    ids.add(record.id);
    if (record.id > record.sequence) fail('An entry cannot be raised again before it was created.');
    if (record.sequence > sequence) fail('An entry carries a sequence number that was never allocated.');
    if (record.sequence <= previousSequence) fail('Entries are ordered by their latest raise.');
    previousSequence = record.sequence;
    if (record.lastAtMs > state.time.simulationTimeMs) fail('A notification cannot be raised in the future.');
    if (content !== undefined && content.notification(record.definitionId) === undefined) {
      fail('The notification is not authored.');
    }
  });
}

function entry(value: unknown): boolean {
  if (!shape(value, [
    'id', 'sequence', 'definitionId', 'groupKey', 'subjectIds', 'params', 'firstAtMs', 'lastAtMs', 'count',
  ])) return false;
  const params = value['params'];
  const subjects = value['subjectIds'];
  return count(value['id']) && value['id'] >= 1 && count(value['sequence']) &&
    isDefinitionIdIn(value['definitionId'], 'notify') && typeof value['groupKey'] === 'string' &&
    value['groupKey'].length > 0 && value['groupKey'].length <= MAX_GROUP_KEY &&
    Array.isArray(subjects) && subjects.length <= MAX_SUBJECTS && subjects.every((id) => text(id)) &&
    record(params) && Object.keys(params).length <= MAX_PARAMS &&
    Object.values(params).every(paramValue) &&
    count(value['firstAtMs']) && count(value['lastAtMs']) && value['lastAtMs'] >= value['firstAtMs'] &&
    count(value['count']) && value['count'] >= 1;
}

function paramValue(value: unknown): boolean {
  return typeof value === 'boolean' || text(value) ||
    (typeof value === 'number' && Number.isFinite(value));
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
