import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { createPortal } from 'react-dom';

import type { ClientGateway } from '@gateway';

import { ActionButton, commandAvailability, useActionShortcuts, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { FlightReadouts } from '../frame/FlightReadouts';
import { CombatLog } from './CombatLog';
import { CommandBar } from './CommandBar';
import { CourseCommands } from './CourseCommands';
import { EncounterPanel } from './EncounterPanel';
import { LocksPanel } from './LocksPanel';
import { LootPanel, takeEverything } from './LootPanel';
import { ModulesPanel } from './ModulesPanel';
import { ObjectCommands } from './ObjectCommands';
import { ObjectContextMenu } from './ObjectContextMenu';
import { ObjectList } from './ObjectList';
import { SelectedObjectPanel } from './SelectedObjectPanel';
import { ShipStatusPanel } from './ShipStatusPanel';
import { SiteView } from './SiteView';
import styles from './Space.module.css';
import { TravelStatus } from './TravelStatus';
import { WeaponsPanel } from './WeaponsPanel';
import { worldToScreen, type Point, type Viewport } from './camera';
import { fireAvailability, weaponTargetId } from './tactical';
import { useCamera } from './useCamera';
import { useReducedMotion } from '../preferences/useReducedMotion';
import { useSiteMotion } from './useSiteMotion';

/**
 * Everything the player sees while undocked
 * (Functional Specification 19.2, 19.3; Technical Specification 12.1-12.3).
 *
 * The screen owns nothing but presentation: which object is selected, where
 * the camera looks, whether ranges are drawn, which distance range orders use
 * and whether a context menu is open. Every fact it shows is a projection, and
 * every order it sends is a command whose answer is read back before anything
 * changes on screen.
 *
 * The weapons aim at the selected object when it is locked and otherwise at
 * the first completed lock; selecting a lock is how the player chooses what
 * to shoot. Selecting a wreck opens it, which is what lets the loot panel
 * show - or explain why it cannot show - what the wreck holds.
 *
 * @implements FUNC-19.2, FUNC-19.3, TECH-12.1, TECH-12.2, TECH-12.3, MVP-AC-03, MVP-AC-04, MVP-AC-06, MVP-AC-08
 */

export interface SpaceScreenProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  /** Reads a wreck afresh between takes, which the store does not do on demand. */
  readonly gateway: ClientGateway;
  /** The clock the engine last answered with, for travel countdowns. */
  readonly simulationTimeMs: number;
  readonly paused: boolean;
  /** Stable cockpit context column, shared with guidance and notifications. */
  readonly sidebar?: HTMLElement | null;
}

/** The drawing's coordinate space. CSS scales it; the numbers stay stable. */
export const SPACE_VIEWPORT: Viewport = { widthPx: 960, heightPx: 600 };

/**
 * An open context menu: an object's commands, or the course to a point in
 * empty space. The point is fixed in world kilometres when the menu opens, so
 * the camera following the ship cannot move the destination; only the arrow
 * keys move it, on purpose.
 */
type MenuState =
  | { readonly kind: 'object'; readonly objectId: string; readonly position: Point }
  | { readonly kind: 'point'; readonly pointKm: Point; readonly position: Point };

/** How far one arrow key moves a course point, in screen pixels; Shift moves five times as far. */
export const COURSE_NUDGE_PX = 24;

/** How far from the chosen point the point menu opens, in pixels. */
const COURSE_MENU_OFFSET_PX = 16;

export function SpaceScreen({
  data,
  runner,
  gateway,
  simulationTimeMs,
  paused,
  sidebar = null,
}: SpaceScreenProps): JSX.Element {
  const translate = useTranslate();
  const site = data.site;
  const runtime = site?.site ?? null;
  const combat = data.combat;
  const encounter = data.encounter;
  const camera = useCamera();
  const reducedMotion = useReducedMotion();
  const positions = useSiteMotion({ site, paused, reducedMotion });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRanges, setShowRanges] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>(SPACE_VIEWPORT);
  useEffect(() => {
    const drawing = stage.current?.querySelector('svg');
    if (drawing === null || drawing === undefined || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const box = drawing.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const heightPx = SPACE_VIEWPORT.widthPx * box.height / box.width;
      setViewport((previous) => Math.abs(previous.heightPx - heightPx) < .5 ? previous : {
        widthPx: SPACE_VIEWPORT.widthPx, heightPx,
      });
    });
    observer.observe(drawing);
    return () => { observer.disconnect(); };
  }, [site === null]);
  const presets = site?.rangePresetsKm ?? [];
  const closestKm = presets[0] ?? 0;
  const [rangeKm, setRangeKm] = useState<number>(closestKm);
  // The range must be one the site offers; before the site has been read
  // there is nothing to offer, so it settles on the first authored one.
  useEffect(() => {
    if (presets.length > 0 && !presets.includes(rangeKm)) {
      setRangeKm(presets[0] ?? 0);
    }
  }, [presets, rangeKm]);

  const objects = runtime?.objects ?? [];
  const player = objects.find((object) => object.player) ?? null;
  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const menuObject =
    menu?.kind !== 'object' ? null : (objects.find((object) => object.id === menu.objectId) ?? null);
  const targetId = weaponTargetId(combat, selectedId);
  const fire = fireAvailability(combat, targetId);

  // A selection is presentation, but it may not survive its subject: an object
  // that has left the site is no longer selected.
  useEffect(() => {
    if (selectedId !== null && selected === null) {
      setSelectedId(null);
    }
  }, [selectedId, selected]);

  // An object menu does not outlive its object, nor a point menu its site:
  // entering warp leaves nothing to set a course in.
  const siteInstanceId = runtime?.instanceId ?? null;
  useEffect(() => {
    if (menu?.kind === 'object' && menuObject === null) {
      setMenu(null);
    }
  }, [menu, menuObject]);
  useEffect(() => {
    setMenu((previous) => (previous?.kind === 'point' ? null : previous));
  }, [siteInstanceId]);

  // Selecting a wreck opens it; selecting anything else closes it.
  const { openWreck, openWreckId } = data;
  const selectedWreckId = selected?.kind === 'wreck' ? selected.id : null;
  useEffect(() => {
    if (selectedWreckId !== openWreckId) {
      openWreck(selectedWreckId);
    }
  }, [selectedWreckId, openWreckId, openWreck]);

  const { track, following } = camera;
  const playerPosition = player === null ? null : positions[player.id] ?? player.position;
  useEffect(() => {
    if (following && playerPosition !== null) {
      track(playerPosition);
    }
  }, [following, playerPosition?.x, playerPosition?.y, track]);

  const centreOnShip = useCallback(() => {
    if (playerPosition !== null) {
      camera.centreOn(playerPosition);
    }
  }, [camera, playerPosition]);

  const fireAtTarget = async (): Promise<void> => {
    if (targetId === null) {
      return;
    }
    for (const weapon of fire.weapons) {
      await data.send('weapon.activate', {
        slotKind: weapon.slot.kind,
        slotIndex: weapon.slot.index,
        targetId,
      });
    }
  };

  const cycleSelection = (step: 1 | -1): void => {
    const candidates = objects.filter((object) => !object.player);
    if (candidates.length === 0) {
      return;
    }
    const index = candidates.findIndex((object) => object.id === selectedId);
    const next =
      index === -1
        ? step === 1
          ? 0
          : candidates.length - 1
        : (index + step + candidates.length) % candidates.length;
    setSelectedId(candidates[next]?.id ?? null);
  };

  const stagePosition = (pagePoint: Point): Point => {
    const box = stage.current?.getBoundingClientRect();
    return {
      x: Math.max(0, pagePoint.x - (box?.left ?? 0)),
      y: Math.max(0, pagePoint.y - (box?.top ?? 0)),
    };
  };

  const openMenuAt = (objectId: string, pagePoint: Point): void => {
    setMenu({ kind: 'object', objectId, position: stagePosition(pagePoint) });
  };

  const openPointMenu = (pointKm: Point, pagePoint: Point): void => {
    // Opened just beside the point, so the crosshair it sets a course to stays visible.
    const at = stagePosition(pagePoint);
    setMenu({
      kind: 'point',
      pointKm: roundedPoint(pointKm),
      position: { x: at.x + COURSE_MENU_OFFSET_PX, y: at.y + COURSE_MENU_OFFSET_PX },
    });
  };

  /** Where a world point is drawn, in page pixels, through the drawing's own transform. */
  const pagePointOf = (pointKm: Point): Point => {
    const drawing = stage.current?.querySelector('svg') ?? null;
    const local = worldToScreen(camera.camera, viewport, pointKm);
    const matrix = drawing?.getScreenCTM?.() ?? null;
    if (drawing !== null && matrix !== null) {
      const point = drawing.createSVGPoint();
      point.x = local.x;
      point.y = local.y;
      const page = point.matrixTransform(matrix);
      return { x: page.x, y: page.y };
    }
    const box = drawing?.getBoundingClientRect();
    const scale = box === undefined || box.width === 0 ? 1 : box.width / viewport.widthPx;
    return { x: (box?.left ?? 0) + local.x * scale, y: (box?.top ?? 0) + local.y * scale };
  };

  /**
   * The keyboard path to a course: the point menu on the view's centre, which
   * the arrow keys then move. Without a site there is nowhere to set a course.
   */
  const openPointMenuAtCentre = (): string | undefined => {
    if (runtime === null) {
      const move = commandAvailability(site?.commands ?? [], 'movement.moveToPoint');
      return move.unavailableReason ?? 'shortcut.unavailable';
    }
    const centreKm = camera.camera.centreKm;
    openPointMenu(centreKm, pagePointOf(centreKm));
    return undefined;
  };

  const nudgeCoursePoint = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (menu?.kind !== 'point') return;
    const step = ((event.shiftKey ? 5 : 1) * COURSE_NUDGE_PX) / camera.camera.pixelsPerKm;
    const delta =
      event.key === 'ArrowUp' ? { x: 0, y: step }
      : event.key === 'ArrowDown' ? { x: 0, y: -step }
      : event.key === 'ArrowLeft' ? { x: -step, y: 0 }
      : event.key === 'ArrowRight' ? { x: step, y: 0 }
      : null;
    if (delta === null) return;
    event.preventDefault();
    setMenu({
      ...menu,
      pointKm: roundedPoint({ x: menu.pointKm.x + delta.x, y: menu.pointKm.y + delta.y }),
    });
  };

  const openMenuFor = (objectId: string, anchor: Element): void => {
    const box = anchor.getBoundingClientRect();
    const stageBox = stage.current?.getBoundingClientRect();
    // Anchored beside the list entry but kept inside the stage, so it never
    // opens off-screen when the list sits below the view on a narrow layout.
    setMenu({
      kind: 'object',
      objectId,
      position: {
        x: Math.max(0, Math.min(box.left - (stageBox?.left ?? 0), (stageBox?.width ?? 0) - 240)),
        y: Math.max(0, Math.min(box.top - (stageBox?.top ?? 0), (stageBox?.height ?? 0) - 40)),
      },
    });
  };

  useActionShortcuts({
    'space.zoomIn': camera.zoomIn,
    'space.zoomOut': camera.zoomOut,
    'space.centre': centreOnShip,
    'space.ranges': () => {
      setShowRanges((previous) => !previous);
    },
    'space.setCourse': openPointMenuAtCentre,
    'space.selectNext': () => {
      cycleSelection(1);
    },
    'space.selectPrevious': () => {
      cycleSelection(-1);
    },
    // A key that cannot act says why, as the button beside it does.
    'targeting.lock': () => {
      if (selected === null) return 'shortcut.noSelection';
      const lock = commandAvailability(selected.commands, 'targeting.lock');
      if (!lock.available) return lock.unavailableReason ?? 'shortcut.unavailable';
      runner.run('targeting.lock', async () => {
        await data.send('targeting.lock', { targetId: selected.id });
      });
      return undefined;
    },
    'targeting.unlock': () => {
      if (selected === null) return 'shortcut.noSelection';
      const unlock = commandAvailability(selected.commands, 'targeting.unlock');
      if (!unlock.available) return unlock.unavailableReason ?? 'shortcut.unavailable';
      runner.run('targeting.unlock', async () => {
        await data.send('targeting.unlock', { targetId: selected.id });
      });
      return undefined;
    },
    'loot.takeAll': () => {
      if (selected?.kind !== 'wreck') return 'shortcut.noWreck';
      const take = commandAvailability(selected.commands, 'loot.take');
      if (!take.available) return take.unavailableReason ?? 'shortcut.unavailable';
      runner.run('loot.takeAll', () => takeEverything(gateway, data, selected.id));
      return undefined;
    },
  });

  if (site === null) {
    return (
      <section className={styles['space']} aria-labelledby="space-heading" data-external-context={sidebar !== null}>
        <div className={styles['heading']}>
          <h2 id="space-heading" className={styles['title']}>
            {translate('space.loading')}
          </h2>
        </div>
      </section>
    );
  }

  const wreckData = encounter?.wrecks.find((entry) => entry.wreckId === selected?.id) ?? null;

  return (
    <section className={styles['space']} aria-labelledby="space-heading" data-external-context={sidebar !== null}>
      <div className={styles['heading']}>
        <h2 id="space-heading" className={styles['visuallyHidden']}>
          {runtime === null ? translate('space.inTransit') : translate(runtime.siteNameKey)}
        </h2>
        {runtime === null ? null : (
          <p className={styles['visuallyHidden']}>
            {translate('space.systemDanger', {
              system: translate(runtime.systemNameKey),
              danger: runtime.dangerRating,
            })}
          </p>
        )}
        <TravelStatus
          travel={site.travelStatus}
          location={site.location}
          simulationTimeMs={simulationTimeMs}
          bookmarks={data.destinations?.bookmarks ?? []}
        />
      </div>

      <aside className={styles['shipRail']} aria-label={translate('tactical.status.heading')}>
        <ShipStatusPanel combat={combat} site={site} encounter={encounter} />
        <FlightReadouts data={data} />
      </aside>
      <div className={styles['stage']} ref={stage}>
        <SiteView
          site={site}
          combat={combat}
          positions={positions}
          camera={camera.camera}
          viewport={viewport}
          selectedId={selectedId}
          showRanges={showRanges}
          onSelect={setSelectedId}
          onPan={camera.panBy}
          onContextMenu={openMenuAt}
          onPointMenu={openPointMenu}
          coursePoint={menu?.kind === 'point' ? menu.pointKm : null}
        />
        <div className={styles['viewControls']}>
          <ActionButton actionId="space.zoomIn" runner={runner} onRun={camera.zoomIn} />
          <ActionButton actionId="space.zoomOut" runner={runner} onRun={camera.zoomOut} />
          <ActionButton
            actionId="space.centre"
            runner={runner}
            pressed={camera.following}
            onRun={centreOnShip}
          />
          <ActionButton
            actionId="space.ranges"
            runner={runner}
            pressed={showRanges}
            onRun={() => {
              setShowRanges((previous) => !previous);
            }}
          />
          <ActionButton
            actionId="space.setCourse"
            runner={runner}
            display="icon"
            available={runtime !== null}
            unavailableReason={
              commandAvailability(site.commands, 'movement.moveToPoint').unavailableReason ?? 'shortcut.unavailable'
            }
            expanded={menu?.kind === 'point'}
            onRun={() => {
              openPointMenuAtCentre();
            }}
          />
        </div>
        {menu?.kind === 'point' && runtime !== null ? (
          <ObjectContextMenu
            kind="point"
            label={translate('space.course.menu')}
            position={menu.position}
            onClose={() => {
              setMenu(null);
            }}
            onKeyDown={nudgeCoursePoint}
          >
            <CourseCommands
              data={data}
              site={site}
              runner={runner}
              pointKm={menu.pointKm}
              shipKm={playerPosition}
              onDone={() => {
                setMenu(null);
              }}
            />
          </ObjectContextMenu>
        ) : null}
        {menu?.kind !== 'object' || menuObject === null ? null : (
          <ObjectContextMenu
            label={translate('tactical.menu.label', {
              name: menuObject.player ? translate('space.object.you') : translate(menuObject.nameKey),
            })}
            position={menu.position}
            onClose={() => {
              setMenu(null);
            }}
          >
            <ObjectCommands
              object={menuObject}
              data={data}
              runner={runner}
              variant="menu"
              rangeKm={rangeKm}
              closestKm={closestKm}
              canFire={fire.available && weaponTargetId(combat, menuObject.id) === menuObject.id}
              fireReason={
                weaponTargetId(combat, menuObject.id) === menuObject.id
                  ? fire.unavailableReason
                  : 'tactical.weapons.targetNotLocked'
              }
              onFire={fireAtTarget}
              onDone={() => {
                setMenu(null);
              }}
            />
          </ObjectContextMenu>
        )}
      </div>

      {renderSidebar(
        <div className={`${styles['aside']} ${sidebar === null ? '' : styles['externalAside']}`}  role="region" aria-label={translate('cockpit.objects')} tabIndex={0}>
        <ObjectList
          objects={objects}
          combat={combat}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onContextMenu={openMenuFor}
        />
        {selected?.kind === 'wreck' ? (
          <LootPanel
            data={data}
            runner={runner}
            gateway={gateway}
            object={selected}
            wreck={wreckData}
            approachKm={presets.length === 0 ? null : closestKm}
            simulationTimeMs={simulationTimeMs}
          />
        ) : null}
        <SelectedObjectPanel
          object={selected}
          combat={combat}
          encounter={encounter}
          data={data}
          runner={runner}
          rangeKm={rangeKm}
          closestKm={closestKm}
          canFire={fire.available}
          fireReason={fire.unavailableReason}
          onFire={fireAtTarget}
        />
        <LocksPanel
          data={data}
          runner={runner}
          combat={combat}
          site={site}
          encounter={encounter}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <EncounterPanel
          encounter={encounter}
          site={site}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        </div>,
        sidebar,
      )}

      {data.error === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(data.error.messageKey, data.error.params)}
        </p>
      )}
      {data.transportMessageKey === null ? null : (
        <p className={styles['error']} role="alert">
          {translate(data.transportMessageKey)}
        </p>
      )}

      <CommandBar
        data={data}
        site={site}
        selected={selected}
        runner={runner}
        simulationTimeMs={simulationTimeMs}
        rangeKm={rangeKm}
        onRangeChange={setRangeKm}
      />

      <div className={styles['tactical']}>
        <WeaponsPanel
          data={data}
          runner={runner}
          combat={combat}
          site={site}
          encounter={encounter}
          targetId={targetId}
          fire={fire}
          onFire={fireAtTarget}
        />
        <ModulesPanel data={data} runner={runner} modules={combat?.modules ?? []} />

        <details className={styles['panelDisclosure']}>
          <summary>{translate('tactical.log.heading')}</summary>
          <CombatLog combat={combat} site={site} encounter={encounter} />
        </details>
      </div>
    </section>
  );
}

/** A course point to a tenth of a kilometre, as it is announced and sent. */
function roundedPoint(point: Point): Point {
  return { x: round(point.x), y: round(point.y) };
}

function round(value: number): number {
  // `+ 0` turns a negative zero into zero, so "-0" is never announced.
  return Math.round(value * 10) / 10 + 0;
}

/** Preserve the scene's selection state while placing context beside the activity. */
function renderSidebar(content: ReactNode, target: HTMLElement | null): ReactNode {
  return target === null ? content : createPortal(content, target);
}
