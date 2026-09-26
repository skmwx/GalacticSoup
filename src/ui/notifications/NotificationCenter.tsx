import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { NotificationData, NotificationsData, SaveSlotData } from '@protocol';

import { ActionButton, useActionShortcuts, type ActionRunner } from '../actions';
import { useAudioCues } from '../audio';
import { useLocalizer, useTranslate } from '../localization';
import { usePreferences } from '../preferences';
import { EventLog } from './EventLog';
import styles from './Notifications.module.css';
import { NotificationSettings } from './NotificationSettings';
import { SeverityIcon } from './SeverityIcon';
import { notificationText, SEVERITY_RANK } from './text';

/**
 * Notifications as the player meets them (Functional Specification 19.7, 20;
 * Technical Specification 12.4).
 *
 * The engine raises semantic notifications and keeps their grouped history.
 * This decides the rest: which new ones appear, for how long, whether their
 * cue sounds and at what volume. A notification is new when its sequence
 * number is above the highest one already seen, so a grouped repeat appears
 * again with its count while a campaign reopened from a save does not replay
 * its history.
 *
 * The player may hide or mute a category. Ship destruction and save-integrity
 * failures cannot be hidden: the loss always appears, and a failed save is
 * reported for as long as saving keeps failing.
 *
 * Every level has its own word and shape, and immediate danger is announced
 * assertively to assistive technology as well as heard.
 *
 * @implements FUNC-19.7, FUNC-20, TECH-12.4, TECH-12.3, MVP-AC-10
 */

export interface NotificationCenterProps {
  readonly notifications: NotificationsData | null;
  readonly slot: SaveSlotData | null;
  readonly runner: ActionRunner;
}

interface Toast {
  readonly entry: NotificationData;
  readonly shownAtMs: number;
}

/** How long a notification stays on screen, by level, in real milliseconds. */
export const TOAST_DURATION_MS: Readonly<Record<NotificationData['severity'], number>> = {
  informational: 6_000,
  opportunity: 8_000,
  warning: 12_000,
  danger: 20_000,
};

/** Cues closer together than this are merged into the most urgent one. */
export const CUE_SPACING_MS = 600;

const MAX_TOASTS = 3;

export function NotificationCenter({ notifications, slot, runner }: NotificationCenterProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const { preferences } = usePreferences();
  const audio = useAudioCues();
  const seen = useRef<number | null>(null);
  const lastCue = useRef<{ atMs: number; rank: number }>({ atMs: -Infinity, rank: -1 });
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const [panel, setPanel] = useState<'log' | 'settings' | null>(null);
  const saveFailed = slot?.status.state === 'failed';

  const playCue = useCallback((cueId: string | null, severity: NotificationData['severity']) => {
    const cue = cueId === null ? null : audio.cues.get(cueId) ?? null;
    if (cue === null || !preferences.audio.enabled) return;
    const now = Date.now();
    const rank = SEVERITY_RANK[severity];
    // Repeated low-priority cues are rate-limited here; the engine's history
    // still records every one (Technical Specification 12.4).
    if (now - lastCue.current.atMs < CUE_SPACING_MS && rank <= lastCue.current.rank) return;
    lastCue.current = { atMs: now, rank };
    audio.player.play(cue, preferences.audio.master * preferences.audio.channels[cue.channel]);
  }, [audio, preferences]);

  // New entries become toasts and may sound; the history already seen does not.
  useEffect(() => {
    if (notifications === null) return;
    if (seen.current === null) {
      seen.current = notifications.sequence;
      return;
    }
    const threshold = seen.current;
    const fresh = notifications.entries.filter((entry) => entry.sequence > threshold);
    seen.current = Math.max(threshold, notifications.sequence);
    if (fresh.length === 0) return;

    const shown = fresh.filter((entry) =>
      !entry.hideable || preferences.notifications[entry.category].visible);
    if (shown.length > 0) {
      const now = Date.now();
      setToasts((current) => {
        const kept = current.filter((toast) => !shown.some((entry) => entry.id === toast.entry.id));
        return [...kept, ...shown.map((entry) => ({ entry, shownAtMs: now }))];
      });
    }

    const audible = fresh
      .filter((entry) => entry.cueId !== null && preferences.notifications[entry.category].sound)
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    const loudest = audible[0];
    if (loudest !== undefined) playCue(loudest.cueId, loudest.severity);
  }, [notifications, preferences, playCue]);

  // A failed save is heard once when it starts failing, and shown until it stops.
  const failedBefore = useRef(false);
  useEffect(() => {
    if (saveFailed && !failedBefore.current) {
      playCue(audio.cueForSeverity('danger')?.id ?? null, 'danger');
    }
    failedBefore.current = saveFailed;
  }, [saveFailed, playCue, audio]);

  // Each toast leaves after its level's duration.
  useEffect(() => {
    if (toasts.length === 0) return undefined;
    const now = Date.now();
    const next = Math.min(...toasts.map((toast) =>
      toast.shownAtMs + TOAST_DURATION_MS[toast.entry.severity] - now));
    const timer = setTimeout(() => {
      const at = Date.now();
      setToasts((current) => current.filter((toast) =>
        toast.shownAtMs + TOAST_DURATION_MS[toast.entry.severity] > at));
    }, Math.max(0, next));
    return () => {
      clearTimeout(timer);
    };
  }, [toasts]);

  useActionShortcuts({
    'notifications.log': () => {
      setPanel((current) => (current === 'log' ? null : 'log'));
    },
  });

  const dismiss = (id: number): void => {
    setToasts((current) => current.filter((toast) => toast.entry.id !== id));
  };

  const visible = [...toasts]
    .sort((a, b) => SEVERITY_RANK[b.entry.severity] - SEVERITY_RANK[a.entry.severity] ||
      b.entry.sequence - a.entry.sequence)
    .slice(0, MAX_TOASTS);
  const urgent = visible.filter((toast) => toast.entry.severity === 'danger');
  const calm = visible.filter((toast) => toast.entry.severity !== 'danger');

  return (
    <section className={styles['center']} aria-label={translate('notifications.region')}>
      <div className={styles['toasts']}>
        {saveFailed ? (
          <p className={`${styles['toast']} ${styles['danger']}`} role="alert" data-save-integrity>
            <SeverityIcon severity="danger" className={styles['icon']} />
            <span className={styles['level']}>{translate('notifications.level.danger')}</span>
            <span className={styles['message']}>
              {translate('notifications.saveFailed', {
                reason: slot?.status.error === null || slot?.status.error === undefined
                  ? translate('campaign.save.failed')
                  : translate(slot.status.error.messageKey, slot.status.error.params),
              })}
            </span>
          </p>
        ) : null}
        {urgent.length === 0 ? null : (
          <div className={styles['stack']}>
            {urgent.map((toast) => (
              <ToastItem key={toast.entry.id} toast={toast} runner={runner} onDismiss={dismiss} urgent />
            ))}
          </div>
        )}
        <div role="status" aria-live="polite" className={styles['stack']}>
          {calm.map((toast) => (
            <ToastItem key={toast.entry.id} toast={toast} runner={runner} onDismiss={dismiss} />
          ))}
        </div>
      </div>

      <div className={styles['controls']}>
        <ActionButton
          actionId="notifications.log"
          runner={runner}
          pressed={panel === 'log'}
          onRun={() => {
            setPanel((current) => (current === 'log' ? null : 'log'));
          }}
        />
        <ActionButton
          actionId="notifications.settings"
          runner={runner}
          pressed={panel === 'settings'}
          onRun={() => {
            setPanel((current) => (current === 'settings' ? null : 'settings'));
          }}
        />
        {audio.player.available ? null : (
          <span className={styles['muted']}>{translate('notifications.audioUnavailable')}</span>
        )}
      </div>

      {panel === 'log' ? <EventLog notifications={notifications} locale={locale} /> : null}
      {panel === 'settings' ? <NotificationSettings runner={runner} /> : null}
    </section>
  );
}

function ToastItem({
  toast,
  runner,
  onDismiss,
  urgent = false,
}: {
  readonly toast: Toast;
  readonly runner: ActionRunner;
  readonly onDismiss: (id: number) => void;
  /** Immediate danger is announced assertively as it appears. */
  readonly urgent?: boolean;
}): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const entry = toast.entry;
  return (
    <div
      className={`${styles['toast']} ${styles[entry.severity] ?? ''}`}
      {...(urgent ? { role: 'alert' } : {})}
      data-notification={entry.definitionId}
      data-severity={entry.severity}
    >
      <SeverityIcon severity={entry.severity} className={styles['icon']} />
      <span className={styles['level']}>{translate(`notifications.level.${entry.severity}`)}</span>
      <span className={styles['message']}>{notificationText(entry, translate, locale)}</span>
      {entry.count > 1 ? (
        <span className={styles['count']}>{translate('notifications.count', { count: entry.count })}</span>
      ) : null}
      <ActionButton
        actionId="notifications.dismiss"
        runner={runner}
        label={translate('notifications.dismiss')}
        onRun={() => {
          onDismiss(entry.id);
        }}
      />
    </div>
  );
}
