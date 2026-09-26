import type { JSX } from 'react';

import type { ActionIcon as ActionIconName } from './registry';

/**
 * The shared icon vocabulary (Technical Specification 12.2).
 *
 * Icons are schematic and monochrome: they carry a shape distinction that does
 * not depend on colour, and they are always drawn beside a text label rather
 * than instead of one. Each is `aria-hidden`, because the label is what a
 * screen reader reads.
 */

const PATHS: Readonly<Record<ActionIconName, string>> = {
  station: 'M3 13h18M6 13V7h12v6M9 7V4h6v3M8 13v7M16 13v7',
  market: 'M4 8h16l-1.5 11h-13zM8 8V5a4 4 0 0 1 8 0v3',
  hangar: 'M4 9l8-4 8 4v10H4zM4 9h16M12 5v14',
  fitting: 'M12 4v4M12 16v4M4 12h4M16 12h4M9 9h6v6H9z',
  services: 'M12 4a8 8 0 1 0 8 8M12 8v4l3 2M18 4v4h4',
  ship: 'M12 3l5 8-5 10-5-10zM7 11h10',
  buy: 'M5 12h14M12 5v14',
  sell: 'M5 12h14',
  transfer: 'M4 9h13l-3-3M20 15H7l3 3',
  repair: 'M14 4a4 4 0 0 0-4 6l-6 6 2 2 6-6a4 4 0 0 0 6-4l-3 1-2-2z',
  resupply: 'M12 20V6M6 12l6-6 6 6M4 21h16',
  insurance: 'M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z',
  commit: 'M5 13l4 4 10-10',
  revert: 'M4 9h9a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4',
  clear: 'M6 6l12 12M18 6L6 18',
  inspect: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4',
  compare: 'M12 4v16M6 8L3 14h6zM18 8l-3 6h6z',
  departure: 'M4 20h16M12 17V5M12 5l-4 4M12 5l4 4',
  approach: 'M4 12h11M15 12l-4-4M15 12l-4 4M19 5v14',
  orbit: 'M12 5a7 7 0 1 1-4.9 2M12 3v4h4M18 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  keepRange: 'M5 5v14M19 5v14M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2',
  moveTo: 'M12 4v16M4 12h16M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  stop: 'M7 7h10v10H7z',
  warp: 'M4 12h6M13 4l6 8-6 8M4 8h4M4 16h4',
  retreat: 'M20 12H9M9 12l4-4M9 12l4 4M5 5v14',
  dock: 'M12 4v8M12 12l-3-3M12 12l3-3M5 16h14v4H5z',
  lock: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 2v5M12 17v5M2 12h5M17 12h5',
  unlock: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM5 5l14 14',
  fire: 'M4 12h9M13 8l7 4-7 4zM4 8v8',
  ceaseFire: 'M4 12h9M13 8l7 4-7 4zM3 3l18 18',
  reload: 'M19 12a7 7 0 1 1-2-5M17 3v4h-4',
  ammunition: 'M8 20V9l2-4 2 4v11zM14 20V9l2-4 2 4v11z',
  module: 'M5 5h14v14H5zM9 9h6v6H9zM12 2v3M12 19v3',
  loot: 'M4 9h16v10H4zM4 9l3-4h10l3 4M10 13h4',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4M8 11h6M11 8v6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4M8 11h6',
  centre: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 2v3M12 19v3M2 12h3M19 12h3M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  ranges: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 12h9',
  next: 'M9 5l7 7-7 7',
  previous: 'M15 5l-7 7 7 7',
  play: 'M8 5l11 7-11 7z',
  pause: 'M9 5v14M15 5v14',
  save: 'M5 5h11l3 3v11H5zM8 5v5h7V5M8 19v-5h8v5',
  close: 'M6 6l12 12M18 6L6 18',
  reset: 'M7 7h10l-1 13H8zM10 7V4h4v3M4 7h16',
  guide: 'M12 3v18M12 5h6l2 2-2 2h-6M12 11H6l-2 2 2 2h6M9 21h6',
  log: 'M9 6h11M9 12h11M9 18h11M4 5h2v2H4zM4 11h2v2H4zM4 17h2v2H4z',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
};

export interface ActionIconProps {
  readonly icon: ActionIconName;
  readonly className?: string | undefined;
}

export function ActionIcon({ icon, className }: ActionIconProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[icon]} />
    </svg>
  );
}
