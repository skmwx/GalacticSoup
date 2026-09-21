import { useEffect, useState } from 'react';

/**
 * Whether the player asked for reduced motion (Functional Specification 20).
 *
 * Presentation reads it; simulation never does. The query is optional at
 * runtime - a test renderer may not implement `matchMedia` - and its absence
 * means only that no preference was expressed.
 *
 * @implements FUNC-20, TECH-12.2
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

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
