import { useState, type JSX } from 'react';

import type {
  BookmarkDestinationData,
  DestinationData,
  SiteData,
  StationDestinationData,
} from '@protocol';

import {
  ActionButton,
  commandAvailability as availability,
  useActionShortcuts,
  type ActionRunner,
  type CommandAvailability as Availability,
} from '../actions';
import { formatSimulationDuration } from '../format/duration';
import { formatCredits, formatDistanceKm } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { wreckRemainingMs } from '../station/LossReport';
import styles from './Space.module.css';

/**
 * Choosing where to go from space (Functional Specification 5.4, 7.3, 7.4,
 * 9.11-9.12, 19.2; MVP Scope 3, 4.2).
 *
 * The player undocks without a destination and chooses one here, among the
 * system's stations, its encounter sites and their own wrecks. Each kind is
 * shown as what it is: the station by its authored name with no tier or
 * reward, an encounter with its tier, opponents, bounty, possible loot and how
 * often it has been cleared, and a wreck with where it lies, what waits there,
 * what is left in it and how long it has before it expires. Every choice stays
 * listed, and one that cannot be reached now says why.
 *
 * Choosing an encounter or a wreck records it as the destination with
 * `navigation.selectDestination` / `navigation.selectBookmark`, which marks a
 * destination and never moves the ship, so the briefing can be read in peace
 * and the choice survives a reload. The station has no selection of its own:
 * choosing it is presentation. Nothing moves until Warp, or Dock from inside
 * the station's own site, sends the ordinary command; both are the engine's
 * projected availability, never a rule decided here.
 *
 * The return shortcut keeps the old retreat key: away from the station it
 * sends `navigation.retreat`, the ordinary warp home, and at the station's
 * site it docks.
 *
 * @implements FUNC-5.4, FUNC-7.3, FUNC-7.4, FUNC-9.11, FUNC-9.12, FUNC-19.2, MVP-AC-02, MVP-AC-03, MVP-AC-08, MVP-AC-09
 */

export interface DestinationChooserProps {
  readonly data: PlayData;
  readonly site: SiteData;
  readonly runner: ActionRunner;
  /** The clock the engine last answered with, for a wreck's countdown. */
  readonly simulationTimeMs: number;
}

type Choice =
  | { readonly kind: 'station'; readonly key: string; readonly entry: StationDestinationData }
  | { readonly kind: 'encounter'; readonly key: string; readonly entry: DestinationData }
  | { readonly kind: 'bookmark'; readonly key: string; readonly entry: BookmarkDestinationData };

export function DestinationChooser({
  data,
  site,
  runner,
  simulationTimeMs,
}: DestinationChooserProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const stations = data.destinations?.stations ?? [];
  const encounters = [...(data.destinations?.destinations ?? [])].sort((a, b) => a.tier - b.tier);
  const bookmarks = data.destinations?.bookmarks ?? [];
  const choices: readonly Choice[] = [
    ...stations.map((entry): Choice => ({ kind: 'station', key: `station:${entry.stationId}`, entry })),
    ...encounters.map((entry): Choice => ({ kind: 'encounter', key: `encounter:${entry.encounterId}`, entry })),
    ...bookmarks.map((entry): Choice => ({ kind: 'bookmark', key: `bookmark:${entry.bookmarkId}`, entry })),
  ];
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [arrivalKm, setArrivalKm] = useState<number>(
    site.arrivalDistancesKm[site.arrivalDistancesKm.length - 1] ?? 0,
  );
  const chosen = choices.find((choice) => choice.key === pickedKey) ?? defaultChoice(choices);

  const home = stations.find((entry) => entry.home) ?? stations[0] ?? null;
  const dockStation = stations.find((entry) => availability(entry.commands, 'navigation.dock').available) ?? null;
  const dock: Availability =
    dockStation === null
      ? availability(home?.commands, 'navigation.dock')
      : availability(dockStation.commands, 'navigation.dock');
  // In the station's own site the station is docked with, not warped to.
  const docking = chosen?.kind === 'station' && chosen.entry.current ? chosen.entry : null;
  const warp: Availability =
    chosen === null
      ? { available: false, unavailableReason: 'destination.none' }
      : availability(chosen.entry.commands, chosen.kind === 'bookmark' ? 'navigation.warpToBookmark' : 'navigation.warp');

  const warpTo = async (choice: Choice): Promise<void> => {
    if (choice.kind === 'bookmark') {
      await data.send('navigation.warpToBookmark', { bookmarkId: choice.entry.bookmarkId, arrivalDistanceKm: arrivalKm });
      return;
    }
    await data.send('navigation.warp', { destinationSiteId: choice.entry.siteId, arrivalDistanceKm: arrivalKm });
  };
  const dockWith = async (station: StationDestinationData | null): Promise<void> => {
    if (station !== null) await data.send('navigation.dock', { stationId: station.stationId });
  };

  const choose = (choice: Choice): void => {
    setPickedKey(choice.key);
    // Recording the choice marks a destination; it never moves the ship.
    if (choice.kind === 'encounter' && !choice.entry.selected &&
      availability(choice.entry.commands, 'navigation.selectDestination').available) {
      runner.run('navigation.selectDestination', async () => {
        await data.send('navigation.selectDestination', { encounterId: choice.entry.encounterId });
      });
    }
    if (choice.kind === 'bookmark' && !choice.entry.selected &&
      availability(choice.entry.commands, 'navigation.selectBookmark').available) {
      runner.run('navigation.selectBookmark', async () => {
        await data.send('navigation.selectBookmark', { bookmarkId: choice.entry.bookmarkId });
      });
    }
  };

  const retreat = availability(site.commands, 'navigation.retreat');
  useActionShortcuts({
    'navigation.warp': () => {
      if (chosen === null || !warp.available) return warp.unavailableReason ?? 'shortcut.unavailable';
      runner.run('navigation.warp', () => warpTo(chosen));
      return undefined;
    },
    'navigation.dock': () => {
      if (dockStation === null || !dock.available) return dock.unavailableReason ?? 'shortcut.unavailable';
      runner.run('navigation.dock', () => dockWith(dockStation));
      return undefined;
    },
    // Return: the ordinary warp home, or the dock once the ship is there.
    'navigation.retreat': () => {
      if (home?.current === true) {
        if (dockStation === null || !dock.available) return dock.unavailableReason ?? 'shortcut.unavailable';
        runner.run('navigation.dock', () => dockWith(dockStation));
        return undefined;
      }
      if (!retreat.available) return retreat.unavailableReason ?? 'shortcut.unavailable';
      runner.run('navigation.retreat', async () => {
        await data.send('navigation.retreat', {});
      });
      return undefined;
    },
  });

  return (
    <section className={styles['destinations']} aria-labelledby="destinations-heading" data-destinations>
      <h4 id="destinations-heading" className={styles['panelHeading']}>
        {translate('destination.heading')}
      </h4>
      <ul className={styles['destinationList']} aria-label={translate('destination.list')}>
        {choices.map((choice) => (
          <li key={choice.key}>
            <button
              type="button"
              className={styles['objectButton']}
              aria-pressed={chosen?.key === choice.key}
              data-destination-choice={choice.key}
              onClick={() => {
                choose(choice);
              }}
            >
              <span>{choiceName(choice, translate)}</span>{' '}
              <span className={styles['objectKind']}>{choiceSummary(choice, translate, locale, simulationTimeMs)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className={styles['destinationBriefing']} aria-label={translate('destination.briefing')} role="group">
        {chosen === null ? (
          <p className={styles['muted']}>{translate('destination.none')}</p>
        ) : (
          <Briefing choice={chosen} simulationTimeMs={simulationTimeMs} />
        )}
        <div className={styles['commandRow']}>
          {docking !== null ? null : (
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
          )}
          {docking !== null ? (
            <ActionButton
              actionId="navigation.dock"
              runner={runner}
              variant="primary"
              available={availability(docking.commands, 'navigation.dock').available}
              unavailableReason={availability(docking.commands, 'navigation.dock').unavailableReason}
              label={translate('destination.dock', { name: translate(docking.nameKey) })}
              onRun={() => dockWith(docking)}
            />
          ) : (
            <ActionButton
              actionId="navigation.warp"
              runner={runner}
              variant="primary"
              available={warp.available}
              unavailableReason={warp.unavailableReason}
              {...(chosen === null ? {} : { label: warpLabel(chosen, translate) })}
              onRun={async () => {
                if (chosen !== null) await warpTo(chosen);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * What the chooser offers first: the destination recorded docked or earlier
 * in space, unless the ship is already there; otherwise the way home; and in
 * the station's own site, the easiest encounter.
 */
function defaultChoice(choices: readonly Choice[]): Choice | null {
  const away = (choice: Choice): boolean => !choice.entry.current;
  return (
    choices.find((choice) => choice.kind === 'bookmark' && choice.entry.selected && away(choice)) ??
    choices.find((choice) => choice.kind === 'encounter' && choice.entry.selected && away(choice)) ??
    choices.find((choice) => choice.kind === 'station' && choice.entry.home && away(choice)) ??
    choices.find((choice) => choice.kind === 'encounter' && away(choice)) ??
    choices[0] ??
    null
  );
}

type Translate = ReturnType<typeof useTranslate>;

function choiceName(choice: Choice, translate: Translate): string {
  switch (choice.kind) {
    case 'station':
      return translate(choice.entry.nameKey);
    case 'encounter':
      return translate(choice.entry.nameKey);
    case 'bookmark':
      return translate('destination.wreck', { site: translate(choice.entry.siteNameKey) });
  }
}

function warpLabel(choice: Choice, translate: Translate): string {
  return choice.kind === 'bookmark'
    ? translate('destination.warpWreck', { site: translate(choice.entry.siteNameKey) })
    : translate('destination.warp', { name: choiceName(choice, translate) });
}

/** The one line beside a destination's name. */
function choiceSummary(choice: Choice, translate: Translate, locale: string, simulationTimeMs: number): string {
  const here = choice.entry.current ? ` · ${translate('destination.here')}` : '';
  switch (choice.kind) {
    case 'station':
      return `${translate('destination.station')}${here}`;
    case 'encounter':
      return `${translate('destination.tier', { tier: choice.entry.tier })} · ${translate('destination.bounty', {
        bounty: formatCredits(choice.entry.totalBountyCredits, locale),
      })}${here}`;
    case 'bookmark':
      return `${translate('destination.expires', {
        remaining: formatSimulationDuration(
          wreckRemainingMs(choice.entry.expiresAtMs, choice.entry.remainingSeconds, simulationTimeMs),
        ),
      })}${here}`;
  }
}

/** What waits at the chosen destination, disclosed before any warp (MVP Scope 4.2). */
function Briefing({ choice, simulationTimeMs }: { readonly choice: Choice; readonly simulationTimeMs: number }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  if (choice.kind === 'station') {
    const entry = choice.entry;
    return (
      <div data-briefing={entry.stationId}>
        <p className={styles['strong']}>{translate(entry.nameKey)}</p>
        <p className={styles['muted']}>
          {translate(entry.current ? 'destination.stationHere' : 'destination.stationAway')}
        </p>
      </div>
    );
  }
  if (choice.kind === 'bookmark') {
    const entry = choice.entry;
    return (
      <div data-briefing={entry.bookmarkId}>
        <p className={styles['strong']}>
          {translate('destination.wreckName', {
            hull: translate(entry.hullNameKey),
            site: translate(entry.siteNameKey),
          })}
        </p>
        <ul className={styles['factList']}>
          <li>
            {entry.encounterNameKey === null
              ? translate('destination.nothingWaiting')
              : translate('destination.waiting', {
                  encounter: translate(entry.encounterNameKey),
                  tier: entry.tier ?? 0,
                })}
          </li>
          <li>
            {translate('destination.wreckRemaining', {
              count: entry.itemCount,
              remaining: formatSimulationDuration(
                wreckRemainingMs(entry.expiresAtMs, entry.remainingSeconds, simulationTimeMs),
              ),
            })}
          </li>
          <li className={styles['muted']}>{translate('destination.wreckArrival')}</li>
        </ul>
      </div>
    );
  }
  const entry = choice.entry;
  return (
    <div data-briefing={entry.encounterId}>
      <p className={styles['strong']}>
        {translate(entry.nameKey)}{' '}
        <span className={styles['objectKind']}>{translate('destination.tier', { tier: entry.tier })}</span>
      </p>
      <p className={styles['muted']}>
        {translate(entry.descriptionKey)} {translate(entry.rewardSummaryKey)}
      </p>
      <ul className={styles['factList']} data-disclosure={entry.encounterId}>
        {entry.spawns.map((spawn) => (
          <li key={spawn.npcProfileId}>
            {translate('destination.spawn', {
              count: spawn.count,
              name: translate(spawn.nameKey),
              role: translate(`role.${spawn.role}`),
              bounty: formatCredits(spawn.bountyCredits, locale),
            })}
          </li>
        ))}
        <li>{translate('destination.totalBounty', { bounty: formatCredits(entry.totalBountyCredits, locale) })}</li>
        <li>
          {entry.possibleLoot.length === 0
            ? translate('destination.noLoot')
            : translate('destination.loot', {
                items: entry.possibleLoot.map((item) => translate(item.nameKey)).join(', '),
              })}
        </li>
        <li>{translate('destination.completions', { count: entry.completionCount })}</li>
      </ul>
    </div>
  );
}
