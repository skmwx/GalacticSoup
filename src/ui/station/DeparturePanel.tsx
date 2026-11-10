import { useState, type JSX } from 'react';

import type { ShipData } from '@protocol';

import { ActionButton, commandAvailability, type ActionRunner } from '../actions';
import { Dialog } from '../common/Dialog';
import { StatusMark } from '../common/StatusMark';
import { SubstitutedExplanation } from '../common/Explanation';
import { formatSimulationDuration } from '../format/duration';
import { formatPercent, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { usePreferences } from '../preferences';
import type { PlayData } from '../frame/usePlayData';
import styles from './Station.module.css';

/**
 * Leaving the station (Functional Specification 8.4, 10, 19.5; MVP Scope 3).
 *
 * Departure is only about leaving safely. Undocking needs no destination: the
 * ship arrives at the station's own site, and where to fly next - an
 * encounter, the player's own wreck or the station again - is chosen in space,
 * in the navigation panel, where each destination's briefing is read. A
 * destination chosen earlier, such as the wreck the loss report offers, is
 * named here because space navigation offers it first.
 *
 * Before the undock control it warns about what the player would regret in a
 * fight: a weapon with no ammunition loaded, a weapon with no spare rounds in
 * the hold to reload from, a ship with nothing that can shoot, and armour or
 * hull that has not been repaired (Functional Specification 10). The warnings
 * are the fit's own and the layers are the ship's; a warning never blocks
 * undocking. Undocking while one stands asks first, in a confirmation that
 * lists them again - one the player may switch off in the settings
 * (Functional Specification 20). What does block it - no ship, an invalid fit
 * or an open fitting draft - is the engine's refusal, shown on the control.
 *
 * Beside them it reports the capacitor: how full it is and, when it is not,
 * that the repair service recharges it for free and how much running time
 * would fill it otherwise, with the recharge formula written out. A ship that
 * leaves on an empty capacitor cannot run its booster, which the balance
 * simulations found to be the likeliest unexplained loss. This is an
 * explanation, not an undock rule (Functional Specification 9.8, 10, 19.6).
 *
 * @implements FUNC-19.5, FUNC-18, FUNC-8.4, MVP-AC-02, MVP-AC-03, MVP-AC-07
 */

export interface DeparturePanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

export function DeparturePanel({ data, runner }: DeparturePanelProps): JSX.Element {
  const translate = useTranslate();
  const destinations = data.destinations?.destinations ?? [];
  const bookmarks = data.destinations?.bookmarks ?? [];
  const undock = commandAvailability(data.site?.commands, 'ship.undock');
  const selected = destinations.find((entry) => entry.selected) ?? null;
  const selectedBookmark = bookmarks.find((entry) => entry.selected) ?? null;
  const { preferences } = usePreferences();
  const [confirming, setConfirming] = useState(false);
  const warnings = undockWarnings(data.ship, translate);
  const undockNow = async (): Promise<void> => {
    await data.send('ship.undock', {});
  };

  return (
    <section className={styles['panel']} aria-labelledby="departure-heading">
      <h3 id="departure-heading" className={styles['panelHeading']}>
        {translate('departure.heading')}
      </h3>
      <p className={styles['muted']}>{translate('departure.detail')}</p>

      <div className={styles['departureAction']}>
        <p
          className={styles['muted']}
          role="status"
          data-selection={selectedBookmark !== null ? 'bookmark' : selected !== null ? 'encounter' : 'none'}
        >
          {selectedBookmark !== null
            ? translate('departure.currentBookmark', {
                site: translate(selectedBookmark.siteNameKey),
              })
            : selected === null
              ? translate('departure.noneSelected')
              : translate('departure.currentSelection', { site: translate(selected.nameKey) })}
        </p>

        <UndockWarnings warnings={warnings} />
        <CapacitorReadiness ship={data.ship} />

        <div className={styles['toolbar']}>
          <ActionButton
            actionId="ship.undock"
            runner={runner}
            variant="primary"
            available={undock.available}
            unavailableReason={undock.unavailableReason}
            onRun={async () => {
              if (warnings.length > 0 && preferences.confirmations.undockWithWarnings) {
                setConfirming(true);
                return;
              }
              await undockNow();
            }}
          />
        </div>
      </div>
      <Dialog
        open={confirming}
        title={translate('departure.confirm.title')}
        onClose={() => {
          setConfirming(false);
        }}
        footer={
          <>
            <ActionButton
              actionId="ship.undock"
              runner={runner}
              variant="danger"
              label={translate('departure.confirm.undock')}
              available={undock.available}
              unavailableReason={undock.unavailableReason}
              onRun={async () => {
                setConfirming(false);
                await undockNow();
              }}
            />
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {translate('departure.confirm.stay')}
            </button>
          </>
        }
      >
        <p>{translate('departure.confirm.detail')}</p>
        <UndockWarnings warnings={warnings} />
        <p className={styles['muted']}>{translate('departure.confirm.setting')}</p>
      </Dialog>
    </section>
  );
}

/** The ship warnings that matter in a fight; unrepaired damage is added to them. */
const UNDOCK_WARNING_CODES: readonly string[] = ['noAmmunition', 'noReserveAmmunition', 'noWeapon'];

/**
 * The undock warnings as sentences: an unloaded or missing weapon, a weapon
 * with no spare rounds in the hold, and armour or hull that has not been
 * repaired. A warning about one slot ends with where to put it right.
 */
function undockWarnings(ship: ShipData | null, translate: ReturnType<typeof useTranslate>): readonly string[] {
  if (ship === null) {
    return [];
  }
  const fit = ship.warnings
    .filter((warning) => UNDOCK_WARNING_CODES.includes(warning.code))
    .map((warning) =>
      warning.slot === null
        ? translate(warning.messageKey, warning.params)
        : translate(`departure.slotWarning.${warning.code}`, {
            slot: `${translate(`slot.${warning.slot.kind}`)} ${String(warning.slot.index + 1)}`,
            warning: translate(warning.messageKey, warning.params),
          }),
    );
  const damaged = ship.layers.filter(
    (layer) => layer.layer !== 'shield' && layer.hitPoints < layer.maximumHitPoints,
  );
  return damaged.length === 0
    ? fit
    : [
        ...fit,
        translate('departure.damaged', {
          layers: damaged.map((layer) => translate(`layer.${layer.layer}`)).join(', '),
        }),
      ];
}

function UndockWarnings({ warnings }: { readonly warnings: readonly string[] }): JSX.Element | null {
  const translate = useTranslate();
  if (warnings.length === 0) {
    return null;
  }
  return (
    <ul className={styles['issues']} aria-label={translate('departure.warnings')} data-undock-warnings>
      {warnings.map((warning) => (
        <li key={warning} className={styles['warning']}>
          <StatusMark kind="warning" />
          {warning}
        </li>
      ))}
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
