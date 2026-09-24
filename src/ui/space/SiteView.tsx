import {
  useCallback,
  useRef,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { CombatData, MovementOrderData, SiteData, SiteObjectData } from '@protocol';

import { formatDistanceKm, formatStat } from '../format/numbers';
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
import { damageTotal } from './tactical';
import type { SitePositions } from './useSiteMotion';

/**
 * The schematic two-dimensional site (Functional Specification 19.2;
 * Technical Specification 12.2).
 *
 * The engine publishes world coordinates and this applies the camera. Layers
 * are drawn in the order the technical specification fixes: background and
 * hazards, range overlays, paths and intent, world objects, effects, labels,
 * off-screen indicators, then interaction targets. Every semantic state
 * carries a shape and not only a colour: the player's ship is filled, a
 * hostile ship wears a diamond, a lock is a ringed crosshair and a lock in
 * progress a broken ring, selection is a set of corner brackets, and a hit or
 * a repair is a burst or a plus with its number beside it.
 *
 * Weapon and lock ranges are drawn on demand, around the player's ship, from
 * the values the tactical view published. Recent damage and repairs are drawn
 * near the ship they happened to for a few seconds of simulation time, so a
 * paused fight keeps showing what just happened.
 *
 * The drawing is one image as far as assistive technology is concerned; the
 * object list beside it is the control surface, so selection never depends on
 * reaching a shape inside an SVG.
 *
 * @implements FUNC-19.2, FUNC-9.1, TECH-12.2, MVP-AC-03, MVP-AC-04
 */

export interface SiteViewProps {
  readonly site: SiteData;
  readonly combat: CombatData | null;
  /** Interpolated draw positions, keyed by object id. */
  readonly positions: SitePositions;
  readonly camera: Camera;
  readonly viewport: Viewport;
  readonly selectedId: string | null;
  /** Draws weapon and lock ranges around the player's ship. */
  readonly showRanges: boolean;
  onSelect(objectId: string | null): void;
  /** Panning by hand, in pixels. */
  onPan(deltaPx: Point): void;
  /** True while the player is choosing a destination point. */
  readonly choosingPoint: boolean;
  onChoosePoint(pointKm: Point): void;
  /** A secondary click on an object, at a position in the page. */
  onContextMenu?(objectId: string, pagePoint: Point): void;
}

/** Transparent hit targets are at least this wide (Technical Specification 12.2). */
export const MINIMUM_HIT_DIAMETER_PX = 24;

/** How long a damage or repair marker stays beside its target, in simulation time. */
export const EFFECT_WINDOW_MS = 3_000;

const OFF_SCREEN_INSET_PX = 16;

export function SiteView({
  site,
  combat,
  positions,
  camera,
  viewport,
  selectedId,
  showRanges,
  onSelect,
  onPan,
  choosingPoint,
  onChoosePoint,
  onContextMenu,
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
    if (event.button !== 0) {
      return;
    }
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
    if (start === null || start.moved) {
      return;
    }
    const objectId = objectIdAt(event.target);
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

  const onContext = (event: ReactMouseEvent<SVGSVGElement>): void => {
    const objectId = objectIdAt(event.target);
    if (objectId === null || onContextMenu === undefined) {
      return;
    }
    event.preventDefault();
    onSelect(objectId);
    onContextMenu(objectId, { x: event.clientX, y: event.clientY });
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
  const locks = new Map((combat?.locks ?? []).map((lock) => [lock.targetId, lock.status]));
  const objectById = new Map(runtime.objects.map((object) => [object.id, object]));

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
      onContextMenu={onContext}
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
        {showRanges && player !== null
          ? combatRanges(combat, positionOf(player), camera, viewport, translate, locale)
          : null}
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
          const lock = locks.get(object.id) ?? null;
          return (
            <g
              key={object.id}
              className={styles['object']}
              data-object={object.kind}
              data-player={object.player ? 'true' : 'false'}
              data-attitude={object.attitude}
              data-selected={selected ? 'true' : 'false'}
              data-locked={lock ?? 'none'}
              transform={`translate(${at.x} ${at.y})`}
            >
              {object.kind === 'station' ? (
                <rect x={-9} y={-9} width={18} height={18} className={styles['station']} />
              ) : object.kind === 'wreck' ? (
                // A wreck is a hull that no longer flies, so it is drawn as a
                // broken outline rather than as another ship.
                <path d="M -8 -6 L 0 -2 L 8 -7 L 5 7 L -6 6 Z" className={styles['wreck']} />
              ) : (
                <polygon
                  points="0,-10 7,8 0,4 -7,8"
                  className={
                    object.player
                      ? styles['playerShip']
                      : object.attitude === 'hostile'
                        ? styles['hostileShip']
                        : styles['ship']
                  }
                  transform={`rotate(${facingDegrees(object.facingRadians)})`}
                />
              )}
              {object.attitude === 'hostile' ? (
                <path d="M0,-16 L16,0 L0,16 L-16,0 Z" className={styles['hostileMarker']} data-hostile="true" />
              ) : null}
              {lock === null ? null : <LockMarker status={lock} />}
              {selected ? <SelectionBrackets /> : null}
            </g>
          );
        })}
      </g>

      {/* 5. effects */}
      <g className={styles['layerEffects']} data-layer="effects">
        {player === null
          ? null
          : effects(combat, player, objectById, camera, viewport, positionOf, locale)}
      </g>

      {/* 6. labels */}
      <g className={styles['layerLabels']} data-layer="labels">
        {runtime.objects.map((object) => {
          const important =
            object.id === selectedId || object.player || object.attitude === 'hostile' || locks.has(object.id);
          if (!labelVisible(camera, important)) {
            return null;
          }
          const at = worldToScreen(camera, viewport, positionOf(object));
          return (
            <text
              key={`label-${object.id}`}
              x={at.x + 18}
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
              points={object.attitude === 'hostile' ? '0,-8 10,0 0,8 4,0' : '0,-7 9,0 0,7'}
              className={object.attitude === 'hostile' ? styles['offScreenHostile'] : styles['offScreen']}
              data-offscreen={object.id}
              data-attitude={object.attitude}
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

function objectIdAt(target: EventTarget | null): string | null {
  const element = target as Element | null;
  return element?.closest?.('[data-object-id]')?.getAttribute('data-object-id') ?? null;
}

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

/** A lock is a ringed crosshair; a lock in progress, a broken ring. */
function LockMarker({ status }: { readonly status: 'locking' | 'locked' }): JSX.Element {
  return (
    <g className={styles['lockMarker']} data-lock-marker={status}>
      <circle r={20} className={status === 'locked' ? styles['lockRing'] : styles['lockingRing']} />
      {status === 'locked' ? (
        <>
          <path d="M0,-24 L0,-17" />
          <path d="M0,17 L0,24" />
          <path d="M-24,0 L-17,0" />
          <path d="M17,0 L24,0" />
        </>
      ) : null}
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

/**
 * Lock range and each distinct weapon's optimal and falloff reach, drawn on
 * demand around the player's ship (Functional Specification 19.2).
 */
function combatRanges(
  combat: CombatData | null,
  centreKm: Point,
  camera: Camera,
  viewport: Viewport,
  translate: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  locale: string,
): JSX.Element[] {
  if (combat === null || combat.shipId === null) {
    return [];
  }
  const at = worldToScreen(camera, viewport, centreKm);
  const rings: { key: string; radiusKm: number; kind: 'lock' | 'optimal' | 'falloff'; label: string }[] = [
    {
      key: 'lock',
      radiusKm: combat.maxLockRangeKm,
      kind: 'lock',
      label: translate('space.range.lock', { distance: formatDistanceKm(combat.maxLockRangeKm, locale) }),
    },
  ];
  const seen = new Set<string>();
  for (const weapon of combat.weapons) {
    const key = `${String(weapon.optimalRangeKm)}:${String(weapon.falloffKm)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rings.push({
      key: `optimal-${key}`,
      radiusKm: weapon.optimalRangeKm,
      kind: 'optimal',
      label: translate('space.range.optimal', { distance: formatDistanceKm(weapon.optimalRangeKm, locale) }),
    });
    rings.push({
      key: `falloff-${key}`,
      radiusKm: weapon.optimalRangeKm + weapon.falloffKm,
      kind: 'falloff',
      label: translate('space.range.falloff', {
        distance: formatDistanceKm(weapon.optimalRangeKm + weapon.falloffKm, locale),
      }),
    });
  }
  return rings.map((ring) => {
    const radius = ring.radiusKm * camera.pixelsPerKm;
    return (
      <g key={ring.key} data-range={ring.kind}>
        <circle cx={at.x} cy={at.y} r={radius} className={styles[`range_${ring.kind}`]} />
        <text x={at.x + radius * Math.SQRT1_2 + 4} y={at.y - radius * Math.SQRT1_2} className={styles['ringLabel']}>
          {ring.label}
        </text>
      </g>
    );
  });
}

/**
 * Weapon fire, hostile locks and recent damage and repairs, near the ships
 * they belong to (Functional Specification 19.2).
 */
function effects(
  combat: CombatData | null,
  player: SiteObjectData,
  objects: ReadonlyMap<string, SiteObjectData>,
  camera: Camera,
  viewport: Viewport,
  positionOf: (object: SiteObjectData) => Point,
  locale: string,
): JSX.Element[] {
  if (combat === null) {
    return [];
  }
  const drawn: JSX.Element[] = [];
  const from = worldToScreen(camera, viewport, positionOf(player));

  for (const weapon of combat.weapons) {
    const target = weapon.cycle === null ? undefined : objects.get(weapon.cycle.targetId);
    if (target === undefined) continue;
    const to = worldToScreen(camera, viewport, positionOf(target));
    drawn.push(
      <line
        key={`fire-${weapon.slot.kind}-${String(weapon.slot.index)}`}
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        className={styles['fireLine']}
        data-effect="fire"
      />,
    );
  }

  for (const lock of combat.hostileLocks) {
    const source = objects.get(lock.shipId);
    if (source === undefined) continue;
    const at = worldToScreen(camera, viewport, positionOf(source));
    drawn.push(
      <line
        key={`hostile-${lock.shipId}`}
        x1={at.x}
        y1={at.y}
        x2={from.x}
        y2={from.y}
        className={lock.status === 'locked' ? styles['hostileLockLine'] : styles['hostileLockingLine']}
        data-effect="hostileLock"
        data-status={lock.status}
      />,
    );
  }

  const since = combat.simulationTimeMs - EFFECT_WINDOW_MS;
  const offsets = new Map<string, number>();
  for (const event of combat.events) {
    if (event.lastAtMs < since || event.kind === 'destruction') continue;
    const subjectId = event.kind === 'damage' ? event.targetId : event.shipId;
    const subject = objects.get(subjectId);
    if (subject === undefined) continue;
    const at = worldToScreen(camera, viewport, positionOf(subject));
    const row = offsets.get(subjectId) ?? 0;
    offsets.set(subjectId, row + 1);
    const y = at.y - 18 - row * 14;
    if (event.kind === 'damage') {
      drawn.push(
        <g
          key={`damage-${event.sourceId}-${event.targetId}-${event.slotKey}-${String(event.firstAtMs)}`}
          className={styles['damageEffect']}
          data-effect="damage"
          transform={`translate(${at.x - 16} ${y})`}
        >
          <path d="M0,-5 L1.5,-1.5 L5,0 L1.5,1.5 L0,5 L-1.5,1.5 L-5,0 L-1.5,-1.5 Z" />
          <text x={8} y={4}>
            {`−${formatStat(Math.round(damageTotal(event.appliedDamage)), locale)}`}
          </text>
        </g>,
      );
    } else {
      drawn.push(
        <g
          key={`repair-${event.shipId}-${event.slotKey}-${String(event.firstAtMs)}`}
          className={styles['repairEffect']}
          data-effect="repair"
          transform={`translate(${at.x - 16} ${y})`}
        >
          <path d="M-4,0 L4,0 M0,-4 L0,4" />
          <text x={8} y={4}>
            {`+${formatStat(Math.round(event.repairedHitPoints), locale)}`}
          </text>
        </g>,
      );
    }
  }
  return drawn;
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
