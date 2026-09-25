import type { JSX } from 'react';

import type {
  BookmarkDestinationData,
  LossData,
  LossDisablingEffectData,
  LossItemData,
  SlotRefData,
} from '@protocol';

import { ActionButton, commandAvailability, type ActionRunner } from '../actions';
import { FormulaExplanation } from '../common/Explanation';
import { formatSimulationDuration } from '../format/duration';
import { formatCredits, formatPercent, formatQuantity } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import styles from './Station.module.css';

/**
 * The loss report (Functional Specification 9.12, 19.6, 20; MVP Scope 4.4).
 *
 * A destroyed ship is explained, not merely announced: where and when it was
 * lost, who hit it, with which damage types and through which layers, what
 * the last damage was, what had stopped working, what was lost and what
 * survived into the wreck, what the insurance paid and why, and how the pilot
 * is able to fly again. Every one of those facts was frozen by the engine at
 * the moment of destruction; this lays them out and decides nothing. The one
 * thing it reads live is the wreck, which may since have been looted or have
 * expired, and which can be chosen as the destination from here.
 *
 * While the loss is the latest thing that happened the report is open on the
 * hub; once a later sortie has resolved it stays reachable, collapsed.
 * Nothing in it relies on colour: each state is written out.
 *
 * @implements FUNC-9.12, FUNC-19.6, FUNC-20, FUNC-5.4, MVP-AC-08, MVP-AC-10, TECH-12.1
 */

export interface LossReportProps {
  readonly report: LossData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  /** The clock the engine last answered with, for the wreck's countdown. */
  readonly simulationTimeMs: number;
  /** True while the loss is the most recent outcome, which opens the report. */
  readonly recent: boolean;
}

const LAYER_ORDER: readonly string[] = ['shield', 'armor', 'hull'];

export function LossReport({
  report,
  data,
  runner,
  simulationTimeMs,
  recent,
}: LossReportProps): JSX.Element {
  const translate = useTranslate();
  const body = (
    <div className={styles['detail']}>
      <LossSummary report={report} recent={recent} />
      <DamageTaken report={report} />
      <DisablingEffects effects={report.disablingEffects} />
      <Items report={report} simulationTimeMs={simulationTimeMs} />
      <Insurance report={report} />
      <Recovery report={report} data={data} runner={runner} />
    </div>
  );

  return (
    <section
      className={styles['loss']}
      aria-labelledby="loss-heading"
      data-loss={report.lossId}
      data-loss-recent={recent ? 'true' : 'false'}
      data-recovery={report.recovery.outcome}
    >
      <h3 id="loss-heading" className={styles['panelHeading']}>
        {recent ? translate('loss.heading') : translate('loss.headingPrevious')}
      </h3>
      {recent ? (
        body
      ) : (
        <details>
          <summary>{translate('loss.showPrevious')}</summary>
          {body}
        </details>
      )}
    </section>
  );
}

/** Where and when, and where the pilot woke up. */
function LossSummary({
  report,
  recent,
}: {
  readonly report: LossData;
  readonly recent: boolean;
}): JSX.Element {
  const translate = useTranslate();
  const params = {
    hull: translate(report.hullNameKey),
    site: translate(report.siteNameKey),
    time: formatSimulationDuration(report.destroyedAtMs),
    station: translate(report.recoveryStationNameKey),
  };
  return (
    <p {...(recent ? { role: 'status' } : {})} data-loss-summary>
      {report.encounterNameKey === null
        ? translate('loss.where', params)
        : translate('loss.whereEncounter', {
            ...params,
            encounter: translate(report.encounterNameKey),
          })}
    </p>
  );
}

/**
 * Who hit the ship, with what and through which layers, and the last damage
 * it took (Functional Specification 9.12 item 6).
 */
function DamageTaken({ report }: { readonly report: LossData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const final = report.finalDamage;

  return (
    <div className={styles['lossPart']}>
      <h4 className={styles['panelHeading']}>{translate('loss.damage.heading')}</h4>
      {report.incoming.length === 0 ? (
        <p className={styles['muted']}>{translate('loss.damage.none')}</p>
      ) : (
        <div className={styles['tableWrapper']}>
          <table className={styles['table']}>
            <caption className={styles['caption']}>{translate('loss.damage.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{translate('loss.damage.attacker')}</th>
                <th scope="col">{translate('loss.damage.hits')}</th>
                <th scope="col">{translate('loss.damage.applied')}</th>
                <th scope="col">{translate('loss.damage.types')}</th>
                <th scope="col">{translate('loss.damage.layers')}</th>
              </tr>
            </thead>
            <tbody>
              {report.incoming.map((source) => (
                <tr key={source.sourceId} data-attacker={source.sourceId}>
                  <th scope="row">{translate(source.nameKey)}</th>
                  <td className={styles['numeric']}>{formatQuantity(source.hits, locale)}</td>
                  <td className={styles['numeric']}>
                    {formatQuantity(source.appliedTotal, locale)}
                  </td>
                  <td>{describeProfile(source.appliedDamage, 'damage', translate, locale)}</td>
                  <td data-layers>
                    {describeProfile(source.layerDamage, 'layer', translate, locale, LAYER_ORDER)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.incoming.length === 0 ? null : (
        <p>
          {translate('loss.damage.total', {
            damage: formatQuantity(report.totalAppliedDamage, locale),
          })}
        </p>
      )}
      <p data-final-damage>
        {final === null
          ? translate('loss.final.none')
          : translate('loss.final', {
              name: translate(final.nameKey),
              slot: describeSlotKey(final.slotKey, translate),
              hits: formatQuantity(final.hits, locale),
              applied: formatQuantity(final.appliedTotal, locale),
              raw: formatQuantity(
                Object.values(final.rawDamage).reduce((sum, value) => sum + value, 0),
                locale,
              ),
              types: describeProfile(final.rawDamage, 'damage', translate, locale),
              time: formatSimulationDuration(final.atMs),
            })}
      </p>
    </div>
  );
}

/** What had stopped working by the end: capacitor or ammunition. */
function DisablingEffects({
  effects,
}: {
  readonly effects: readonly LossDisablingEffectData[];
}): JSX.Element {
  const translate = useTranslate();
  return (
    <div className={styles['lossPart']}>
      <h4 className={styles['panelHeading']}>{translate('loss.disabled.heading')}</h4>
      {effects.length === 0 ? (
        <p className={styles['muted']} data-disabling="none">
          {translate('loss.disabled.none')}
        </p>
      ) : (
        <ul className={styles['issues']} aria-label={translate('loss.disabled.heading')}>
          {effects.map((effect) => (
            <li
              key={`${effect.kind}:${effect.slot.kind}:${String(effect.slot.index)}`}
              data-disabling={effect.kind}
            >
              {translate(`loss.disabled.${effect.kind}`, {
                module: translate(effect.moduleNameKey),
                slot: describeSlot(effect.slot, translate),
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What was lost, what survived, and what is still waiting in the wreck. */
function Items({
  report,
  simulationTimeMs,
}: {
  readonly report: LossData;
  readonly simulationTimeMs: number;
}): JSX.Element {
  const translate = useTranslate();
  const lost = report.items.filter((item) => !item.survived);
  const survived = report.items.filter((item) => item.survived);
  const wreck = report.wreck;
  const site = translate(report.siteNameKey);
  const remaining = formatSimulationDuration(
    wreckRemainingMs(wreck.expiresAtMs, wreck.remainingSeconds, simulationTimeMs),
  );

  return (
    <div className={styles['lossPart']}>
      <h4 className={styles['panelHeading']}>{translate('loss.items.heading')}</h4>
      <p className={styles['muted']}>{translate('loss.items.rule')}</p>
      <p className={styles['muted']}>{translate('loss.items.lost')}</p>
      {lost.length === 0 ? (
        <p>{translate('loss.items.noneLost')}</p>
      ) : (
        <ul className={styles['issues']} aria-label={translate('loss.items.lostList')}>
          {lost.map((item, index) => (
            <ItemLine key={`${item.definitionId}:${String(index)}`} item={item} />
          ))}
        </ul>
      )}
      <p className={styles['muted']}>{translate('loss.items.survived')}</p>
      {survived.length === 0 ? (
        <p>{translate('loss.items.noneSurvived')}</p>
      ) : (
        <ul className={styles['issues']} aria-label={translate('loss.items.survivedList')}>
          {survived.map((item, index) => (
            <ItemLine key={`${item.definitionId}:${String(index)}`} item={item} />
          ))}
        </ul>
      )}
      <p data-wreck-state={wreck.present ? (wreck.itemCount > 0 ? 'present' : 'empty') : 'expired'}>
        {!wreck.present
          ? translate('loss.wreck.expired', { site })
          : wreck.itemCount > 0
            ? translate('loss.wreck.present', { site, count: wreck.itemCount, remaining })
            : translate('loss.wreck.empty', { site, remaining })}
      </p>
    </div>
  );
}

function ItemLine({ item }: { readonly item: LossItemData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  return (
    <li data-loss-item={item.definitionId} data-survived={item.survived ? 'true' : 'false'}>
      {translate('loss.items.line', {
        quantity: formatQuantity(item.quantity, locale),
        name: translate(item.nameKey),
        origin: translate(`loss.origin.${item.origin}`),
      })}
      {item.recoveryGrant ? (
        <span className={styles['grant']}> {translate('recovery.grant')}</span>
      ) : null}
    </li>
  );
}

/** What the insurance paid, and the formula behind it (Functional Specification 19.6). */
function Insurance({ report }: { readonly report: LossData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const insurance = report.insurance;
  const params = {
    coverage: translate(`insurance.coverage.${insurance.coverage}`),
    payout: formatCredits(insurance.payoutCredits, locale),
    fraction: formatPercent(insurance.payoutFraction, locale),
    value: formatCredits(insurance.hullReferenceValueCredits, locale),
  };

  return (
    <div className={styles['lossPart']} data-insurance={insurance.coverage}>
      <h4 className={styles['panelHeading']}>{translate('loss.insurance.heading')}</h4>
      <p>
        {insurance.recoveryGrantHull
          ? translate('loss.insurance.recoveryGrant')
          : translate('loss.insurance.paid', params)}
      </p>
      {insurance.enhancedConsumed ? (
        <p data-enhanced-consumed>{translate('loss.insurance.enhancedConsumed')}</p>
      ) : null}
      <p className={styles['muted']}>{translate('loss.insurance.hullOnly')}</p>
      <FormulaExplanation
        traces={[insurance.trace]}
        label={translate('loss.insurance.explain')}
      />
    </div>
  );
}

/**
 * How the pilot flies again, and the next step: the grant, another ship
 * already here, or the market (Functional Specification 9.12). A pilot left
 * without a ship is also told so by the hub's own notice, which opens the
 * market; the report explains why.
 */
function Recovery({
  report,
  data,
  runner,
}: {
  readonly report: LossData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const recovery = report.recovery;
  const ship =
    recovery.activeShipId === null
      ? null
      : (data.assets?.ships.find((entry) => entry.id === recovery.activeShipId) ?? null);
  const params = {
    ship: ship === null ? translate('loss.recovery.aShip') : translate(ship.nameKey),
    station: translate(report.recoveryStationNameKey),
    credits: formatCredits(recovery.creditsAfter, locale),
    threshold: formatCredits(recovery.starterReferenceValueCredits, locale),
  };
  const bookmark =
    data.destinations?.bookmarks.find((entry) => entry.bookmarkId === report.wreck.wreckId) ??
    null;

  return (
    <div className={styles['lossPart']} data-recovery-outcome={recovery.outcome}>
      <h4 className={styles['panelHeading']}>{translate('loss.recovery.heading')}</h4>
      <p>{translate(`loss.recovery.${recovery.outcome}`, params)}</p>
      <p className={styles['muted']}>{translate(`loss.next.${recovery.outcome}`, params)}</p>
      {report.wreck.present ? (
        <>
          {bookmark === null || bookmark.encounterNameKey === null ? null : (
            <p className={styles['muted']}>
              {translate('loss.wreck.danger', {
                site: translate(bookmark.siteNameKey),
                encounter: translate(bookmark.encounterNameKey),
                tier: bookmark.tier ?? 0,
              })}
            </p>
          )}
          <div className={styles['toolbar']}>
            <ChooseWreck bookmark={bookmark} data={data} runner={runner} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Chooses the wreck as the destination, as the departure panel does. */
function ChooseWreck({
  bookmark,
  data,
  runner,
}: {
  readonly bookmark: BookmarkDestinationData | null;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}): JSX.Element {
  const translate = useTranslate();
  const choose = commandAvailability(bookmark?.commands, 'navigation.selectBookmark');
  const selected = bookmark?.selected ?? false;
  return (
    <ActionButton
      actionId="navigation.selectBookmark"
      runner={runner}
      available={choose.available && !selected}
      unavailableReason={selected ? 'departure.bookmark.alreadySelected' : choose.unavailableReason}
      label={selected ? translate('loss.wreck.chosen') : translate('loss.wreck.choose')}
      onRun={async () => {
        if (bookmark !== null) {
          await data.send('navigation.selectBookmark', { bookmarkId: bookmark.bookmarkId });
        }
      }}
    />
  );
}

type Translate = ReturnType<typeof useTranslate>;

/**
 * The non-zero entries of a damage profile, largest first unless an order is
 * given, each named by its message family (`damage.*` or `layer.*`).
 */
function describeProfile(
  profile: Readonly<Record<string, number>>,
  family: 'damage' | 'layer',
  translate: Translate,
  locale: string,
  order?: readonly string[],
): string {
  const entries = Object.entries(profile).filter(([, value]) => Math.round(value) > 0);
  if (order === undefined) {
    entries.sort((left, right) => right[1] - left[1]);
  } else {
    entries.sort((left, right) => order.indexOf(left[0]) - order.indexOf(right[0]));
  }
  if (entries.length === 0) {
    return translate('loss.damage.nothing');
  }
  return entries
    .map(([key, value]) =>
      translate('loss.damage.entry', {
        name: translate(`${family}.${key}`),
        amount: formatQuantity(value, locale),
      }),
    )
    .join(', ');
}

function describeSlot(slot: SlotRefData, translate: Translate): string {
  return `${translate(`slot.${slot.kind}`)} ${String(slot.index + 1)}`;
}

/** The attacker's slot as the engine keys it, `kind:index`. */
function describeSlotKey(slotKey: string, translate: Translate): string {
  const [kind, index] = slotKey.split(':');
  const position = Number(index);
  if (kind === undefined || kind === '' || !Number.isInteger(position)) {
    return translate('loss.final.unknownSlot');
  }
  return describeSlot({ kind, index: position }, translate);
}

/**
 * How long the player's wreck has left, in simulation milliseconds.
 *
 * The projection's remaining time was true when it was read; the engine's
 * clock may have moved since while docked with time running. The later of the
 * two clocks decides, so the countdown never runs backwards and stops the
 * moment the simulation is paused (Functional Specification 5.4).
 */
export function wreckRemainingMs(
  expiresAtMs: number,
  projectedRemainingSeconds: number,
  simulationTimeMs: number,
): number {
  return Math.max(0, Math.min(projectedRemainingSeconds * 1000, expiresAtMs - simulationTimeMs));
}
