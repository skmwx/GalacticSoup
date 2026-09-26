import type { CampaignState } from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type { AudioCuesData, NotificationData, NotificationsData } from '@protocol';
import { deepFreeze } from '@shared';

/**
 * The notification history and the authored cues
 * (Functional Specification 19.7, 20; Technical Specification 7.3, 12.4).
 *
 * The history is published newest first, each entry with the severity,
 * category, message, grouping count, hideability and cue its definition
 * gives it. An entry whose definition a content update removed is left out
 * rather than shown without a meaning.
 *
 * @implements FUNC-19.7, FUNC-20, TECH-7.3, TECH-12.4
 */
export function notificationsProjection(state: CampaignState, content: ContentRepository): NotificationsData {
  const entries: NotificationData[] = [];
  for (const record of [...state.notifications.entries].reverse()) {
    const definition = content.notification(record.definitionId);
    if (definition === undefined) continue;
    entries.push({
      id: record.id,
      sequence: record.sequence,
      definitionId: record.definitionId,
      category: definition.category,
      severity: definition.severity,
      messageKey: definition.messageKey,
      params: { ...record.params },
      subjectIds: [...record.subjectIds],
      firstAtMs: record.firstAtMs,
      lastAtMs: record.lastAtMs,
      count: record.count,
      hideable: definition.hideable,
      cueId: definition.cueId,
    });
  }
  return deepFreeze({ sequence: state.notifications.sequence, entries });
}

/** Authored cues do not depend on a campaign, so they are readable before one opens. */
export function audioCuesProjection(content: ContentRepository): AudioCuesData {
  return deepFreeze({
    cues: content.audioCues().map((cue) => ({
      id: cue.id,
      channel: cue.channel,
      waveform: cue.waveform,
      defaultFor: cue.defaultFor ?? null,
      notes: cue.notes.map((note) => ({ ...note })),
    })),
  });
}
