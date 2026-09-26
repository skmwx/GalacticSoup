import { useEffect, useState } from 'react';

import { usePreferences } from './PreferencesProvider';

/**
 * Whether the interface should move as little as it can
 * (Functional Specification 20; Technical Specification 12.2).
 *
 * The player's own motion setting wins; left at "follow the system" it is the
 * browser's `prefers-reduced-motion`. Presentation reads it; simulation never
 * does. The media query is optional at runtime - a test renderer may not
 * implement `matchMedia` - and its absence means only that no preference was
 * expressed.
 *
 * @implements FUNC-20, TECH-12.2
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const { preferences } = usePreferences();
  const system = usePrefersReducedMotion();
  switch (preferences.display.motion) {
    case 'reduced':
      return true;
    case 'full':
      return false;
    default:
      return system;
  }
}

/** The browser's own `prefers-reduced-motion`, followed as it changes. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matches());

  useEffect(() => {
    const query = mediaQuery();
    if (query === null) {
      return undefined;
    }
    const listener = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => {
      query.removeEventListener('change', listener);
    };
  }, []);

  return reduced;
}

function mediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

function matches(): boolean {
  return mediaQuery()?.matches ?? false;
}
