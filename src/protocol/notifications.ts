/**
 * Semantic notifications, the event history and audible cues
 * (Functional Specification 19.7, 20; Technical Specification 12.4).
 *
 * The engine says what happened, how urgent it is, which entities it is about,
 * when it happened and how often it has repeated. It also says whether the
 * player may hide it and which cue it sounds. Where a notification is shown,
 * for how long, and whether its category is currently muted are the
 * interface's decisions.
 */

export const NOTIFICATION_SEVERITY_NAMES = ['informational', 'opportunity', 'warning', 'danger'] as const;
export type NotificationSeverityName = (typeof NOTIFICATION_SEVERITY_NAMES)[number];

export const NOTIFICATION_CATEGORY_NAMES = [
  'combat',
  'navigation',
  'encounter',
  'station',
  'recovery',
  'guidance',
] as const;
export type NotificationCategoryName = (typeof NOTIFICATION_CATEGORY_NAMES)[number];

export interface NotificationData {
  /** Stable for the life of the entry. */
  readonly id: number;
  /** Grows whenever the entry is raised again, so a grouped repeat reads as new. */
  readonly sequence: number;
  readonly definitionId: string;
  readonly category: NotificationCategoryName;
  readonly severity: NotificationSeverityName;
  readonly messageKey: string;
  /**
   * Localization parameters. A name ending in `Key` carries a message key to
   * resolve before it is substituted under the name without that suffix.
   */
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly subjectIds: readonly string[];
  readonly firstAtMs: number;
  readonly lastAtMs: number;
  /** How many raises this entry groups (Functional Specification 19.7). */
  readonly count: number;
  /** False for ship destruction, which the player cannot hide. */
  readonly hideable: boolean;
  readonly cueId: string | null;
}

export interface NotificationsData {
  /** The latest sequence number the campaign has allocated. */
  readonly sequence: number;
  /** Newest first. */
  readonly entries: readonly NotificationData[];
}

export interface AudioNoteData {
  readonly frequencyHz: number;
  readonly durationMs: number;
  readonly gain: number;
}

export interface AudioCueData {
  readonly id: string;
  readonly channel: 'alert' | 'interface' | 'effects';
  readonly waveform: 'sine' | 'square' | 'triangle' | 'sawtooth';
  /** The severity this cue speaks for when a message has no definition of its own. */
  readonly defaultFor: NotificationSeverityName | null;
  readonly notes: readonly AudioNoteData[];
}

/** The authored cues, for the interface's audio player (Technical Specification 12.4). */
export interface AudioCuesData {
  readonly cues: readonly AudioCueData[];
}
