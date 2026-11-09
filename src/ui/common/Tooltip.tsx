import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import styles from './Tooltip.module.css';

/**
 * A shared hover-and-focus tooltip (Technical Specification 12.3, 12.5;
 * Functional Specification 22.10).
 *
 * Why a control is unavailable, and what an icon-only control does, is
 * explained in a tooltip rather than beside the control, so a refusal never
 * pushes its neighbours around. The tooltip:
 *
 * - opens on pointer hover and on keyboard focus of its anchor, and stays open
 *   while the pointer moves onto it (WCAG 1.4.13);
 * - is drawn in a portal with fixed positioning, outside normal document flow,
 *   and is clamped to the viewport;
 * - is dismissed with Escape without moving focus. The Escape is not consumed,
 *   so it still closes a dialog or menu the anchor sits in, as it did before;
 * - announces its description through `aria-describedby` on the control. The
 *   description lives in a visually hidden element that is always present, so
 *   assistive technology hears it whether or not the visual popup is open, and
 *   the popup itself is hidden from the accessibility tree so the text is not
 *   read twice. Native `title` is not used.
 *
 * @implements TECH-12.3, TECH-12.5, FUNC-22.10
 */

export interface TooltipContent {
  /**
   * Text announced as the control's description, and shown in the popup.
   * `null` when there is nothing to describe.
   */
  readonly description?: string | null;
  /**
   * Content shown in the popup only, above the description: an icon-only
   * control's name and shortcut, which its accessible name already carries.
   */
  readonly heading?: ReactNode;
}

export interface TooltipAnchorProps {
  readonly ref: (element: HTMLElement | null) => void;
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly onFocus: (event: FocusEvent) => void;
  readonly onBlur: (event: FocusEvent) => void;
}

export interface Tooltip {
  /** True when the tooltip has anything to show. */
  readonly active: boolean;
  /** The id to put in the described control's `aria-describedby`, if any. */
  readonly describedBy: string | undefined;
  /** Spread on the element the tooltip is anchored to (usually a wrapper). */
  readonly anchorProps: TooltipAnchorProps;
  /** Render once, anywhere inside the anchor's component. */
  readonly element: JSX.Element | null;
}

/** How long the pointer may take to cross the gap between anchor and popup. */
const HIDE_DELAY_MS = 120;
/** The distance kept between the popup and the anchor or the viewport edge. */
const GAP_PX = 6;
const MARGIN_PX = 8;

/**
 * Only one tooltip is open at a time: opening one (say by hover) closes the
 * one another control opened (say by keyboard focus), so they never overlap.
 */
let closeOpenTooltip: (() => void) | null = null;

interface Position {
  readonly left: number;
  readonly top: number;
}

export function useTooltip({ description = null, heading }: TooltipContent): Tooltip {
  const descriptionId = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  const hasDescription = description !== null && description.length > 0;
  const hasHeading = heading !== undefined && heading !== null && heading !== false;
  const active = hasDescription || hasHeading;
  const open = active && (hovered || focused) && !dismissed;

  const cancelHide = (): void => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  useEffect(() => cancelHide, []);

  const place = useCallback((): void => {
    const target = anchor.current;
    const box = popup.current;
    if (target === null || box === null) return;
    const rect = target.getBoundingClientRect();
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;

    const centred = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(MARGIN_PX, Math.min(centred, viewportWidth - width - MARGIN_PX));
    const below = rect.bottom + GAP_PX;
    const above = rect.top - GAP_PX - height;
    const top =
      below + height <= viewportHeight - MARGIN_PX || above < MARGIN_PX
        ? Math.max(MARGIN_PX, Math.min(below, viewportHeight - height - MARGIN_PX))
        : above;
    setPosition((previous) =>
      previous !== null && previous.left === left && previous.top === top ? previous : { left, top },
    );
  }, []);

  // Placement follows every render while open, because the content (a
  // pending label, a changed reason) can change the popup's size.
  useLayoutEffect(() => {
    if (open) place();
  });

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    const close = (): void => {
      setDismissed(true);
    };
    closeOpenTooltip?.();
    closeOpenTooltip = close;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The key is not consumed: whatever else Escape does (closing the
      // dialog or menu the control sits in) still happens, so a keyboard
      // player never needs a second press because a tooltip was showing.
      setDismissed(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      if (closeOpenTooltip === close) closeOpenTooltip = null;
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const anchorProps: TooltipAnchorProps = {
    ref: (element) => {
      anchor.current = element;
    },
    onMouseEnter: () => {
      // A fresh entry (not a crossing between anchor and popup) reopens a
      // tooltip that Escape or another tooltip closed.
      if (hideTimer.current === null) setDismissed(false);
      cancelHide();
      setHovered(true);
    },
    onMouseLeave: () => {
      cancelHide();
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        setHovered(false);
        setDismissed(false);
      }, HIDE_DELAY_MS);
    },
    onFocus: () => {
      setFocused(true);
      setDismissed(false);
    },
    onBlur: (event) => {
      if (event.relatedTarget instanceof Node && anchor.current?.contains(event.relatedTarget)) {
        return;
      }
      setFocused(false);
      if (!hovered) setDismissed(false);
    },
  };

  const element = !active ? null : (
    <>
      {hasDescription ? (
        <span id={descriptionId} className={styles['description']}>
          {description}
        </span>
      ) : null}
      {open
        ? createPortal(
            <div
              ref={popup}
              className={styles['tooltip']}
              aria-hidden="true"
              data-tooltip=""
              style={
                position === null
                  ? { left: 0, top: 0, visibility: 'hidden' }
                  : { left: position.left, top: position.top }
              }
              onMouseEnter={anchorProps.onMouseEnter}
              onMouseLeave={anchorProps.onMouseLeave}
            >
              {hasHeading ? <div className={styles['heading']}>{heading}</div> : null}
              {hasDescription ? <div className={styles['reason']}>{description}</div> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );

  return {
    active,
    describedBy: hasDescription ? descriptionId : undefined,
    anchorProps,
    element,
  };
}

/** Joins `aria-describedby` ids, dropping the absent ones. */
export function describedBy(...ids: readonly (string | null | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return present.length === 0 ? undefined : present.join(' ');
}
