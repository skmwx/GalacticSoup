import { useCallback, useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import type { MessageKey } from '@shared';

import { ActionButton, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import styles from './Station.module.css';

/**
 * A small icon control that drops down a list of choices, for the fitting
 * screen's per-slot module and ammunition pickers (UIR1-05; Functional
 * Specification 8.4; Technical Specification 12.3).
 *
 * The trigger is an icon-only action with a full accessible name. Opening it
 * may first need work - the fitting screen opens its engine draft lazily - so
 * the list says it is loading until its choices arrive. The list follows the
 * trigger in the reading order; focus moves to the current choice when it
 * opens, the arrow keys move between choices, and Escape or a pointer press
 * outside closes it. Escape and a choice return focus to the trigger.
 *
 * It decides nothing: the choices, their details and which is current are the
 * caller's, and the caller's are the engine's.
 *
 * @implements FUNC-8.4, TECH-12.3
 */

export interface PickerChoice {
  /** Opaque value handed back on choice. */
  readonly value: string;
  readonly label: string;
  /** A second line: availability, fitting cost or what the choice does. */
  readonly detail?: string | null;
  readonly current: boolean;
}

export interface ChoicePickerProps {
  readonly actionId: string;
  readonly runner: ActionRunner;
  /** The trigger's accessible name and tooltip heading. */
  readonly label: string;
  /** The accessible name of the open list. */
  readonly listLabel: string;
  readonly available?: boolean;
  readonly unavailableReason?: MessageKey | null;
  /** `null` while the choices are still loading. */
  readonly choices: readonly PickerChoice[] | null;
  /** Called as the list opens, before it is shown. */
  readonly onOpen?: () => Promise<void>;
  readonly onChoose: (value: string) => void;
}

export function ChoicePicker({
  actionId,
  runner,
  label,
  listLabel,
  available = true,
  unavailableReason = null,
  choices,
  onOpen,
  onChoose,
}: ChoicePickerProps): JSX.Element {
  const translate = useTranslate();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const focusedOnOpen = useRef(false);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) {
      focusedOnOpen.current = false;
      return undefined;
    }
    const dismiss = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close(true);
    };
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (list.current?.contains(target) !== true && trigger.current?.contains(target) !== true) {
        close(false);
      }
    };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, close]);

  // Focus moves into the list once its choices have arrived, onto the
  // current choice when there is one.
  useEffect(() => {
    if (!open || choices === null || focusedOnOpen.current || list.current === null) return;
    const buttons = [...list.current.querySelectorAll<HTMLButtonElement>('button')];
    const current = buttons.find((button) => button.getAttribute('aria-pressed') === 'true');
    (current ?? buttons[0])?.focus();
    focusedOnOpen.current = true;
  }, [open, choices]);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % buttons.length
            : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  // The list is the trigger's sibling, not its child, so the trigger's
  // tooltip stays with the trigger instead of covering the list.
  return (
    <span className={styles['pickerAnchor']}>
      <ActionButton
        actionId={actionId}
        runner={runner}
        display="icon"
        label={label}
        available={available}
        unavailableReason={unavailableReason}
        expanded={open}
        controls={listId}
        buttonRef={trigger}
        onRun={async () => {
          if (open) {
            close(false);
            return;
          }
          setOpen(true);
          await onOpen?.();
        }}
      />
      {open ? (
        <div
          ref={list}
          id={listId}
          className={styles['picker']}
          role="group"
          aria-label={listLabel}
          onKeyDown={onListKeyDown}
          data-picker
        >
          {choices === null ? (
            <p className={styles['muted']} role="status">
              {translate('fitting.loadingChoices')}
            </p>
          ) : (
            choices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={styles['pickerChoice']}
                aria-pressed={choice.current}
                data-value={choice.value}
                onClick={() => {
                  close(true);
                  if (!choice.current) onChoose(choice.value);
                }}
              >
                <span>{choice.label}</span>
                {choice.detail === undefined || choice.detail === null ? null : (
                  <small className={styles['muted']}>{choice.detail}</small>
                )}
              </button>
            ))
          )}
        </div>
      ) : null}
    </span>
  );
}
