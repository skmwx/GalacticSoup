import { useCallback, useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react';

import type { MovementOrderData, SiteData, SiteObjectData } from '@protocol';

import { formatDistanceKm } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import {
  labelVisible,
  offScreenMarker,
  ringSpacingKm,
  screenToWorld,
  worldToScreen,
  type Camera,
  type Point,
  type Viewport,
} from './camera';
import styles from './Space.module.css';
import type { SitePositions } from './useSiteMotion';

/**
 * The schematic two-dimensional site (Functional Specification 19.2;
 * Technical Specification 12.2).
 *
 * The engine publishes world coordinates and this applies the camera. Layers
 * are drawn in the order the technical specification fixes: background and
 * hazards, range overlays, paths and intent, world objects, effects, labels,
 * off-screen indicators, then interaction targets. The effects layer has
 * nothing to draw until damage and repair events exist, so it is not emitted
 * yet; the layers around it already sit where it will go. Every semantic state
 * - player, selected, station - carries a shape and not only a colour, and
 * each object's label repeats its identity in words.
 *
 * The drawing is one image as far as assistive technology is concerned; the
 * object list beside it is the control surface, so selection never depends on
 * reaching a shape inside an SVG.
 *
 * @implements FUNC-19.2, TECH-12.2
 */

export interface SiteViewProps {
  readonly site: SiteData;
  /** Interpolated draw positions, keyed by object id. */
  readonly positions: SitePositions;
  readonly camera: Camera;
  readonly viewport: Viewport;
  readonly selectedId: string | null;
  onSelect(objectId: string | null): void;
  /** Panning by hand, in pixels. */
  onPan(deltaPx: Point): void;
  /** True while the player is choosing a destination point. */
  readonly choosingPoint: boolean;
  onChoosePoint(pointKm: Point): void;
}

/** Transparent hit targets are at least this wide (Technical Specification 12.2). */
export const MINIMUM_HIT_DIAMETER_PX = 24;

const OFF_SCREEN_INSET_PX = 16;

export function SiteView({
  site,
  positions,
  camera,
  viewport,
  selectedId,
  onSelect,
  onPan,
  choosingPoint,
  onChoosePoint,
}: SiteViewProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const runtime = site.site;
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const positionOf = useCallback(
    (object: SiteObjectData): Point => positions[object.id] ?? object.position,
    [positions],
  );

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const start = drag.current;
    if (start === null) {
      return;
    }
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (!start.moved && Math.hypot(deltaX, deltaY) < 3) {
      return;
    }
    drag.current = { x: event.clientX, y: event.clientY, moved: true };
    onPan({ x: deltaX, y: deltaY });
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const start = drag.current;
    drag.current = null;
    if (start?.moved === true) {
      return;
    }
    const target = event.target as Element | null;
    const objectId = target?.closest('[data-object-id]')?.getAttribute('data-object-id') ?? null;
    if (objectId !== null) {
      onSelect(objectId);
      return;
    }
    if (choosingPoint) {
      onChoosePoint(clickedPoint(event, camera, viewport));
      return;
    }
    onSelect(null);
  };

  if (runtime === null) {
    return (
      <svg
        className={styles['view']}
        viewBox={`0 0 ${viewport.widthPx} ${viewport.heightPx}`}
        role="img"
        aria-label={translate('space.view.empty')}
      />
    );
  }

  const player = runtime.objects.find((object) => object.player) ?? null;
  const spacingKm = ringSpacingKm(camera, viewport);
  const centre = worldToScreen(camera, viewport, player?.position ?? { x: 0, y: 0 });

  return (
    <svg
      className={styles['view']}
      data-choosing={choosingPoint ? 'true' : 'false'}
      viewBox={`0 0 ${viewport.widthPx} ${viewport.heightPx}`}
      role="img"
      aria-label={translate('space.view.label', {
        site: translate(runtime.siteNameKey),
        objects: runtime.objects.length,
      })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        drag.current = null;
      }}
    >
      {/* 1. background and hazards */}
      <g className={styles['layerBackground']} data-layer="background">
        {[1, 2, 3].map((step) => (
          <circle
            key={step}
            cx={centre.x}
            cy={centre.y}
            r={spacingKm * step * camera.pixelsPerKm}
            className={styles['ring']}
          />
        ))}
        <text x={centre.x + 4} y={centre.y - spacingKm * camera.pixelsPerKm - 4} className={styles['ringLabel']}>
          {translate('space.ring', { distance: formatDistanceKm(spacingKm, locale) })}
        </text>
      </g>

      {/* 2. range overlays */}
      <g className={styles['layerRanges']} data-layer="ranges">
        {rangeOverlay(site, runtime.objects, player, camera, viewport, positionOf)}
      </g>

      {/* 3. paths and intent */}
      <g className={styles['layerIntent']} data-layer="intent">
        {player === null ? null : intentPath(site, runtime.objects, player, camera, viewport, positionOf)}
        {runtime.objects.map((object) => {
          const from = worldToScreen(camera, viewport, positionOf(object));
          const speed = Math.hypot(object.velocity.x, object.velocity.y);
          if (speed === 0) {
            return null;
          }
          const to = worldToScreen(camera, viewport, {
            x: positionOf(object).x + object.velocity.x * VECTOR_SECONDS,
            y: positionOf(object).y + object.velocity.y * VECTOR_SECONDS,
          });
          return (
            <line
              key={`vector-${object.id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={styles['vector']}
              data-vector={object.id}
            />
          );
        })}
      </g>

      {/* 4. world objects */}
      <g className={styles['layerObjects']} data-layer="objects">
        {runtime.objects.map((object) => {
          const at = worldToScreen(camera, viewport, positionOf(object));
          const selected = object.id === selectedId;
          return (
            <g
              key={object.id}
              className={styles['object']}
              data-object={object.kind}
              data-player={object.player ? 'true' : 'false'}
              data-selected={selected ? 'true' : 'false'}
              transform={`translate(${at.x} ${at.y})`}
            >
              {object.kind === 'station' ? (
                <rect x={-9} y={-9} width={18} height={18} className={styles['station']} />
              ) : (
                <polygon
                  points="0,-10 7,8 0,4 -7,8"
                  className={object.player ? styles['playerShip'] : styles['ship']}
                  transform={`rotate(${facingDegrees(object.facingRadians)})`}
                />
              )}
              {selected ? <SelectionBrackets /> : null}
            </g>
          );
        })}
      </g>

      {/* 6. labels */}
      <g className={styles['layerLabels']} data-layer="labels">
        {runtime.objects.map((object) => {
          if (!labelVisible(camera, object.id === selectedId || object.player)) {
            return null;
          }
          const at = worldToScreen(camera, viewport, positionOf(object));
          return (
            <text
              key={`label-${object.id}`}
              x={at.x + 14}
              y={at.y + 4}
              className={styles['label']}
              data-label={object.id}
            >
              {object.player
                ? translate('space.object.you')
                : translate('space.object.label', {
                    name: translate(object.nameKey),
                    range: formatDistanceKm(object.rangeFromPlayerKm, locale),
                  })}
            </text>
          );
        })}
      </g>

      {/* 7. off-screen indicators */}
      <g className={styles['layerOffScreen']} data-layer="offscreen">
        {runtime.objects.map((object) => {
          const marker = offScreenMarker(camera, viewport, positionOf(object), OFF_SCREEN_INSET_PX);
          if (marker === null) {
            return null;
          }
          return (
            <polygon
              key={`marker-${object.id}`}
              points="0,-7 9,0 0,7"
              className={styles['offScreen']}
              data-offscreen={object.id}
              data-selected={object.id === selectedId ? 'true' : 'false'}
              transform={`translate(${marker.x} ${marker.y}) rotate(${(marker.angleRadians * 180) / Math.PI})`}
            />
          );
        })}
      </g>

      {/* 8. interaction targets */}
      <g className={styles['layerHits']} data-layer="hits">
        {runtime.objects.map((object) => {
          const at = worldToScreen(camera, viewport, positionOf(object));
          const radius = Math.max(
            MINIMUM_HIT_DIAMETER_PX / 2,
            object.radiusKm * camera.pixelsPerKm,
          );
          return (
            <circle
              key={`hit-${object.id}`}
              cx={at.x}
              cy={at.y}
              r={radius}
              className={styles['hit']}
              data-object-id={object.id}
            />
          );
        })}
      </g>
    </svg>
  );
}

/** How many seconds of travel a movement vector represents. */
const VECTOR_SECONDS = 4;

function SelectionBrackets(): JSX.Element {
  return (
    <g className={styles['selection']} data-selection="true">
      <path d="M-14,-9 L-14,-14 L-9,-14" />
      <path d="M9,-14 L14,-14 L14,-9" />
      <path d="M14,9 L14,14 L9,14" />
      <path d="M-9,14 L-14,14 L-14,9" />
    </g>
  );
}

function facingDegrees(facingRadians: number): number {
  // Zero radians points along positive x; the triangle is drawn pointing up.
  return (facingRadians * 180) / Math.PI + 90;
}

/**
 * The ring that shows what the current order is aiming for: the distance an
 * approach, orbit or keep-range order holds, drawn around its target.
 */
function rangeOverlay(
  site: SiteData,
  objects: readonly SiteObjectData[],
  player: SiteObjectData | null,
  camera: Camera,
  viewport: Viewport,
  positionOf: (object: SiteObjectData) => Point,
): JSX.Element | null {
  const radiusKm = orderRadiusKm(site.movementOrder);
  const centre = orderCentre(site, objects, positionOf) ?? (player === null ? null : positionOf(player));
  if (radiusKm === null || centre === null) {
    return null;
  }
  const at = worldToScreen(camera, viewport, centre);
  return (
    <circle
      cx={at.x}
      cy={at.y}
      r={radiusKm * camera.pixelsPerKm}
      className={styles['orderRange']}
      data-order={site.movementOrder?.kind ?? ''}
    />
  );
}

function orderRadiusKm(order: MovementOrderData | null): number | null {
  if (order === null) {
    return null;
  }
  return order.kind === 'orbit' || order.kind === 'keepRange' || order.kind === 'approach'
    ? order.distanceKm
    : null;
}

function orderCentre(
  site: SiteData,
  objects: readonly SiteObjectData[],
  positionOf: (object: SiteObjectData) => Point,
): Point | null {
  const order = site.movementOrder;
  if (order === null || order.kind === 'stop' || order.kind === 'moveToPoint') {
    return null;
  }
  const target = objects.find((object) => object.id === order.targetId);
  return target === undefined ? null : positionOf(target);
}

function intentPath(
  site: SiteData,
  objects: readonly SiteObjectData[],
  player: SiteObjectData,
  camera: Camera,
  viewport: Viewport,
  positionOf: (object: SiteObjectData) => Point,
): JSX.Element | null {
  const order = site.movementOrder;
  if (order === null || order.kind === 'stop') {
    return null;
  }
  let destination: Point | null = null;
  if (order.kind === 'moveToPoint') {
    destination = order.point;
  } else {
    const target = objects.find((object) => object.id === order.targetId);
    destination = target === undefined ? null : positionOf(target);
  }
  if (destination === null) {
    return null;
  }
  const from = worldToScreen(camera, viewport, positionOf(player));
  const to = worldToScreen(camera, viewport, destination);
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      className={styles['intent']}
      data-intent={order.kind}
    />
  );
}

function clickedPoint(
  event: ReactPointerEvent<SVGSVGElement>,
  camera: Camera,
  viewport: Viewport,
): Point {
  const box = event.currentTarget.getBoundingClientRect();
  const scaleX = box.width === 0 ? 1 : viewport.widthPx / box.width;
  const scaleY = box.height === 0 ? 1 : viewport.heightPx / box.height;
  return screenToWorld(camera, viewport, {
    x: (event.clientX - box.left) * scaleX,
    y: (event.clientY - box.top) * scaleY,
  });
}
