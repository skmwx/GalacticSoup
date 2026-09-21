import { useCallback, useEffect, useState, type JSX } from 'react';

import { ActionButton, useActionShortcuts, type ActionRunner } from '../actions';
import { useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { CommandBar } from './CommandBar';
import { ObjectList } from './ObjectList';
import { SelectedObjectPanel } from './SelectedObjectPanel';
import { SiteView } from './SiteView';
import styles from './Space.module.css';
import { TravelStatus } from './TravelStatus';
import type { Point, Viewport } from './camera';
import { useCamera } from './useCamera';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useSiteMotion } from './useSiteMotion';

/**
 * Everything the player sees while undocked
 * (Functional Specification 19.2, 19.3; Technical Specification 12.1-12.3).
 *
 * The screen owns nothing but presentation: which object is selected, where
 * the camera looks, and whether a click will choose a destination point. Every
 * fact it shows is a projection, and every order it sends is a command whose
 * answer is read back before anything changes on screen.
 *
 * @implements FUNC-19.2, FUNC-19.3, TECH-12.1, TECH-12.2, TECH-12.3, MVP-AC-03, MVP-AC-08
 */

export interface SpaceScreenProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  /** The clock the engine last answered with, for travel countdowns. */
  readonly simulationTimeMs: number;
  readonly paused: boolean;
}

/** The drawing's coordinate space. CSS scales it; the numbers stay stable. */
export const SPACE_VIEWPORT: Viewport = { widthPx: 960, heightPx: 600 };

export function SpaceScreen({
  data,
  runner,
  simulationTimeMs,
  paused,
}: SpaceScreenProps): JSX.Element {
  const translate = useTranslate();
  const site = data.site;
  const runtime = site?.site ?? null;
  const camera = useCamera();
  const reducedMotion = usePrefersReducedMotion();
  const positions = useSiteMotion({ site, paused, reducedMotion });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choosingPoint, setChoosingPoint] = useState(false);
  const [point, setPoint] = useState<Point>({ x: 0, y: 0 });

  const player = runtime?.objects.find((object) => object.player) ?? null;
  const selected = runtime?.objects.find((object) => object.id === selectedId) ?? null;

  // A selection is presentation, but it may not survive its subject: an object
  // that has left the site is no longer selected.
  useEffect(() => {
    if (selectedId !== null && selected === null) {
      setSelectedId(null);
    }
  }, [selectedId, selected]);

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

  useActionShortcuts({
    'space.zoomIn': camera.zoomIn,
    'space.zoomOut': camera.zoomOut,
    'space.centre': centreOnShip,
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
        />
      </div>

      <div className={styles['stage']}>
        <SiteView
          site={site}
          positions={positions}
          camera={camera.camera}
          viewport={SPACE_VIEWPORT}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onPan={camera.panBy}
          choosingPoint={choosingPoint}
          onChoosePoint={(chosen) => {
            setPoint({ x: round(chosen.x), y: round(chosen.y) });
          }}
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
        </div>
      </div>

      <div className={styles['aside']}>
        <ObjectList
          objects={runtime?.objects ?? []}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <SelectedObjectPanel object={selected} />
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
      />
    </section>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
