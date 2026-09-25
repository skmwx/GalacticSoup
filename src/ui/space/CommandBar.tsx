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
import { formatDistanceKm } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
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
 * The warp chooser offers the player's own wreck beside the encounter sites
 * (Functional Specification 5.4, 9.12). Its arrival distance is measured from
 * the wreck rather than from the site's centre, so the closest one puts the
 * ship beside what survived; a wreck chosen at the station is offered first,
 * as a chosen encounter is.
 *
 * @implements FUNC-7.1, FUNC-7.2, FUNC-7.3, FUNC-7.4, FUNC-19.2, FUNC-5.4, FUNC-9.12, TECH-12.3, MVP-AC-03, MVP-AC-08
 */

export interface CommandBarProps {
  readonly data: PlayData;
  readonly site: SiteData;
  readonly selected: SiteObjectData | null;
  readonly runner: ActionRunner;
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

const REFUSED: Availability = { available: false, unavailableReason: null };

/** A prefix that keeps a bookmark's option value apart from a site id. */
const BOOKMARK_VALUE = 'bookmark:';

/**
 * One place the warp control can aim at: an encounter's site, or a bookmark
 * with its own command and availability.
 */
interface WarpChoice {
  /** The option value: a site id, or a bookmark id behind a prefix. */
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
  readonly availability: Availability;
  readonly warp: (arrivalDistanceKm: number) => Promise<unknown>;
}

export function CommandBar({
  data,
  site,
  selected,
  runner,
  choosingPoint,
  onChoosingPointChange,
  point,
  rangeKm,
  onRangeChange,
}: CommandBarProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const presets = site.rangePresetsKm;
  const [arrivalKm, setArrivalKm] = useState<number>(
    site.arrivalDistancesKm[site.arrivalDistancesKm.length - 1] ?? 0,
  );
  const destinations = data.destinations?.destinations ?? [];
  const bookmarks = data.destinations?.bookmarks ?? [];
  const warpable: readonly WarpChoice[] = [
    // A wreck chosen at the station comes first, as the chosen encounter does.
    ...bookmarks
      .filter((entry) => availability(entry.commands, 'navigation.warpToBookmark').available)
      .map(
        (entry): WarpChoice => ({
          value: `${BOOKMARK_VALUE}${entry.bookmarkId}`,
          label: translate('space.commands.bookmark', { site: translate(entry.siteNameKey) }),
          selected: entry.selected,
          availability: availability(entry.commands, 'navigation.warpToBookmark'),
          warp: (arrivalDistanceKm) =>
            data.send('navigation.warpToBookmark', {
              bookmarkId: entry.bookmarkId,
              arrivalDistanceKm,
            }),
        }),
      ),
    ...destinations
      .filter((entry) => availability(entry.commands, 'navigation.warp').available)
      .map(
        (entry): WarpChoice => ({
          value: entry.siteId,
          label: translate(entry.nameKey),
          selected: entry.selected,
          availability: availability(entry.commands, 'navigation.warp'),
          warp: (arrivalDistanceKm) =>
            data.send('navigation.warp', { destinationSiteId: entry.siteId, arrivalDistanceKm }),
        }),
      ),
  ];
  const [destinationValue, setDestinationValue] = useState<string>('');
  // The coordinate fields are edited as text so a partial entry such as "-"
  // is not turned into a number before the player has finished typing.
  const [pointText, setPointText] = useState(() => asText(point));
  useEffect(() => {
    setPointText(asText(point));
  }, [point.x, point.y]);
  const destinationPoint = { x: Number(pointText.x), y: Number(pointText.y) };
  const pointUsable =
    Number.isFinite(destinationPoint.x) && Number.isFinite(destinationPoint.y);

  // Choosing a site or the player's wreck at the station marks it as the
  // destination (MVP Scope 3), so the warp control offers it until the player
  // picks another.
  const chosenDestination =
    warpable.find((entry) => entry.value === destinationValue) ??
    warpable.find((entry) => entry.selected) ??
    warpable.find((entry) => !entry.value.startsWith(BOOKMARK_VALUE)) ??
    warpable[0] ??
    null;

  const siteCommand = (command: string): Availability => availability(site.commands, command);
  const targetCommand = (command: string): Availability =>
    selected === null ? REFUSED : availability(selected.commands, command);

  const dockTarget =
    selected !== null && availability(selected.commands, 'navigation.dock').available
      ? selected
      : (site.site?.objects.find((object) =>
          availability(object.commands, 'navigation.dock').available,
        ) ?? null);
  const dock: Availability =
    dockTarget === null
      ? { available: false, unavailableReason: 'error.ruleViolation.dockUnavailable' }
      : availability(dockTarget.commands, 'navigation.dock');

  const warp: Availability =
    chosenDestination === null
      ? {
          available: false,
          unavailableReason:
            destinations[0] === undefined
              ? 'error.ruleViolation.destinationUnknown'
              : availability(destinations[0].commands, 'navigation.warp').unavailableReason,
        }
      : chosenDestination.availability;

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

  useActionShortcuts({
    'movement.approach': () => {
      runner.run('movement.approach', () => order('movement.approach'));
    },
    'movement.orbit': () => {
      runner.run('movement.orbit', () => order('movement.orbit'));
    },
    'movement.keepRange': () => {
      runner.run('movement.keepRange', () => order('movement.keepRange'));
    },
    'movement.stop': () => {
      runner.run('movement.stop', async () => {
        await data.send('movement.stop', {});
      });
    },
    'navigation.retreat': () => {
      runner.run('navigation.retreat', async () => {
        await data.send('navigation.retreat', {});
      });
    },
    'navigation.warp': () => {
      if (chosenDestination !== null && warp.available) {
        runner.run('navigation.warp', async () => {
          await chosenDestination.warp(arrivalKm);
        });
      }
    },
    'navigation.dock': () => {
      if (dockTarget !== null) {
        runner.run('navigation.dock', async () => {
          await data.send('navigation.dock', { stationId: dockTarget.id });
        });
      }
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

      <div className={styles['commandRow']}>
        {/* Arming the view is presentation, not a command, so it does not
            go through the action runner. */}
        <button
          type="button"
          className={styles['objectButton']}
          aria-pressed={choosingPoint}
          disabled={!siteCommand('movement.moveToPoint').available}
          onClick={() => {
            onChoosingPointChange(!choosingPoint);
          }}
        >
          <ActionIcon icon={actionById('movement.moveToPoint').icon} />
          {choosingPoint
            ? translate('space.commands.pointCancel')
            : translate('space.commands.pointArm')}
        </button>
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

      <div className={styles['commandRow']}>
        <label className={styles['field']}>
          {translate('space.commands.destination')}
          <select
            value={chosenDestination?.value ?? ''}
            disabled={warpable.length === 0}
            onChange={(event) => {
              setDestinationValue(event.target.value);
            }}
          >
            {warpable.length === 0 ? (
              <option value="">{translate('space.commands.noDestination')}</option>
            ) : null}
            {warpable.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['field']}>
          {translate('space.commands.arrival')}
          <select
            value={String(arrivalKm)}
            onChange={(event) => {
              setArrivalKm(Number(event.target.value));
            }}
          >
            {site.arrivalDistancesKm.map((distance) => (
              <option key={distance} value={String(distance)}>
                {translate('space.distance', { distance: formatDistanceKm(distance, locale) })}
              </option>
            ))}
          </select>
        </label>
        <ActionButton
          actionId="navigation.warp"
          runner={runner}
          available={warp.available}
          unavailableReason={warp.unavailableReason}
          onRun={async () => {
            if (chosenDestination !== null) {
              await chosenDestination.warp(arrivalKm);
            }
          }}
        />
        <ActionButton
          actionId="navigation.dock"
          runner={runner}
          available={dock.available}
          unavailableReason={dock.unavailableReason}
          onRun={async () => {
            if (dockTarget !== null) {
              await data.send('navigation.dock', { stationId: dockTarget.id });
            }
          }}
        />
        <ActionButton
          actionId="navigation.retreat"
          runner={runner}
          variant="danger"
          available={siteCommand('navigation.retreat').available}
          unavailableReason={siteCommand('navigation.retreat').unavailableReason}
          onRun={async () => {
            await data.send('navigation.retreat', {});
          }}
        />
      </div>

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
