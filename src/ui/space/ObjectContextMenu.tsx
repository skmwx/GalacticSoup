import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { useTranslate } from '../localization';
import styles from './Space.module.css';

/**
 * The contextual commands a secondary click opens
 * (Functional Specification 19.2; Technical Specification 12.3).
 *
 * The menu is a small non-modal panel over the view. On an object it holds the
 * same command list the selected-object panel renders; on empty space it holds
 * the course to that point. It takes focus when it opens, so the keyboard
 * equivalents - the context-menu key or Shift+F10 on an object in the list, or
 * the set-course key for the view - land on its first command, and it gives
 * focus back to where it came from when Escape, a command, a click elsewhere
 * or its close button ends it.
 *
 * It is kept inside the stage it opens over: a click near the right or bottom
 * edge places it to the left of or above the pointer rather than off-screen.
 *
 * @implements FUNC-19.2, FUNC-20, TECH-12.3
 */

export interface ObjectContextMenuProps {
  /** Names the menu for assistive technology. */
  readonly label: string;
  /** Where to place it, in pixels from the top left of the stage. */
  readonly position: { readonly x: number; readonly y: number };
  onClose(): void;
  /** Keys the menu's content handles itself, after Escape. */
  onKeyDown?(event: ReactKeyboardEvent<HTMLDivElement>): void;
  /** Distinguishes an object menu from a point menu, for styling and tests. */
  readonly kind?: 'object' | 'point';
  readonly children: ReactNode;
}

export function ObjectContextMenu({
  label,
  position,
  onClose,
  onKeyDown,
  kind = 'object',
  children,
}: ObjectContextMenuProps): JSX.Element {
  const translate = useTranslate();
  const menu = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [placed, setPlaced] = useState(position);

  useLayoutEffect(() => {
    const element = menu.current;
    const parent = element?.offsetParent;
    if (element === null || !(parent instanceof HTMLElement)) {
      setPlaced(position);
      return;
    }
    const maxX = Math.max(0, parent.clientWidth - element.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - element.offsetHeight);
    setPlaced({
      x: Math.max(0, Math.min(position.x, maxX)),
      y: Math.max(0, Math.min(position.y, maxY)),
    });
  }, [position.x, position.y]);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    const first = menu.current?.querySelector<HTMLElement>("button:not(:disabled):not([aria-disabled='true'])");
    (first ?? menu.current?.querySelector<HTMLElement>('button'))?.focus();

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
      data-context-menu={kind}
      style={{ left: `${String(placed.x)}px`, top: `${String(placed.y)}px` }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close.current();
          return;
        }
        onKeyDown?.(event);
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
