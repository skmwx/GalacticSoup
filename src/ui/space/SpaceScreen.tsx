import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';

import { ActionButton, commandAvailability, useActionShortcuts, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { CombatLog } from './CombatLog';
import { CommandBar } from './CommandBar';
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
import type { Point, Viewport } from './camera';
import { fireAvailability, weaponTargetId } from './tactical';
import { useCamera } from './useCamera';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
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
}

/** The drawing's coordinate space. CSS scales it; the numbers stay stable. */
export const SPACE_VIEWPORT: Viewport = { widthPx: 960, heightPx: 600 };

interface MenuState {
  readonly objectId: string;
  readonly position: Point;
}

export function SpaceScreen({
  data,
  runner,
  gateway,
  simulationTimeMs,
  paused,
}: SpaceScreenProps): JSX.Element {
  const translate = useTranslate();
  const site = data.site;
  const runtime = site?.site ?? null;
  const combat = data.combat;
  const encounter = data.encounter;
  const camera = useCamera();
  const reducedMotion = usePrefersReducedMotion();
  const positions = useSiteMotion({ site, paused, reducedMotion });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choosingPoint, setChoosingPoint] = useState(false);
  const [point, setPoint] = useState<Point>({ x: 0, y: 0 });
  const [showRanges, setShowRanges] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
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
  const menuObject = menu === null ? null : (objects.find((object) => object.id === menu.objectId) ?? null);
  const targetId = weaponTargetId(combat, selectedId);
  const fire = fireAvailability(combat, targetId);

  // A selection is presentation, but it may not survive its subject: an object
  // that has left the site is no longer selected.
  useEffect(() => {
    if (selectedId !== null && selected === null) {
      setSelectedId(null);
    }
  }, [selectedId, selected]);

  useEffect(() => {
    if (menu !== null && menuObject === null) {
      setMenu(null);
    }
  }, [menu, menuObject]);

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

  const openMenuAt = (objectId: string, pagePoint: Point): void => {
    const box = stage.current?.getBoundingClientRect();
    setMenu({
      objectId,
      position: {
        x: Math.max(0, pagePoint.x - (box?.left ?? 0)),
        y: Math.max(0, pagePoint.y - (box?.top ?? 0)),
      },
    });
  };

  const openMenuFor = (objectId: string, anchor: Element): void => {
    const box = anchor.getBoundingClientRect();
    const stageBox = stage.current?.getBoundingClientRect();
    // Anchored beside the list entry but kept inside the stage, so it never
    // opens off-screen when the list sits below the view on a narrow layout.
    setMenu({
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
    'space.selectNext': () => {
      cycleSelection(1);
    },
    'space.selectPrevious': () => {
      cycleSelection(-1);
    },
    'targeting.lock': () => {
      if (selected !== null && commandAvailability(selected.commands, 'targeting.lock').available) {
        runner.run('targeting.lock', async () => {
          await data.send('targeting.lock', { targetId: selected.id });
        });
      }
    },
    'targeting.unlock': () => {
      if (selected !== null && commandAvailability(selected.commands, 'targeting.unlock').available) {
        runner.run('targeting.unlock', async () => {
          await data.send('targeting.unlock', { targetId: selected.id });
        });
      }
    },
    'loot.takeAll': () => {
      if (selected?.kind === 'wreck' && commandAvailability(selected.commands, 'loot.take').available) {
        runner.run('loot.takeAll', () => takeEverything(gateway, data, selected.id));
      }
    },
  });

  if (site === null) {
    return (
      <section className={styles['space']} aria-labelledby="space-heading">
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
    <section className={styles['space']} aria-labelledby="space-heading">
      <div className={styles['heading']}>
        <h2 id="space-heading" className={styles['title']}>
          {runtime === null ? translate('space.inTransit') : translate(runtime.siteNameKey)}
        </h2>
        {runtime === null ? null : (
          <p className={styles['subheading']}>
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

      <div className={styles['stage']} ref={stage}>
        <SiteView
          site={site}
          combat={combat}
          positions={positions}
          camera={camera.camera}
          viewport={SPACE_VIEWPORT}
          selectedId={selectedId}
          showRanges={showRanges}
          onSelect={setSelectedId}
          onPan={camera.panBy}
          choosingPoint={choosingPoint}
          onChoosePoint={(chosen) => {
            setPoint({ x: round(chosen.x), y: round(chosen.y) });
          }}
          onContextMenu={openMenuAt}
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
        </div>
        {menu === null || menuObject === null ? null : (
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

      <div className={styles['aside']}>
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
      </div>

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
        choosingPoint={choosingPoint}
        onChoosingPointChange={setChoosingPoint}
        point={point}
        rangeKm={rangeKm}
        onRangeChange={setRangeKm}
      />

      <div className={styles['tactical']}>
        <ShipStatusPanel combat={combat} site={site} encounter={encounter} />
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
        <CombatLog combat={combat} site={site} encounter={encounter} />
      </div>
    </section>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
