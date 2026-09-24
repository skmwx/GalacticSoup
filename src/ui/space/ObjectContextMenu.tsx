import { useEffect, useRef, type JSX, type ReactNode } from 'react';

import { useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * The contextual commands a secondary click opens
 * (Functional Specification 19.2; Technical Specification 12.3).
 *
 * The menu is a small non-modal panel over the view holding the same command
 * list the selected-object panel renders. It takes focus when it opens, so the
 * keyboard equivalent - the context-menu key or Shift+F10 on an object in the
 * list - lands on its first command, and it gives focus back to where it came
 * from when Escape, a command, a click elsewhere or its close button ends it.
 *
 * @implements FUNC-19.2, FUNC-20, TECH-12.3
 */

export interface ObjectContextMenuProps {
  /** Names the menu for assistive technology. */
  readonly label: string;
  /** Where to place it, in pixels from the top left of the stage. */
  readonly position: { readonly x: number; readonly y: number };
  onClose(): void;
  readonly children: ReactNode;
}

export function ObjectContextMenu({
  label,
  position,
  onClose,
  children,
}: ObjectContextMenuProps): JSX.Element {
  const translate = useTranslate();
  const menu = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    returnFocus.current = document.activeElement;
    const first = menu.current?.querySelector<HTMLElement>('button:not(:disabled)');
    first?.focus();

    const onPointerDown = (event: PointerEvent): void => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) {
        close.current();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      const previous = returnFocus.current;
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  return (
    <div
      ref={menu}
      className={styles['contextMenu']}
      role="group"
      aria-label={label}
      data-context-menu="true"
      style={{ left: `${String(position.x)}px`, top: `${String(position.y)}px` }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close.current();
        }
      }}
    >
      <p className={styles['panelHeading']}>{label}</p>
      {children}
      <button
        type="button"
        className={styles['objectButton']}
        onClick={() => {
          close.current();
        }}
      >
        {translate('tactical.menu.close')}
      </button>
    </div>
  );
}
