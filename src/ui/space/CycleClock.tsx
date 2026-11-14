import type { JSX } from 'react';

import { useTooltip } from '../common/Tooltip';
import styles from './Space.module.css';

/**
 * A round clock for one module or weapon cycle
 * (Functional Specification 9.4, 9.8, 19.3).
 *
 * A wedge fills clockwise from twelve o'clock as the running cycle passes, so
 * how far a booster or a gun is into its cycle reads at a glance instead of
 * as a number. The state is also a shape, not only a colour: a dashed ring
 * while reloading, a ring with a bar while waiting for capacitor, and a ring
 * with a cross when stopped for a reason. The exact time is in words
 * for assistive technology and in a hover tooltip; the clock is drawn from
 * the projected remaining time and never measures time itself.
 *
 * @implements FUNC-9.4, FUNC-9.8, FUNC-19.3
 */

export type CycleClockState = 'idle' | 'running' | 'stopping' | 'reloading' | 'waiting' | 'stopped';

export interface CycleClockProps {
  readonly state: CycleClockState;
  /** How much of the running cycle has passed, from 0 to 1; ignored unless cycling. */
  readonly elapsed: number;
  /** What the clock shows, in words. */
  readonly label: string;
}

const RADIUS = 8;
const CENTRE = 10;

/** The pie wedge for a fraction of a turn, starting at twelve o'clock. */
function wedge(fraction: number): string | null {
  const turn = Math.min(1, Math.max(0, fraction));
  if (turn <= 0) {
    return null;
  }
  if (turn >= 0.999) {
    return `M${String(CENTRE)} ${String(CENTRE - RADIUS)}a${String(RADIUS)} ${String(RADIUS)} 0 1 1 0 ${String(2 * RADIUS)}a${String(RADIUS)} ${String(RADIUS)} 0 1 1 0 ${String(-2 * RADIUS)}z`;
  }
  const angle = turn * 2 * Math.PI;
  const x = CENTRE + RADIUS * Math.sin(angle);
  const y = CENTRE - RADIUS * Math.cos(angle);
  const large = turn > 0.5 ? 1 : 0;
  return `M${String(CENTRE)} ${String(CENTRE)}V${String(CENTRE - RADIUS)}A${String(RADIUS)} ${String(RADIUS)} 0 ${String(large)} 1 ${x.toFixed(2)} ${y.toFixed(2)}z`;
}

export function CycleClock({ state, elapsed, label }: CycleClockProps): JSX.Element {
  const tooltip = useTooltip({ heading: <span>{label}</span> });
  const cycling = state === 'running' || state === 'stopping';
  const fill = cycling ? wedge(elapsed) : null;

  return (
    <span className={styles['cycleClock']} data-clock={state} {...tooltip.anchorProps}>
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
        <circle
          className={styles['clockRing']}
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          {...(state === 'reloading' ? { strokeDasharray: '3 2' } : {})}
        />
        {fill === null ? null : <path className={styles['clockFill']} d={fill} />}
        {state === 'waiting' ? <path className={styles['clockMark']} d="M10 5v6M10 14v1" /> : null}
        {state === 'stopped' ? <path className={styles['clockMark']} d="M7 7l6 6M13 7l-6 6" /> : null}
      </svg>
      <span className={styles['visuallyHidden']}>{label}</span>
      {tooltip.element}
    </span>
  );
}
