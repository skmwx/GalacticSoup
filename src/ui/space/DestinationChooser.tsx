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
import { StatusMark } from '../common/StatusMark';
import { formatCredits, formatDistanceKm, formatPercent } from '../format/numbers';
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
 * The twelve-site ladder is grouped by difficulty band, easiest first, and a
 * band filter narrows the list without removing anything: it says how many
 * sites it is hiding, and every site stays selectable whatever the player
 * flies (FeatureSpec02 8.2). An encounter's briefing adds its archetype
 * threats, the decision it is built around, what answers it, what it punishes
 * and the drop chances behind its possible loot.
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
 * @implements FUNC-5.4, FUNC-7.3, FUNC-7.4, FUNC-9.11, FUNC-9.12, FUNC-19.2, MVP-AC-02, MVP-AC-03, MVP-AC-08, MVP-AC-09, V02-AC-09, V02-AC-10, V02-AC-14
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

/** One listed group: the stations, one difficulty band, or the wrecks. */
interface ChoiceGroup {
  readonly key: string;
  /** The band an encounter group lists, or `null` for stations and wrecks. */
  readonly band: number | null;
  readonly choices: readonly Choice[];
}

export function DestinationChooser({
  data,
  site,
  runner,
  simulationTimeMs,
}: DestinationChooserProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const stations = data.destinations?.stations ?? [];
  // Easiest first: by tier, then within a tier by the bounty on offer, so the
  // onboarding site stays first as the ladder grows (FeatureSpec02 8.2).
  const encounters = [...(data.destinations?.destinations ?? [])]
    .sort((a, b) => a.tier - b.tier || a.totalBountyCredits - b.totalBountyCredits);
  const bookmarks = data.destinations?.bookmarks ?? [];
  const choices: readonly Choice[] = [
    ...stations.map((entry): Choice => ({ kind: 'station', key: `station:${entry.stationId}`, entry })),
    ...encounters.map((entry): Choice => ({ kind: 'encounter', key: `encounter:${entry.encounterId}`, entry })),
    ...bookmarks.map((entry): Choice => ({ kind: 'bookmark', key: `bookmark:${entry.bookmarkId}`, entry })),
  ];
  // Encounters are grouped by band, easiest first; the filter narrows what is
  // listed but never what exists, and says how many it is hiding
  // (FeatureSpec02 8.2). Stations come first and wrecks last, unfiltered.
  const bands = [...new Set(encounters.map((entry) => entry.tier))].sort((a, b) => a - b);
  const [bandFilter, setBandFilter] = useState<number | null>(null);
  const shownBands = bands.filter((band) => bandFilter === null || band === bandFilter);
  const groups: readonly ChoiceGroup[] = [
    { key: 'stations', band: null, choices: choices.filter((choice) => choice.kind === 'station') },
    ...shownBands.map((band): ChoiceGroup => ({
      key: `band:${String(band)}`,
      band,
      choices: choices.filter((choice) => choice.kind === 'encounter' && choice.entry.tier === band),
    })),
    { key: 'bookmarks', band: null, choices: choices.filter((choice) => choice.kind === 'bookmark') },
  ].filter((group) => group.choices.length > 0);
  const hiddenCount = encounters.filter((entry) => !shownBands.includes(entry.tier)).length;
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
    // The list opens on a destination the player has not clicked; warping
    // there chooses it, so record it first as a click would (UIR1-10: else
    // the "Choose a site" step stayed open through the fight).
    await record(choice);
    if (choice.kind === 'bookmark') {
      await data.send('navigation.warpToBookmark', { bookmarkId: choice.entry.bookmarkId, arrivalDistanceKm: arrivalKm });
      return;
    }
    await data.send('navigation.warp', { destinationSiteId: choice.entry.siteId, arrivalDistanceKm: arrivalKm });
  };
  const dockWith = async (station: StationDestinationData | null): Promise<void> => {
    if (station !== null) await data.send('navigation.dock', { stationId: station.stationId });
  };

  /** Records an encounter or wreck as the destination; it never moves the ship. */
  const record = async (choice: Choice): Promise<void> => {
    if (choice.kind === 'encounter' && !choice.entry.selected &&
      availability(choice.entry.commands, 'navigation.selectDestination').available) {
      await data.send('navigation.selectDestination', { encounterId: choice.entry.encounterId });
    }
    if (choice.kind === 'bookmark' && !choice.entry.selected &&
      availability(choice.entry.commands, 'navigation.selectBookmark').available) {
      await data.send('navigation.selectBookmark', { bookmarkId: choice.entry.bookmarkId });
    }
  };

  const choose = (choice: Choice): void => {
    setPickedKey(choice.key);
    if (choice.kind === 'encounter' || choice.kind === 'bookmark') {
      runner.run(choice.kind === 'encounter' ? 'navigation.selectDestination' : 'navigation.selectBookmark', () =>
        record(choice));
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
      <div className={styles['destinationList']}>
        {bands.length > 1 ? (
          <label className={styles['field']}>
            {translate('destination.filter')}
            <select
              value={bandFilter === null ? '' : String(bandFilter)}
              data-band-filter
              onChange={(event) => {
                setBandFilter(event.target.value === '' ? null : Number(event.target.value));
              }}
            >
              <option value="">{translate('destination.filter.all')}</option>
              {bands.map((band) => (
                <option key={band} value={String(band)}>{bandLabel(band, translate)}</option>
              ))}
            </select>
          </label>
        ) : null}
        {groups.map((group) => (
          <div key={group.key} data-destination-group={group.key}>
            {group.band === null ? null : (
              <h5 id={`destination-band-${String(group.band)}`} className={styles['bandHeading']}>
                {bandLabel(group.band, translate)}
              </h5>
            )}
            <ul
              className={styles['destinationChoices']}
              aria-label={group.band === null ? translate('destination.list') : bandLabel(group.band, translate)}
            >
              {group.choices.map((choice) => (
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
          </div>
        ))}
        {hiddenCount > 0 ? (
          <p className={styles['muted']} data-band-hidden={hiddenCount}>
            {translate('destination.filter.hidden', { count: hiddenCount })}
          </p>
        ) : null}
      </div>

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

/** "Entry band · tier 1": the band's name with the tier it is (FeatureSpec02 8.1). */
export function bandLabel(tier: number, translate: Translate): string {
  return translate('destination.band', { band: translate(`destination.band.${String(tier)}`), tier });
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
      })}${choice.entry.fitSensitive ? ` · ${translate('destination.fitSensitiveTag')}` : ''}${here}`;
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
  return <EncounterBriefing entry={choice.entry} />;
}

/**
 * What an encounter holds and asks of the player, before any warp
 * (FeatureSpec02 7.2, 8.1-8.2): its band, opponents and the archetypes they
 * fly as, the decision it is built around, what answers it and what it
 * punishes, its bounty, and what its wrecks can hold with each opponent's
 * chance and quantity on demand. Every figure is the engine's, read from the
 * same definitions that pay the bounties and roll the wrecks. The band is a
 * recommendation: every site stays selectable, and an advanced site in quiet
 * space says that the system's danger rating does not describe it.
 */
export function EncounterBriefing({ entry }: { readonly entry: DestinationData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const opponentKind = (spawn: DestinationData['spawns'][number]): string =>
    spawn.archetype === null ? translate(`role.${spawn.role}`) : translate(`archetype.${spawn.archetype}`);
  const groups = (['module', 'ammunition', 'item'] as const)
    .map((kind) => ({ kind, items: entry.possibleLoot.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length > 0);
  return (
    <div data-briefing={entry.encounterId}>
      <p className={styles['strong']}>
        {translate(entry.nameKey)}{' '}
        <span className={styles['objectKind']}>{translate('destination.tier', { tier: entry.tier })}</span>{' '}
        <span className={styles['objectKind']} data-band={entry.tier}>{bandLabel(entry.tier, translate)}</span>
      </p>
      {entry.tier >= ADVANCED_BAND ? (
        <p className={styles['warning']} data-advanced-warning>
          <StatusMark kind="warning" />
          {translate('destination.advanced')}
        </p>
      ) : null}
      <p className={styles['muted']}>
        {translate(entry.descriptionKey)} {translate(entry.rewardSummaryKey)}
      </p>
      <ul className={styles['factList']} data-disclosure={entry.encounterId}>
        {entry.spawns.map((spawn) => (
          <li key={spawn.npcProfileId}>
            {translate('destination.spawn', {
              count: spawn.count,
              name: translate(spawn.nameKey),
              role: opponentKind(spawn),
              bounty: formatCredits(spawn.bountyCredits, locale),
            })}
          </li>
        ))}
        <li>{translate('destination.totalBounty', { bounty: formatCredits(entry.totalBountyCredits, locale) })}</li>
        <li>{translate('destination.completions', { count: entry.completionCount })}</li>
      </ul>
      <ul className={styles['plainList']} data-site-briefing={entry.encounterId}>
        {entry.threats.length === 0 ? null : (
          <li data-threats>
            {translate('destination.threats', {
              threats: entry.threats.map((threat) => translate(`archetype.${threat}`)).join(', '),
            })}
          </li>
        )}
        <li>{translate('destination.decision', { text: translate(entry.decisionKey) })}</li>
        <li>{translate('destination.recommended', { text: translate(entry.recommendationKey) })}</li>
        <li data-fit-sensitive={entry.fitSensitive ? 'true' : 'false'}>
          {entry.fitSensitive ? <StatusMark kind="warning" /> : null}
          {translate(entry.fitSensitive ? 'destination.weaknessSensitive' : 'destination.weakness', {
            text: translate(entry.weaknessKey),
          })}
        </li>
      </ul>
      {entry.possibleLoot.length === 0 ? (
        <p className={styles['muted']}>{translate('destination.noLoot')}</p>
      ) : (
        <>
          <p>
            {translate('destination.loot', {
              items: entry.possibleLoot.map((item) => translate(item.nameKey)).join(', '),
            })}{' '}
            <span className={styles['muted']}>{translate('destination.lootNotGuaranteed')}</span>
          </p>
          <details className={styles['disclosure']} data-loot-odds={entry.encounterId}>
            <summary>{translate('destination.lootOdds')}</summary>
            {groups.map((group) => (
              <div key={group.kind}>
                <p className={styles['subheadingSmall']}>{translate(`destination.lootGroup.${group.kind}`)}</p>
                <ul className={styles['plainList']}>
                  {group.items.map((item) => (
                    <li key={item.itemId} data-loot-item={item.itemId}>
                      <span className={styles['strong']}>{translate(item.nameKey)}</span>
                      {item.size === null ? null : ` (${translate(`size.${item.size}`)})`}
                      {': '}
                      {item.sources.map((source) => translate('destination.lootSource', {
                        count: source.count,
                        name: translate(source.nameKey),
                        chance: formatPercent(source.chance, locale),
                        quantity: source.quantityMinimum === source.quantityMaximum
                          ? String(source.quantityMinimum)
                          : `${String(source.quantityMinimum)}-${String(source.quantityMaximum)}`,
                      })).join('; ')}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className={styles['muted']}>{translate('destination.lootRule')}</p>
          </details>
        </>
      )}
    </div>
  );
}

/** The first tier of the advanced band (FeatureSpec02 8.1). */
const ADVANCED_BAND = 3;
