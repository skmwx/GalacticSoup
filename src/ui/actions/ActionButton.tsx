import type { JSX, ReactNode, Ref } from 'react';

import type { MessageKey } from '@shared';

import { describedBy, useTooltip } from '../common/Tooltip';
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
 * the button and announced as its keyboard shortcut.
 *
 * When an action is unavailable the button stays visible and says why, because
 * a control that disappears teaches the player nothing (Functional
 * Specification 22.10). The reason is a tooltip, shown on hover and on keyboard
 * focus, rather than text beside the button, so a refusal does not reflow the
 * controls around it. For that to work by keyboard the button is marked
 * `aria-disabled` rather than natively disabled - a native disabled button
 * cannot take focus - and activation is refused here instead, by pointer and
 * keyboard alike, while it is unavailable or its command is in flight.
 *
 * The `icon` presentation draws the icon alone, for dense rows. Its accessible
 * name is still the full label (including any item it names), and its name and
 * shortcut appear in the tooltip instead of on the button.
 *
 * The `short` presentation draws a brief word (`shortLabel`) without the
 * icon, for a row of related controls that would otherwise share one icon,
 * such as the One, All and Max transfers. The short word must appear in the
 * full label, so the visible text is part of the accessible name (WCAG 2.5.3);
 * the full label is the name and the tooltip heading, as for an icon-only
 * control.
 *
 * @implements TECH-12.3, FUNC-22.10
 */

export interface ActionButtonProps {
  readonly actionId: string;
  readonly runner: ActionRunner;
  readonly onRun: () => void | Promise<void>;
  /** False makes the control unavailable; the tooltip says why. */
  readonly available?: boolean;
  readonly unavailableReason?: MessageKey | null;
  /** Overrides the registry label, for a control that names its subject. */
  readonly label?: string;
  readonly variant?: 'primary' | 'quiet' | 'danger';
  /**
   * `icon` draws the icon only and `short` draws `shortLabel` only; in both
   * the label becomes the accessible name and the tooltip heading.
   */
  readonly display?: 'full' | 'icon' | 'short';
  /** The visible word of the `short` presentation; it must appear in `label`. */
  readonly shortLabel?: string;
  readonly pressed?: boolean;
  /** For a control that shows and hides a panel: whether it is shown. */
  readonly expanded?: boolean;
  /** The id of the panel an `expanded` control shows. */
  readonly controls?: string;
  readonly buttonRef?: Ref<HTMLButtonElement>;
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
  display = 'full',
  shortLabel,
  pressed,
  expanded,
  controls,
  buttonRef,
  children,
}: ActionButtonProps): JSX.Element {
  const translate = useTranslate();
  const action = actionById(actionId);
  const key = useBinding(actionId);
  const pending = runner.isPending(actionId);
  const disabled = !available || pending;
  const iconOnly = display === 'icon';
  const shortOnly = display === 'short';
  // Both compact presentations give their full name only through the
  // accessible name and the tooltip.
  const compact = iconOnly || shortOnly;
  const name = label ?? translate(action.labelKey);
  // A full button shows its pending state as text; a compact one says it in
  // the tooltip instead.
  const reason = !available
    ? translate(unavailableReason ?? 'shortcut.unavailable')
    : pending && compact
      ? translate('action.pending')
      : null;
  // While a compact control's panel is open its name tooltip would cover
  // the panel, so only a reason is shown then.
  const tooltip = useTooltip({
    description: reason,
    heading: compact && expanded !== true ? (
      <>
        <span>{name}</span>
        {key === null ? null : <kbd>{keyLabel(key)}</kbd>}
      </>
    ) : undefined,
  });

  return (
    <span className={styles['wrapper']} {...tooltip.anchorProps}>
      <button
        type="button"
        ref={buttonRef}
        className={`${styles['button']} ${styles[variant] ?? ''} ${iconOnly ? (styles['iconOnly'] ?? '') : ''} ${shortOnly ? (styles['shortOnly'] ?? '') : ''}`}
        data-action={action.id}
        aria-disabled={disabled ? true : undefined}
        aria-describedby={describedBy(tooltip.describedBy)}
        {...(compact ? { 'aria-label': name } : {})}
        {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
        {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
        {...(controls === undefined ? {} : { 'aria-controls': controls })}
        {...(key === null ? {} : { 'aria-keyshortcuts': keyLabel(key) })}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          runner.run(actionId, async () => {
            await onRun();
          });
        }}
      >
        {shortOnly ? null : <ActionIcon icon={action.icon} className={styles['icon']} />}
        {iconOnly ? null : (
          <span className={styles['label']}>{shortOnly ? (shortLabel ?? name) : name}</span>
        )}
        {key === null || compact ? null : (
          <kbd className={styles['shortcut']}>{keyLabel(key)}</kbd>
        )}
        {pending && !compact ? (
          <span className={styles['pending']}>{translate('action.pending')}</span>
        ) : null}
      </button>
      {tooltip.element}
      {children}
    </span>
  );
}
