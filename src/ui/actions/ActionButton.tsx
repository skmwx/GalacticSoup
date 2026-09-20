import { useId, type JSX, type ReactNode } from 'react';

import type { MessageKey } from '@shared';

import { useTranslate } from '../localization';
import { ActionIcon } from './ActionIcon';
import styles from './ActionButton.module.css';
import { actionById } from './registry';
import type { ActionRunner } from './useActionRunner';

/**
 * One registered action as a control (Technical Specification 12.3).
 *
 * The button takes its label, icon and shortcut from the registry and its
 * availability from a projection, so what it offers and what the engine
 * permits cannot drift apart. When an action is unavailable the button stays
 * visible and says why, because a control that disappears teaches the player
 * nothing (Functional Specification 22.10).
 *
 * @implements TECH-12.3, FUNC-22.10
 */

export interface ActionButtonProps {
  readonly actionId: string;
  readonly runner: ActionRunner;
  readonly onRun: () => void | Promise<void>;
  /** False disables the control; the reason below says why. */
  readonly available?: boolean;
  readonly unavailableReason?: MessageKey | null;
  /** Overrides the registry label, for a control that names its subject. */
  readonly label?: string;
  readonly variant?: 'primary' | 'quiet' | 'danger';
  readonly pressed?: boolean;
  readonly children?: ReactNode;
}

export function ActionButton({
  actionId,
  runner,
  onRun,
  available = true,
  unavailableReason = null,
  label,
  variant = 'quiet',
  pressed,
  children,
}: ActionButtonProps): JSX.Element {
  const translate = useTranslate();
  const action = actionById(actionId);
  const reasonId = useId();
  const pending = runner.isPending(actionId);
  const disabled = !available || pending;
  const reason = !available && unavailableReason !== null ? translate(unavailableReason) : null;

  return (
    <span className={styles['wrapper']}>
      <button
        type="button"
        className={`${styles['button']} ${styles[variant] ?? ''}`}
        data-action={action.id}
        disabled={disabled}
        {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
        {...(reason === null ? {} : { 'aria-describedby': reasonId })}
        onClick={() => {
          runner.run(actionId, async () => {
            await onRun();
          });
        }}
      >
        <ActionIcon icon={action.icon} className={styles['icon']} />
        <span className={styles['label']}>{label ?? translate(action.labelKey)}</span>
        {action.shortcut === null ? null : (
          <kbd className={styles['shortcut']}>{action.shortcut.toUpperCase()}</kbd>
        )}
        {pending ? <span className={styles['pending']}>{translate('action.pending')}</span> : null}
      </button>
      {reason === null ? null : (
        <span id={reasonId} className={styles['reason']}>
          {reason}
        </span>
      )}
      {children}
    </span>
  );
}
