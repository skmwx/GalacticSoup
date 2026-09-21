import { describe, expect, it } from 'vitest';

import {
  clampZoom,
  framing,
  labelVisible,
  LABEL_MINIMUM_PIXELS_PER_KM,
  MAX_PIXELS_PER_KM,
  MIN_PIXELS_PER_KM,
  offScreenMarker,
  panned,
  ringSpacingKm,
  screenToWorld,
  worldToScreen,
  zoomedBy,
  ZOOM_STEP,
  type Camera,
  type Viewport,
} from '@ui';

/**
 * The camera transform (Functional Specification 19.2;
 * Technical Specification 12.2).
 *
 * Zoom changes display scale and nothing else, so every case here is
 * arithmetic: a world point maps to a pixel, the pixel maps back, and an
 * object the camera does not show gets an edge marker pointing at it.
 */

const VIEWPORT: Viewport = { widthPx: 800, heightPx: 400 };
const CAMERA: Camera = { centreKm: { x: 0, y: 0 }, pixelsPerKm: 10 };

describe('camera transform', () => {
  it('draws the camera centre at the middle of the viewport [TECH-12.2, FUNC-19.2]', () => {
    expect(worldToScreen(CAMERA, VIEWPORT, { x: 0, y: 0 })).toEqual({ x: 400, y: 200 });
  });

  it('inverts the vertical axis, because world y points up [TECH-12.2]', () => {
    const above = worldToScreen(CAMERA, VIEWPORT, { x: 0, y: 5 });
    const below = worldToScreen(CAMERA, VIEWPORT, { x: 0, y: -5 });

    expect(above.y).toBe(150);
    expect(below.y).toBe(250);
  });

  it('round-trips a screen point back to the world [TECH-12.2]', () => {
    const point = { x: 123, y: 77 };
    const world = screenToWorld(CAMERA, VIEWPORT, point);

    expect(worldToScreen(CAMERA, VIEWPORT, world)).toEqual(point);
  });

  it('keeps zoom inside its bounds [TECH-12.2]', () => {
    expect(clampZoom(0)).toBe(MIN_PIXELS_PER_KM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_PIXELS_PER_KM);
    expect(clampZoom(Number.NaN)).toBe(MIN_PIXELS_PER_KM);
    expect(zoomedBy(CAMERA, ZOOM_STEP).pixelsPerKm).toBeCloseTo(10 * ZOOM_STEP, 10);
    expect(zoomedBy({ ...CAMERA, pixelsPerKm: MAX_PIXELS_PER_KM }, ZOOM_STEP).pixelsPerKm).toBe(
      MAX_PIXELS_PER_KM,
    );
  });

  it('zooming never moves the world point under the camera centre [TECH-12.2]', () => {
    const zoomed = zoomedBy(CAMERA, ZOOM_STEP);

    expect(worldToScreen(zoomed, VIEWPORT, zoomed.centreKm)).toEqual(
      worldToScreen(CAMERA, VIEWPORT, CAMERA.centreKm),
    );
  });

  it('pans by the dragged distance, in world units [TECH-12.2]', () => {
    const moved = panned(CAMERA, { x: 100, y: 50 });

    // Dragging the view right and down pulls the world with it, so the camera
    // moves left and up over the world.
    expect(moved.centreKm).toEqual({ x: -10, y: 5 });
    expect(moved.pixelsPerKm).toBe(CAMERA.pixelsPerKm);
  });

  it('frames every point around the first one [TECH-12.2, FUNC-19.2]', () => {
    const camera = framing(VIEWPORT, [{ x: 0, y: 0 }, { x: 40, y: 0 }], 10);

    expect(camera.centreKm).toEqual({ x: 0, y: 0 });
    const framed = worldToScreen(camera, VIEWPORT, { x: 40, y: 0 });
    expect(framed.x).toBeGreaterThan(VIEWPORT.widthPx / 2);
    expect(framed.x).toBeLessThan(VIEWPORT.widthPx);
  });

  it('keeps the fallback scale when there is nothing to frame [TECH-12.2]', () => {
    expect(framing(VIEWPORT, [], 7)).toEqual({ centreKm: { x: 0, y: 0 }, pixelsPerKm: 7 });
    expect(framing(VIEWPORT, [{ x: 3, y: 4 }], 7)).toEqual({
      centreKm: { x: 3, y: 4 },
      pixelsPerKm: 7,
    });
  });
});

describe('off-screen markers', () => {
  it('reports nothing for an object the camera shows [FUNC-19.2]', () => {
    expect(offScreenMarker(CAMERA, VIEWPORT, { x: 0, y: 0 }, 16)).toBeNull();
  });

  it('pins a distant object to the viewport edge and points at it [FUNC-19.2]', () => {
    const marker = offScreenMarker(CAMERA, VIEWPORT, { x: 500, y: 0 }, 16);

    expect(marker).not.toBeNull();
    expect(marker?.x).toBe(VIEWPORT.widthPx - 16);
    expect(marker?.y).toBe(VIEWPORT.heightPx / 2);
    expect(marker?.angleRadians).toBeCloseTo(0, 10);
  });

  it('points upwards for an object above the view [FUNC-19.2]', () => {
    const marker = offScreenMarker(CAMERA, VIEWPORT, { x: 0, y: 500 }, 16);

    // Screen y grows downwards, so an object above has a negative angle.
    expect(marker?.y).toBe(16);
    expect(marker?.angleRadians).toBeCloseTo(-Math.PI / 2, 10);
  });
});

describe('background rings and labels', () => {
  it('chooses a round ring spacing for the visible field [FUNC-19.2]', () => {
    for (const pixelsPerKm of [0.5, 2, 10, 60]) {
      const spacing = ringSpacingKm({ ...CAMERA, pixelsPerKm }, VIEWPORT);
      const mantissa = spacing / 10 ** Math.floor(Math.log10(spacing));

      expect([1, 2, 5, 10]).toContain(Math.round(mantissa * 1000) / 1000);
      expect(spacing).toBeGreaterThan(0);
    }
  });

  it('culls labels when zoomed out but never for a selected object [TECH-12.2]', () => {
    const far: Camera = { ...CAMERA, pixelsPerKm: LABEL_MINIMUM_PIXELS_PER_KM / 2 };

    expect(labelVisible(far, false)).toBe(false);
    expect(labelVisible(far, true)).toBe(true);
    expect(labelVisible(CAMERA, false)).toBe(true);
  });
});
