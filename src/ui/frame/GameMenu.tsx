import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';

import { ActionButton, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import styles from './GameMenu.module.css';

/**
 * The game menu behind the settings icon (Functional Specification 19.1, 20;
 * Technical Specification 12.3).
 *
 * The trigger is an icon-only control whose accessible name and tooltip say
 * "Game menu". It opens a non-modal panel holding whatever the current surface
 * offers - guidance, saving and campaign management while a campaign is open -
 * followed by Settings, which is offered everywhere, including before a
 * campaign exists.
 *
 * The panel follows its trigger in the reading order, so Tab moves straight
 * into it. Escape closes it and returns focus to the trigger; a pointer press
 * outside closes it without moving focus. Every close is reported, so a
 * surface can drop a half-finished confirmation such as a reset.
 *
 * @implements FUNC-19.1, FUNC-20, TECH-12.3
 */

export interface GameMenuProps {
  readonly runner: ActionRunner;
  /** The trigger, which Settings returns focus to when it closes. */
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly settingsOpen: boolean;
  readonly onToggleSettings: () => void;
  /** Entries the current surface offers, shown above Settings. */
  readonly children?: ReactNode;
  /** Called whenever the menu closes. */
  readonly onClose?: () => void;
}

/** Space kept between the panel and the bottom of the viewport. */
const FIT_MARGIN_PX = 16;
/** Below this the page scrolls instead; the panel never collapses to nothing. */
const MIN_PANEL_PX = 160;

export function GameMenu({
  runner,
  triggerRef,
  settingsOpen,
  onToggleSettings,
  children,
  onClose,
}: GameMenuProps): JSX.Element {
  const translate = useTranslate();
  const panelId = useId();
  const container = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    onClose?.();
    if (returnFocus) triggerRef.current?.focus();
  }, [onClose, triggerRef]);

  // The panel scrolls within the room left below the trigger, so its last
  // entries stay reachable under a tall, wrapped header at large scales.
  const panel = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const fit = (): void => {
      const trigger = triggerRef.current;
      if (panel.current === null || trigger === null) return;
      const room = window.innerHeight - trigger.getBoundingClientRect().bottom - FIT_MARGIN_PX;
      panel.current.style.maxHeight = `${String(Math.max(MIN_PANEL_PX, room))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
    };
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(true);
    };
    const outside = (event: PointerEvent): void => {
      if (container.current !== null && !container.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, close]);

  return (
    <div className={styles['menu']} ref={container} data-game-menu>
      <ActionButton
        actionId="game.menu"
        runner={runner}
        display="icon"
        expanded={open}
        controls={panelId}
        buttonRef={triggerRef}
        onRun={() => {
          if (open) close(false);
          else setOpen(true);
        }}
      />
      {open ? (
        <div ref={panel} id={panelId} className={styles['body']} role="group" aria-label={translate('action.game.menu')}>
          {children}
          <ActionButton
            actionId="preferences.open"
            runner={runner}
            pressed={settingsOpen}
            onRun={() => {
              close(false);
              onToggleSettings();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
