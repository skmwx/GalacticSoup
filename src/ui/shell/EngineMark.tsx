import type { JSX } from 'react';

/**
 * Schematic mark drawn as inline SVG.
 *
 * The interface uses SVG elements directly rather than image assets, which is
 * the same technique the later space, system and galaxy views use
 * (Technical Specification 3.1, 12.2).
 */
export interface EngineMarkProps {
  readonly className?: string | undefined;
}

export function EngineMark({ className }: EngineMarkProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      role="img"
      aria-hidden="true"
      focusable="false"
      width="48"
      height="48"
    >
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="5" fill="currentColor" />
      <ellipse
        cx="24"
        cy="24"
        rx="21"
        ry="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        transform="rotate(-24 24 24)"
        opacity="0.7"
      />
      <circle cx="43" cy="16" r="2.5" fill="currentColor" />
    </svg>
  );
}
