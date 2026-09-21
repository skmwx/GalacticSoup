import { useEffect, useRef, useState } from 'react';

import type { SiteData } from '@protocol';

import type { Point } from './camera';

/**
 * Presentational interpolation between authoritative projection frames
 * (Technical Specification 12.2).
 *
 * The engine publishes a position and a velocity at a simulation instant. A
 * renderer that drew only those would step; this carries each object forward
 * along its published velocity until the next frame arrives, and never
 * further than one short cap, so the drawing leads authority by a few frames
 * at most and by nothing at all once the ship stops.
 *
 * It changes nothing. Ranges, commands and every number the player reads come
 * from the projection; only the drawn position is smoothed. Paused simulation
 * and reduced motion both switch it off, which is what lets a later phase
 * expose reduced motion as a setting without touching simulation timing.
 *
 * @implements TECH-12.2, FUNC-20
 */

/** Never lead the published position by more than this. */
export const MAX_EXTRAPOLATION_MS = 250;

export type SitePositions = Readonly<Record<string, Point>>;

export interface SiteMotionOptions {
  readonly site: SiteData | null;
  /** No simulation time passes while paused, so nothing may be carried forward. */
  readonly paused: boolean;
  readonly reducedMotion: boolean;
  /** Monotonic real clock, injected so tests need no timer. */
  readonly now?: () => number;
}

export function useSiteMotion(options: SiteMotionOptions): SitePositions {
  const { site, paused, reducedMotion } = options;
  const now = options.now ?? defaultNow;
  const published = publishedPositions(site);
  const [interpolated, setInterpolated] = useState<SitePositions>(published);
  const frame = useRef(published);
  frame.current = published;
  const arrivedAt = useRef(now());
  const revision = site?.revision ?? -1;

  useEffect(() => {
    arrivedAt.current = now();
    // The published frame is the truth; interpolation only leads it.
    setInterpolated(frame.current);
    // Keyed by the projection revision: the published frame is read through a
    // ref, and the clock is injected and stable.
  }, [revision]);

  const moving = site?.site?.objects.some(
    (object) => object.velocity.x !== 0 || object.velocity.y !== 0,
  ) ?? false;
  const active = moving && !paused && !reducedMotion;

  useEffect(() => {
    if (!active || typeof requestAnimationFrame !== 'function') {
      return undefined;
    }
    let handle = 0;
    const step = (): void => {
      const elapsedMs = Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, now() - arrivedAt.current));
      setInterpolated(advanced(frame.current, site, elapsedMs));
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [active, revision]);

  return active ? interpolated : published;
}

function publishedPositions(site: SiteData | null): SitePositions {
  const positions: Record<string, Point> = {};
  for (const object of site?.site?.objects ?? []) {
    positions[object.id] = { x: object.position.x, y: object.position.y };
  }
  return positions;
}

function advanced(
  positions: SitePositions,
  site: SiteData | null,
  elapsedMs: number,
): SitePositions {
  const seconds = elapsedMs / 1000;
  const next: Record<string, Point> = {};
  for (const object of site?.site?.objects ?? []) {
    const base = positions[object.id] ?? { x: object.position.x, y: object.position.y };
    next[object.id] = {
      x: base.x + object.velocity.x * seconds,
      y: base.y + object.velocity.y * seconds,
    };
  }
  return next;
}

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
