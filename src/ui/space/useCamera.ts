import { useCallback, useMemo, useRef, useState } from 'react';

import {
  clampZoom,
  framing,
  panned,
  zoomedBy,
  ZOOM_STEP,
  type Camera,
  type Point,
  type Viewport,
} from './camera';

/**
 * The camera as presentation state (Technical Specification 12.1, 12.2).
 *
 * Where the player is looking and how far they are zoomed in is theirs alone:
 * no command carries it and no save records it. Following keeps the ship
 * centred; panning by hand turns following off, and the centre action turns it
 * back on.
 *
 * @implements TECH-12.1, TECH-12.2
 */

export interface CameraControl {
  readonly camera: Camera;
  readonly following: boolean;
  zoomIn(): void;
  zoomOut(): void;
  /** Centres on a world point and resumes following. */
  centreOn(point: Point): void;
  /** Moves the centre without changing whether the camera follows. */
  track(point: Point): void;
  panBy(deltaPx: Point): void;
  /** Frames every point, keeping the first centred, and resumes following. */
  frame(viewport: Viewport, points: readonly Point[]): void;
}

export const DEFAULT_PIXELS_PER_KM = 12;

export function useCamera(initialPixelsPerKm = DEFAULT_PIXELS_PER_KM): CameraControl {
  const [camera, setCamera] = useState<Camera>({
    centreKm: { x: 0, y: 0 },
    pixelsPerKm: clampZoom(initialPixelsPerKm),
  });
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  followingRef.current = following;

  const zoomIn = useCallback(() => {
    setCamera((previous) => zoomedBy(previous, ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setCamera((previous) => zoomedBy(previous, 1 / ZOOM_STEP));
  }, []);

  const centreOn = useCallback((point: Point) => {
    setFollowing(true);
    setCamera((previous) => ({ ...previous, centreKm: point }));
  }, []);

  const track = useCallback((point: Point) => {
    setCamera((previous) =>
      previous.centreKm.x === point.x && previous.centreKm.y === point.y
        ? previous
        : { ...previous, centreKm: point },
    );
  }, []);

  const panBy = useCallback((deltaPx: Point) => {
    setFollowing(false);
    setCamera((previous) => panned(previous, deltaPx));
  }, []);

  const frame = useCallback((viewport: Viewport, points: readonly Point[]) => {
    setFollowing(true);
    setCamera((previous) => framing(viewport, points, previous.pixelsPerKm));
  }, []);

  return useMemo(
    () => ({ camera, following, zoomIn, zoomOut, centreOn, track, panBy, frame }),
    [camera, following, zoomIn, zoomOut, centreOn, track, panBy, frame],
  );
}
