import type { NotificationId } from '@shared';

/**
 * Semantic notifications and their bounded history
 * (Functional Specification 19.7, 20; Technical Specification 8.1, 12.4, 13).
 *
 * The engine decides what happened and how urgent it is; the interface decides
 * where and for how long it is shown, whether it is heard, and whether the
 * player has hidden its category. The history doubles as the event log: a
 * short, grouped account of important outcomes rather than every number.
 *
 * It is bounded, and nothing reads it to decide a rule, so trimming it never
 * alters gameplay (Technical Specification 8.1, 13). The one exception is the
 * record of what has already been raised in the current site visit, which is
 * what makes "the first hostile lock" the first.
 *
 * @implements FUNC-19.7, FUNC-20, TECH-8.1, TECH-12.4, TECH-13
 */

/** Oldest entries fall off once the history holds this many. */
export const NOTIFICATION_HISTORY_LIMIT = 64;

/** A cap on what one site visit can remember having raised. */
export const NOTIFICATION_SITE_MEMORY_LIMIT = 64;

export type NotificationParamValue = string | number | boolean;

export interface NotificationRecord {
  /** The sequence number the entry was created with; stable for its life. */
  readonly id: number;
  /** The sequence number of its latest raise, so a grouped repeat reads as new. */
  readonly sequence: number;
  readonly definitionId: NotificationId;
  /** Repeats with the same key inside the definition's window join this entry. */
  readonly groupKey: string;
  /** The entities the notification is about, such as the ship that locked on. */
  readonly subjectIds: readonly string[];
  /**
   * Localization parameters. A name ending in `Key` carries a message key the
   * interface resolves before substituting it.
   */
  readonly params: Readonly<Record<string, NotificationParamValue>>;
  readonly firstAtMs: number;
  readonly lastAtMs: number;
  /** How many raises this entry groups. */
  readonly count: number;
}

export interface NotificationState {
  /** The last sequence number allocated; every raise takes the next one. */
  readonly sequence: number;
  /** Ordered by latest raise, oldest first. */
  readonly entries: readonly NotificationRecord[];
  /** Group keys of once-per-site notifications raised since the player last changed site. */
  readonly raisedThisSite: readonly string[];
}
