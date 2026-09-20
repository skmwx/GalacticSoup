import { useCallback, useEffect, useId, useRef, type JSX, type ReactNode } from 'react';

import { useTranslate } from '../localization';
import styles from './Dialog.module.css';

/**
 * A modal confirmation (Technical Specification 12.3;
 * Functional Specification 19.5).
 *
 * A modal traps focus, closes on Escape and returns focus to whatever opened
 * it, so a keyboard player is never left with the focus ring somewhere behind
 * an overlay. Non-modal panels do none of that, which is why this component is
 * used only where the specification asks for a confirmation.
 *
 * @implements TECH-12.3
 */

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** The confirming control and any secondary controls, in reading order. */
  readonly footer?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, title, onClose, children, footer }: DialogProps): JSX.Element | null {
  const translate = useTranslate();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const focusables = useCallback(
    (): readonly HTMLElement[] =>
      panel.current === null ? [] : [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)],
    [],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusables()[0] ?? panel.current;
    first?.focus();

    return () => {
      // Focus returns to the control that opened the dialog, not to the
      // document, so the player keeps their place.
      opener.current?.focus();
    };
  }, [open, focusables]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusables();
      if (items.length === 0) {
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose, focusables]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles['backdrop']}>
      <div
        className={styles['panel']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
        tabIndex={-1}
      >
        <div className={styles['header']}>
          <h3 id={titleId} className={styles['title']}>
            {title}
          </h3>
          <button
            type="button"
            className={styles['dismiss']}
            onClick={onClose}
            aria-label={translate('dialog.dismiss')}
          >
            ×
          </button>
        </div>
        <div className={styles['body']}>{children}</div>
        {footer === undefined ? null : <div className={styles['footer']}>{footer}</div>}
      </div>
    </div>
  );
}
