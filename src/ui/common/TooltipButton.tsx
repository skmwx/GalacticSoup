import type { ButtonHTMLAttributes, JSX, MouseEvent, Ref } from 'react';

import { describedBy, useTooltip } from './Tooltip';

/**
 * A plain button that can be unavailable and say why in a tooltip
 * (Technical Specification 12.3; Functional Specification 22.10).
 *
 * For controls that are not registered actions - station tabs, campaign and
 * settings controls - but follow the same rule as `ActionButton`: an
 * unavailable control stays visible and focusable (`aria-disabled`, not native
 * `disabled`), refuses activation, and explains itself on hover and keyboard
 * focus without taking space in the layout.
 *
 * @implements TECH-12.3, FUNC-22.10
 */

export interface TooltipButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'ref'> {
  /** True makes the button unavailable: it refuses activation and says why. */
  readonly unavailable?: boolean;
  /** The translated reason, shown in the tooltip while unavailable. */
  readonly reason?: string | null;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}

export function TooltipButton({
  unavailable = false,
  reason = null,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  buttonRef,
  type = 'button',
  'aria-describedby': ownDescribedBy,
  children,
  ...rest
}: TooltipButtonProps): JSX.Element {
  const tooltip = useTooltip({ description: unavailable ? reason : null });
  const { anchorProps } = tooltip;

  return (
    <>
      <button
        {...rest}
        type={type}
        ref={(element) => {
          anchorProps.ref(element);
          if (typeof buttonRef === 'function') buttonRef(element);
          else if (buttonRef !== null && buttonRef !== undefined) buttonRef.current = element;
        }}
        aria-disabled={unavailable ? true : undefined}
        aria-describedby={describedBy(ownDescribedBy, tooltip.describedBy)}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (unavailable) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        onMouseEnter={(event) => {
          anchorProps.onMouseEnter();
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          anchorProps.onMouseLeave();
          onMouseLeave?.(event);
        }}
        onFocus={(event) => {
          anchorProps.onFocus(event);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          anchorProps.onBlur(event);
          onBlur?.(event);
        }}
      >
        {children}
      </button>
      {tooltip.element}
    </>
  );
}
