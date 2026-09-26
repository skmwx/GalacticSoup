import type { NotificationState } from './types';

/** A new campaign has been told nothing yet. */
export function startingNotifications(): NotificationState {
  return { sequence: 0, entries: [], raisedThisSite: [] };
}
