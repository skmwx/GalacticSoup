import { useEffect, useState, type JSX } from 'react';

import type { SiteData, SiteObjectData } from '@protocol';

import {
  ActionButton,
  ActionIcon,
  actionById,
  commandAvailability as availability,
  useActionShortcuts,
  type ActionRunner,
  type CommandAvailability as Availability,
} from '../actions';
import { TooltipButton } from '../common/TooltipButton';
import { formatDistanceKm } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { DestinationChooser } from './DestinationChooser';
import styles from './Space.module.css';

/**
 * The contextual command bar (Functional Specification 7.1, 19.2;
 * Technical Specification 12.3).
 *
 * Every control pairs a registry entry with the availability the engine
 * projected for it, so nothing here decides whether an order is legal. An
 * order that cannot be given now stays visible and says why, and the ranges
 * and arrival distances it offers are the authored ones the projection
 * carries rather than numbers chosen by the interface.
 *
 * Where to go is chosen below the orders, in the destination chooser: the
 * system's station, its encounter sites and the player's own wrecks, each
 * with its briefing, and the warp or dock that reaches it.
 *
 * @implements FUNC-7.1, FUNC-7.2, FUNC-7.3, FUNC-7.4, FUNC-19.2, FUNC-5.4, FUNC-9.12, TECH-12.3, MVP-AC-03, MVP-AC-08
 */

export interface CommandBarProps {
  readonly data: PlayData;
  readonly site: SiteData;
  readonly selected: SiteObjectData | null;
  readonly runner: ActionRunner;
  /** The clock the engine last answered with, for a wreck's countdown. */
  readonly simulationTimeMs: number;
  /** True while a click on the view will set the destination point. */
  readonly choosingPoint: boolean;
  onChoosingPointChange(choosing: boolean): void;
  /** The point a click on the view last chose, in kilometres. */
  readonly point: { readonly x: number; readonly y: number };
  /**
   * The distance range orders use. The screen holds it, because the context
   * menu gives the same orders at the same distance.
   */
  readonly rangeKm: number;
  onRangeChange(rangeKm: number): void;
}

const NO_SELECTION: Availability = { available: false, unavailableReason: 'shortcut.noSelection' };

export function CommandBar({
  data,
  site,
  selected,
  runner,
  simulationTimeMs,
  choosingPoint,
  onChoosingPointChange,
  point,
  rangeKm,
  onRangeChange,
}: CommandBarProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const presets = site.rangePresetsKm;
  // The coordinate fields are edited as text so a partial entry such as "-"
  // is not turned into a number before the player has finished typing.
  const [pointText, setPointText] = useState(() => asText(point));
  useEffect(() => {
    setPointText(asText(point));
  }, [point.x, point.y]);
  const destinationPoint = { x: Number(pointText.x), y: Number(pointText.y) };
  const pointUsable =
    Number.isFinite(destinationPoint.x) && Number.isFinite(destinationPoint.y);

  const siteCommand = (command: string): Availability => availability(site.commands, command);
  const targetCommand = (command: string): Availability =>
    selected === null ? NO_SELECTION : availability(selected.commands, command);

  const order = async (
    command: 'movement.approach' | 'movement.orbit' | 'movement.keepRange',
  ): Promise<void> => {
    if (selected === null) {
      return;
    }
    await data.send(command, { targetId: selected.id, distanceKm: rangeKm });
  };

  const moveToPoint = async (): Promise<void> => {
    if (!pointUsable) {
      return;
    }
    onChoosingPointChange(false);
    await data.send('movement.moveToPoint', {
      xKm: destinationPoint.x,
      yKm: destinationPoint.y,
    });
  };

  // A movement order needs a selected object; without one the key says so.
  // Stop is an emergency control and always goes to the engine, whose
  // answer is shown like any other refusal.
  const orderShortcut = (
    command: 'movement.approach' | 'movement.orbit' | 'movement.keepRange',
  ): string | undefined => {
    if (selected === null) return 'shortcut.noSelection';
    const state = targetCommand(command);
    if (!state.available) return state.unavailableReason ?? 'shortcut.unavailable';
    runner.run(command, () => order(command));
    return undefined;
  };

  useActionShortcuts({
    'movement.approach': () => orderShortcut('movement.approach'),
    'movement.orbit': () => orderShortcut('movement.orbit'),
    'movement.keepRange': () => orderShortcut('movement.keepRange'),
    'movement.stop': () => {
      runner.run('movement.stop', async () => {
        await data.send('movement.stop', {});
      });
    },
  });

  return (
    <section className={styles['commands']} aria-labelledby="commands-heading">
      <h3 id="commands-heading" className={styles['panelHeading']}>
        {translate('space.commands.heading')}
      </h3>

      <div className={styles['commandRow']}>
        <label className={styles['field']}>
          {translate('space.commands.range')}
          <select
            value={String(rangeKm)}
            onChange={(event) => {
              onRangeChange(Number(event.target.value));
            }}
          >
            {presets.map((preset) => (
              <option key={preset} value={String(preset)}>
                {translate('space.distance', { distance: formatDistanceKm(preset, locale) })}
              </option>
            ))}
          </select>
        </label>
        <ActionButton
          actionId="movement.approach"
          runner={runner}
          available={targetCommand('movement.approach').available}
          unavailableReason={targetCommand('movement.approach').unavailableReason}
          onRun={() => order('movement.approach')}
        />
        <ActionButton
          actionId="movement.orbit"
          runner={runner}
          available={targetCommand('movement.orbit').available}
          unavailableReason={targetCommand('movement.orbit').unavailableReason}
          onRun={() => order('movement.orbit')}
        />
        <ActionButton
          actionId="movement.keepRange"
          runner={runner}
          available={targetCommand('movement.keepRange').available}
          unavailableReason={targetCommand('movement.keepRange').unavailableReason}
          onRun={() => order('movement.keepRange')}
        />
        <ActionButton
          actionId="movement.stop"
          runner={runner}
          available={siteCommand('movement.stop').available}
          unavailableReason={siteCommand('movement.stop').unavailableReason}
          onRun={async () => {
            await data.send('movement.stop', {});
          }}
        />
      </div>

      <details className={styles['pointControls']}>
        <summary>{translate('cockpit.coordinates')}</summary>
      <div className={styles['commandRow']}>
        {/* Arming the view is presentation, not a command, so it does not
            go through the action runner. */}
        <TooltipButton
          className={styles['objectButton']}
          aria-pressed={choosingPoint}
          unavailable={!siteCommand('movement.moveToPoint').available}
          reason={translate(siteCommand('movement.moveToPoint').unavailableReason ?? 'shortcut.unavailable')}
          onClick={() => {
            onChoosingPointChange(!choosingPoint);
          }}
        >
          <ActionIcon icon={actionById('movement.moveToPoint').icon} />
          {choosingPoint
            ? translate('space.commands.pointCancel')
            : translate('space.commands.pointArm')}
        </TooltipButton>
        <label className={styles['field']}>
          {translate('space.commands.pointX')}
          <input
            type="number"
            value={pointText.x}
            onChange={(event) => {
              setPointText({ ...pointText, x: event.target.value });
            }}
          />
        </label>
        <label className={styles['field']}>
          {translate('space.commands.pointY')}
          <input
            type="number"
            value={pointText.y}
            onChange={(event) => {
              setPointText({ ...pointText, y: event.target.value });
            }}
          />
        </label>
        <ActionButton
          actionId="movement.moveToPoint"
          runner={runner}
          available={siteCommand('movement.moveToPoint').available && pointUsable}
          unavailableReason={
            pointUsable
              ? siteCommand('movement.moveToPoint').unavailableReason
              : 'space.commands.pointInvalid'
          }
          label={translate('space.commands.pointSubmit')}
          onRun={moveToPoint}
        />
      </div>
      </details>

      <DestinationChooser data={data} site={site} runner={runner} simulationTimeMs={simulationTimeMs} />

      {choosingPoint ? (
        <p className={styles['muted']} role="status">
          {translate('space.commands.pointHint')}
        </p>
      ) : null}
    </section>
  );
}

function asText(point: { readonly x: number; readonly y: number }): {
  x: string;
  y: string;
} {
  return { x: String(round(point.x)), y: String(round(point.y)) };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
