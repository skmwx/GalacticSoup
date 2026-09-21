/**
 * The camera transform for the schematic space view
 * (Technical Specification 12.2; Functional Specification 19.2).
 *
 * The engine publishes world coordinates in kilometres; everything here turns
 * them into pixels and back. Zoom changes display scale only - no function in
 * this module is allowed to influence, or even to read, simulation state.
 *
 * It is deliberately free of React so the transform can be tested as
 * arithmetic rather than through a rendered component.
 *
 * @implements TECH-12.2, FUNC-19.2
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface Camera {
  /** World point drawn at the centre of the viewport, in kilometres. */
  readonly centreKm: Point;
  readonly pixelsPerKm: number;
}

/** Zoom bounds, chosen so a 0.5 km station and a 60 km field both read. */
export const MIN_PIXELS_PER_KM = 0.25;
export const MAX_PIXELS_PER_KM = 120;

/** One press of zoom in or out. */
export const ZOOM_STEP = 1.6;

/** Share of the viewport left as margin when framing a set of objects. */
export const FRAME_MARGIN = 0.18;

export function clampZoom(pixelsPerKm: number): number {
  if (Number.isNaN(pixelsPerKm)) {
    return MIN_PIXELS_PER_KM;
  }
  return Math.min(MAX_PIXELS_PER_KM, Math.max(MIN_PIXELS_PER_KM, pixelsPerKm));
}

export function zoomedBy(camera: Camera, factor: number): Camera {
  return { ...camera, pixelsPerKm: clampZoom(camera.pixelsPerKm * factor) };
}

/**
 * World to screen. The world's y axis points up, the screen's points down, so
 * the vertical axis is inverted here and nowhere else.
 */
export function worldToScreen(camera: Camera, viewport: Viewport, point: Point): Point {
  return {
    x: viewport.widthPx / 2 + (point.x - camera.centreKm.x) * camera.pixelsPerKm,
    y: viewport.heightPx / 2 - (point.y - camera.centreKm.y) * camera.pixelsPerKm,
  };
}

export function screenToWorld(camera: Camera, viewport: Viewport, point: Point): Point {
  return {
    x: camera.centreKm.x + (point.x - viewport.widthPx / 2) / camera.pixelsPerKm,
    y: camera.centreKm.y - (point.y - viewport.heightPx / 2) / camera.pixelsPerKm,
  };
}

/** Kilometres per pixel, for turning a drag in pixels into a pan in kilometres. */
export function kilometresPerPixel(camera: Camera): number {
  return 1 / camera.pixelsPerKm;
}

export function panned(camera: Camera, deltaPx: Point): Camera {
  return {
    ...camera,
    centreKm: {
      x: camera.centreKm.x - deltaPx.x * kilometresPerPixel(camera),
      y: camera.centreKm.y + deltaPx.y * kilometresPerPixel(camera),
    },
  };
}

/**
 * A camera that shows every given point, centred on the first one. An empty
 * list or a single point keeps the supplied fallback scale.
 */
export function framing(
  viewport: Viewport,
  points: readonly Point[],
  fallbackPixelsPerKm: number,
): Camera {
  const centre = points[0] ?? { x: 0, y: 0 };
  let radiusKm = 0;
  for (const point of points) {
    radiusKm = Math.max(radiusKm, Math.hypot(point.x - centre.x, point.y - centre.y));
  }
  if (radiusKm <= 0) {
    return { centreKm: centre, pixelsPerKm: clampZoom(fallbackPixelsPerKm) };
  }
  const usable = Math.min(viewport.widthPx, viewport.heightPx) * (1 - FRAME_MARGIN * 2);
  return { centreKm: centre, pixelsPerKm: clampZoom(usable / 2 / radiusKm) };
}

export interface OffScreenMarker {
  /** Where the marker is drawn, inside the viewport edge. */
  readonly x: number;
  readonly y: number;
  /** Screen-space direction of the object, for rotating the marker. */
  readonly angleRadians: number;
}

/**
 * Where to draw the edge marker for an object the camera does not show, or
 * `null` when the object is on screen (Functional Specification 19.2).
 */
export function offScreenMarker(
  camera: Camera,
  viewport: Viewport,
  point: Point,
  insetPx: number,
): OffScreenMarker | null {
  const screen = worldToScreen(camera, viewport, point);
  const inside =
    screen.x >= insetPx &&
    screen.x <= viewport.widthPx - insetPx &&
    screen.y >= insetPx &&
    screen.y <= viewport.heightPx - insetPx;
  if (inside) {
    return null;
  }
  const centreX = viewport.widthPx / 2;
  const centreY = viewport.heightPx / 2;
  return {
    x: Math.min(viewport.widthPx - insetPx, Math.max(insetPx, screen.x)),
    y: Math.min(viewport.heightPx - insetPx, Math.max(insetPx, screen.y)),
    angleRadians: Math.atan2(screen.y - centreY, screen.x - centreX),
  };
}

/** The spacing of the background range rings, in kilometres. */
export function ringSpacingKm(camera: Camera, viewport: Viewport): number {
  const visibleKm = Math.min(viewport.widthPx, viewport.heightPx) / camera.pixelsPerKm;
  const rough = visibleKm / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-6)));
  for (const step of [1, 2, 5, 10]) {
    if (rough <= magnitude * step) {
      return magnitude * step;
    }
  }
  return magnitude * 10;
}

/** Labels are hidden below this scale so a crowded view stays readable. */
export const LABEL_MINIMUM_PIXELS_PER_KM = 0.6;

/**
 * Whether an object's label is drawn at this zoom. Selected, locked and
 * dangerous objects keep their label whatever the zoom
 * (Technical Specification 12.2).
 */
export function labelVisible(camera: Camera, alwaysShow: boolean): boolean {
  return alwaysShow || camera.pixelsPerKm >= LABEL_MINIMUM_PIXELS_PER_KM;
}
