import type { JSX } from 'react';

import type { BookmarkDestinationData, DestinationData, ShipData } from '@protocol';

import { ActionButton, commandAvailability, type ActionRunner } from '../actions';
import { SubstitutedExplanation } from '../common/Explanation';
import { formatSimulationDuration } from '../format/duration';
import { formatCredits, formatPercent, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { wreckRemainingMs } from './LossReport';
import styles from './Station.module.css';

/**
 * Choosing an encounter and leaving the station
 * (MVP Scope 3; Functional Specification 19.5).
 *
 * Choosing a site marks it as the current destination; it does not move the
 * ship. The player undocks at the station site and warps from there, which is
 * the path the scope requires and the one that makes retreat and return mean
 * something.
 *
 * Tier and the reward summary are guidance shown before entry, not a gate:
 * every site stays visible, and whether it can be chosen comes from the
 * engine's projected availability. The summary names the opponents the site
 * is authored to hold, with their roles and bounties, the total bounty, the
 * loot they can drop and how often the site has been cleared, so the choice
 * of site - and of fit - is made knowing what waits there.
 *
 * Before the undock control it warns about what the player would regret in a
 * fight: a weapon with no ammunition loaded, a ship with nothing that can
 * shoot, and armour or hull that has not been repaired (Functional
 * Specification 10). The warnings are the fit's own and the layers are the
 * ship's; a warning never blocks undocking.
 *
 * Beside them it reports the capacitor: how full it is and, when it is not,
 * how much running time will fill it, with the recharge formula written out.
 * The capacitor recharges only while simulation time runs - docked or not -
 * and a ship that leaves on an empty one cannot run its booster, which the
 * balance simulations found to be the likeliest unexplained loss. This is an
 * explanation, not an undock rule (Functional Specification 9.8, 19.6).
 *
 * The player's own wreck carries an automatic bookmark (Functional
 * Specification 5.4, 9.12), and it is chosen here exactly as an encounter is:
 * each row names the hull it was, the site it lies in and what waits there,
 * how many stacks are left in it and how long it has before it expires.
 * Choosing it replaces a chosen encounter, and the reverse; the undock control
 * says why a pilot with no ship cannot leave.
 *
 * @implements FUNC-19.5, FUNC-18, FUNC-5.4, FUNC-9.12, MVP-AC-02, MVP-AC-03, MVP-AC-07, MVP-AC-08, MVP-AC-09
 */

export interface DeparturePanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  /** The clock the engine last answered with, for a wreck's countdown. */
  readonly simulationTimeMs: number;
}

export function DeparturePanel({
  data,
  runner,
  simulationTimeMs,
}: DeparturePanelProps): JSX.Element {
  const translate = useTranslate();
  const destinations = data.destinations?.destinations ?? [];
  const bookmarks = data.destinations?.bookmarks ?? [];
  const undock = commandAvailability(data.site?.commands, 'ship.undock');
  const selected = destinations.find((entry) => entry.selected) ?? null;
  const selectedBookmark = bookmarks.find((entry) => entry.selected) ?? null;

  return (
    <section className={styles['panel']} aria-labelledby="departure-heading">
      <h3 id="departure-heading" className={styles['panelHeading']}>
        {translate('departure.heading')}
      </h3>
      <p className={styles['muted']}>{translate('departure.detail')}</p>

      <div className={styles['tableWrapper']}>
        <table className={styles['table']} aria-label={translate('departure.table')}>
          <thead>
            <tr>
              <th scope="col">{translate('departure.site')}</th>
              <th scope="col">{translate('departure.tier')}</th>
              <th scope="col">{translate('departure.rewards')}</th>
              <th scope="col">{translate('departure.choose')}</th>
            </tr>
          </thead>
          <tbody>
            {destinations.map((entry) => {
              const choose = commandAvailability(entry.commands, 'navigation.selectDestination');
              return (
                <tr key={entry.encounterId} data-destination={entry.encounterId}>
                  <th scope="row">
                    {translate(entry.nameKey)}
                    <span className={styles['muted']}> {translate(entry.descriptionKey)}</span>
                  </th>
                  <td>{translate('departure.tierValue', { tier: entry.tier })}</td>
                  <td>
                    {translate(entry.rewardSummaryKey)}
                    <Disclosure entry={entry} />
                  </td>
                  <td>
                    <ActionButton
                      actionId="navigation.selectDestination"
                      runner={runner}
                      available={choose.available && !entry.selected}
                      unavailableReason={
                        entry.selected ? 'departure.alreadySelected' : choose.unavailableReason
                      }
                      label={
                        entry.selected
                          ? translate('departure.selected')
                          : translate('departure.select', { site: translate(entry.nameKey) })
                      }
                      onRun={async () => {
                        await data.send('navigation.selectDestination', {
                          encounterId: entry.encounterId,
                        });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {bookmarks.length === 0 ? null : (
        <BookmarkTable
          bookmarks={bookmarks}
          data={data}
          runner={runner}
          simulationTimeMs={simulationTimeMs}
        />
      )}

      <p
        className={styles['muted']}
        role="status"
        data-selection={selectedBookmark === null ? 'encounter' : 'bookmark'}
      >
        {selectedBookmark !== null
          ? translate('departure.currentBookmark', {
              site: translate(selectedBookmark.siteNameKey),
            })
          : selected === null
            ? translate('departure.noneSelected')
            : translate('departure.currentSelection', { site: translate(selected.nameKey) })}
      </p>

      <UndockWarnings ship={data.ship} />
      <CapacitorReadiness ship={data.ship} />

      <div className={styles['toolbar']}>
        <ActionButton
          actionId="ship.undock"
          runner={runner}
          variant="primary"
          available={undock.available}
          unavailableReason={undock.unavailableReason}
          onRun={async () => {
            await data.send('ship.undock', {});
          }}
        />
      </div>
    </section>
  );
}

/**
 * The player's own wrecks as destinations (Functional Specification 5.4,
 * 9.12). What waits at the site is disclosed beside each, because the wreck
 * lies where the ship was lost.
 */
function BookmarkTable({
  bookmarks,
  data,
  runner,
  simulationTimeMs,
}: {
  readonly bookmarks: readonly BookmarkDestinationData[];
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly simulationTimeMs: number;
}): JSX.Element {
  const translate = useTranslate();
  return (
    <>
      <h4 className={styles['panelHeading']}>{translate('departure.bookmarks.heading')}</h4>
      <p className={styles['muted']}>{translate('departure.bookmarks.detail')}</p>
      <div className={styles['tableWrapper']}>
        <table className={styles['table']} aria-label={translate('departure.bookmarks.table')}>
          <thead>
            <tr>
              <th scope="col">{translate('departure.bookmarks.wreck')}</th>
              <th scope="col">{translate('departure.bookmarks.waiting')}</th>
              <th scope="col">{translate('departure.bookmarks.contents')}</th>
              <th scope="col">{translate('departure.choose')}</th>
            </tr>
          </thead>
          <tbody>
            {bookmarks.map((bookmark) => {
              const choose = commandAvailability(bookmark.commands, 'navigation.selectBookmark');
              const site = translate(bookmark.siteNameKey);
              return (
                <tr key={bookmark.bookmarkId} data-bookmark={bookmark.bookmarkId}>
                  <th scope="row">
                    {translate('departure.bookmarks.name', {
                      hull: translate(bookmark.hullNameKey),
                      site,
                    })}
                  </th>
                  <td>
                    {bookmark.encounterNameKey === null
                      ? translate('departure.bookmarks.nothingWaiting')
                      : translate('departure.bookmarks.encounter', {
                          encounter: translate(bookmark.encounterNameKey),
                          tier: bookmark.tier ?? 0,
                        })}
                  </td>
                  <td>
                    {translate('departure.bookmarks.remaining', {
                      count: bookmark.itemCount,
                      remaining: formatSimulationDuration(
                        wreckRemainingMs(
                          bookmark.expiresAtMs,
                          bookmark.remainingSeconds,
                          simulationTimeMs,
                        ),
                      ),
                    })}
                  </td>
                  <td>
                    <ActionButton
                      actionId="navigation.selectBookmark"
                      runner={runner}
                      available={choose.available && !bookmark.selected}
                      unavailableReason={
                        bookmark.selected
                          ? 'departure.bookmark.alreadySelected'
                          : choose.unavailableReason
                      }
                      label={
                        bookmark.selected
                          ? translate('departure.selected')
                          : translate('departure.bookmarks.select', { site })
                      }
                      onRun={async () => {
                        await data.send('navigation.selectBookmark', {
                          bookmarkId: bookmark.bookmarkId,
                        });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The fit warnings that matter in a fight, and unrepaired damage. */
const UNDOCK_WARNING_CODES: readonly string[] = ['noAmmunition', 'noWeapon'];

function UndockWarnings({ ship }: { readonly ship: ShipData | null }): JSX.Element | null {
  const translate = useTranslate();
  if (ship === null) {
    return null;
  }
  const warnings = ship.warnings.filter((warning) => UNDOCK_WARNING_CODES.includes(warning.code));
  const damaged = ship.layers.filter(
    (layer) => layer.layer !== 'shield' && layer.hitPoints < layer.maximumHitPoints,
  );
  if (warnings.length === 0 && damaged.length === 0) {
    return null;
  }
  return (
    <ul className={styles['issues']} aria-label={translate('departure.warnings')} data-undock-warnings>
      {warnings.map((warning) => (
        <li key={`${warning.code}:${warning.slot?.index ?? 'fit'}`} className={styles['warning']}>
          {warning.slot === null
            ? translate(warning.messageKey, warning.params)
            : translate('departure.slotWarning', {
                slot: `${translate(`slot.${warning.slot.kind}`)} ${String(warning.slot.index + 1)}`,
                warning: translate(warning.messageKey, warning.params),
              })}
        </li>
      ))}
      {damaged.length === 0 ? null : (
        <li className={styles['warning']}>
          {translate('departure.damaged', {
            layers: damaged.map((layer) => translate(`layer.${layer.layer}`)).join(', '),
          })}
        </li>
      )}
    </ul>
  );
}

/**
 * How charged the capacitor is and how long it takes to fill
 * (Functional Specification 9.8, 19.6).
 */
function CapacitorReadiness({ ship }: { readonly ship: ShipData | null }): JSX.Element | null {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  if (ship === null || ship.capacitor.capacity <= 0) {
    return null;
  }
  const capacitor = ship.capacitor;
  const fraction = capacitor.charge / capacitor.capacity;
  const full = capacitor.secondsToFull <= 0;
  return (
    <div className={styles['muted']} data-capacitor-readiness={full ? 'full' : 'charging'}>
      <p className={styles['muted']}>
        {full
          ? translate('departure.capacitor.full', { percent: formatPercent(fraction, locale) })
          : translate('departure.capacitor.charging', {
              percent: formatPercent(fraction, locale),
              duration: formatSimulationDuration(capacitor.secondsToFull * 1000),
            })}
      </p>
      {full ? null : (
        <SubstitutedExplanation
          trace={capacitor.rechargeTrace}
          label={translate('departure.capacitor.explain')}
          result={translate('departure.capacitor.seconds', {
            seconds: formatStat(capacitor.rechargeTrace.displayResult, locale),
          })}
        />
      )}
    </div>
  );
}

/** What a site discloses before entry (MVP Scope 4.2). */
function Disclosure({ entry }: { readonly entry: DestinationData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  return (
    <ul className={styles['disclosureList']} data-disclosure={entry.encounterId}>
      {entry.spawns.map((spawn) => (
        <li key={spawn.npcProfileId}>
          {translate('departure.spawn', {
            count: spawn.count,
            name: translate(spawn.nameKey),
            role: translate(`role.${spawn.role}`),
            bounty: formatCredits(spawn.bountyCredits, locale),
          })}
        </li>
      ))}
      <li>
        {translate('departure.totalBounty', {
          bounty: formatCredits(entry.totalBountyCredits, locale),
        })}
      </li>
      <li>
        {entry.possibleLoot.length === 0
          ? translate('departure.noLoot')
          : translate('departure.loot', {
              items: entry.possibleLoot.map((item) => translate(item.nameKey)).join(', '),
            })}
      </li>
      <li>{translate('departure.completions', { count: entry.completionCount })}</li>
    </ul>
  );
}
