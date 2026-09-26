import { useId, type JSX, type ReactNode } from 'react';

import type { MessageKey } from '@shared';

import { useTranslate } from '../localization';
import { ActionIcon } from './ActionIcon';
import styles from './ActionButton.module.css';
import { keyLabel } from './bindings';
import { actionById } from './registry';
import { useBinding } from './shortcuts';
import type { ActionRunner } from './useActionRunner';

/**
 * One registered action as a control (Technical Specification 12.3).
 *
 * The button takes its label and icon from the registry, its shortcut from
 * the player's bindings and its availability from a projection, so what it
 * offers and what the engine permits cannot drift apart. The key is drawn on
 * the button and announced as its keyboard shortcut. When an action is unavailable the button stays
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
  const key = useBinding(actionId);
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
        {...(key === null ? {} : { 'aria-keyshortcuts': keyLabel(key) })}
        onClick={() => {
          runner.run(actionId, async () => {
            await onRun();
          });
        }}
      >
        <ActionIcon icon={action.icon} className={styles['icon']} />
        <span className={styles['label']}>{label ?? translate(action.labelKey)}</span>
        {key === null ? null : (
          <kbd className={styles['shortcut']}>{keyLabel(key)}</kbd>
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
