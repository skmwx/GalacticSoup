import { useId, useState, type JSX } from 'react';

import type {
  AmmunitionOptionData,
  CombatData,
  EncounterData,
  SiteData,
  WeaponRuntimeData,
} from '@protocol';

import { ActionButton, ActionIcon, commandAvailability, useActionShortcuts, type ActionRunner } from '../actions';
import { SubstitutedExplanation } from '../common/Explanation';
import { useTooltip } from '../common/Tooltip';
import { formatDistanceKm, formatPercent, formatQuantity, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { CycleClock, type CycleClockState } from './CycleClock';
import styles from './Space.module.css';
import { damageBreakdown, describeSubject, subjectName, type FireAvailability } from './tactical';

/**
 * Turrets, their charges and what they would do right now
 * (Functional Specification 9.4-9.5, 19.3, 19.6).
 *
 * This is the first half of the equipment panel beside Navigation; its
 * subsection keeps its own heading, so it stays a named region.
 *
 * The controls that act on every weapon at once - fire, cease fire, reload
 * all - stay on top. Beneath them each weapon is one compact entry in slot
 * order: its name, a round clock for its cycle, the magazine as
 * `loaded/size (hold)` beside an ammunition icon, its own reload, and a
 * fire switch. What a fight needs less often folds beneath the entry and opens
 * from its name: changing charge, optimal, falloff and reach, the hit chance
 * against the aimed target with the strain that limits it and the formula
 * behind it, and the expected damage of a shot. Every control is a registry
 * action paired with the availability the engine projected for it.
 *
 * @implements FUNC-9.4, FUNC-9.5, FUNC-19.3, FUNC-19.6, TECH-12.3, MVP-AC-03, MVP-AC-04
 */

export interface WeaponsPanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly combat: CombatData | null;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
  /** The locked target the weapon controls aim at, or `null`. */
  readonly targetId: string | null;
  /** Whether firing at that target can do anything, and why not. */
  readonly fire: FireAvailability;
  /** Opens fire with every weapon that can, at the aimed target. */
  onFire(): Promise<void>;
}

export function WeaponsPanel({
  data,
  runner,
  combat,
  site,
  encounter,
  targetId,
  fire,
  onFire,
}: WeaponsPanelProps): JSX.Element {
  const translate = useTranslate();
  const weapons = combat?.weapons ?? [];
  const shipId = combat?.shipId ?? null;
  const targetName =
    targetId === null ? null : describeSubject(subjectName(targetId, site, encounter, shipId), translate);

  const ceasing = weapons.filter((weapon) => commandAvailability(weapon.commands, 'weapon.deactivate').available);
  const reloading = weapons.filter((weapon) => commandAvailability(weapon.commands, 'weapon.reload').available);

  const ceaseAll = async (): Promise<void> => {
    for (const weapon of ceasing) {
      await data.send('weapon.deactivate', { slotKind: weapon.slot.kind, slotIndex: weapon.slot.index });
    }
  };
  const reloadAll = async (): Promise<void> => {
    for (const weapon of reloading) {
      await data.send('weapon.reload', { slotKind: weapon.slot.kind, slotIndex: weapon.slot.index });
    }
  };

  const reloadRefusal =
    weapons.map((weapon) => commandAvailability(weapon.commands, 'weapon.reload').unavailableReason)
      .find((reason) => reason !== null) ?? null;

  // A key that cannot act says why, as the button beside it does.
  useActionShortcuts({
    'weapons.fire': () => {
      if (!fire.available) return fire.unavailableReason ?? 'shortcut.unavailable';
      runner.run('weapons.fire', onFire);
      return undefined;
    },
    'weapons.cease': () => {
      if (ceasing.length === 0) return 'tactical.weapons.noneFiring';
      runner.run('weapons.cease', ceaseAll);
      return undefined;
    },
    'weapons.reload': () => {
      if (reloading.length === 0) return reloadRefusal ?? 'shortcut.unavailable';
      runner.run('weapons.reload', reloadAll);
      return undefined;
    },
  });

  return (
    <section className={styles['equipmentGroup']} aria-labelledby="weapons-heading" data-panel="weapons">
      <div className={styles['equipmentGroupHead']}>
        <h4 id="weapons-heading" className={styles['panelHeading']}>
          {translate('tactical.weapons.heading')}
        </h4>
        <p className={styles['muted']} data-weapon-target={targetId ?? ''}>
          {targetName === null
            ? translate('tactical.weapons.noTarget')
            : translate('tactical.weapons.aimedAt', { target: targetName })}
        </p>
      </div>

      <div className={styles['commandRow']}>
        <ActionButton
          actionId="weapons.fire"
          runner={runner}
          variant="primary"
          available={fire.available}
          unavailableReason={fire.unavailableReason}
          onRun={onFire}
        />
        <ActionButton
          actionId="weapons.cease"
          runner={runner}
          available={ceasing.length > 0}
          unavailableReason="tactical.weapons.noneFiring"
          onRun={ceaseAll}
        />
        <ActionButton
          actionId="weapons.reload"
          runner={runner}
          available={reloading.length > 0}
          unavailableReason={reloadRefusal}
          onRun={reloadAll}
        />
      </div>

      {weapons.length === 0 ? (
        <p className={styles['muted']}>{translate('tactical.weapons.none')}</p>
      ) : (
        <ul className={styles['entryList']}>
          {weapons.map((weapon) => (
            <WeaponEntry
              key={`${weapon.slot.kind}:${String(weapon.slot.index)}`}
              weapon={weapon}
              data={data}
              runner={runner}
              targetId={targetId}
              site={site}
              encounter={encounter}
              shipId={shipId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface WeaponEntryProps {
  readonly weapon: WeaponRuntimeData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly targetId: string | null;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
  readonly shipId: string | null;
}

/** One weapon: a line of routine controls, with its details folded beneath. */
function WeaponEntry({
  weapon,
  data,
  runner,
  targetId,
  site,
  encounter,
  shipId,
}: WeaponEntryProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const detailId = useId();
  const [expanded, setExpanded] = useState(false);
  const slot = { slotKind: weapon.slot.kind, slotIndex: weapon.slot.index };
  const slotNumber = weapon.slot.index + 1;
  const activate = commandAvailability(weapon.commands, 'weapon.activate');
  const deactivate = commandAvailability(weapon.commands, 'weapon.deactivate');
  const reload = commandAvailability(weapon.commands, 'weapon.reload');
  // The switch is on while the weapon repeats; turning it off lets the
  // current cycle finish, as Cease fire does.
  const ceasing = weapon.repeating && deactivate.available;
  const nameOf = (id: string): string => describeSubject(subjectName(id, site, encounter, shipId), translate);
  const status = statusKind(weapon);

  return (
    <li
      className={styles['entry']}
      data-weapon={`${weapon.slot.kind}:${String(weapon.slot.index)}`}
      data-expanded={expanded}
    >
      <div className={styles['entryHead']}>
        <button
          type="button"
          className={styles['entryToggle']}
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => {
            setExpanded((open) => !open);
          }}
        >
          <span className={styles['entryChevron']} aria-hidden="true" />
          <span className={styles['entryName']}>{translate(weapon.nameKey)}</span>
          <span className={styles['visuallyHidden']}>
            {translate('tactical.weapons.details', { slot: slotNumber })}
          </span>
        </button>
        <CycleClock
          state={clockState(status)}
          elapsed={cycleElapsed(weapon)}
          label={clockLabel(weapon, status, translate, locale)}
        />
        <Magazine weapon={weapon} />
        <ActionButton
          actionId="weapon.reload"
          runner={runner}
          display="icon"
          available={reload.available}
          unavailableReason={reload.unavailableReason}
          label={translate('tactical.weapons.reloadSlot', { slot: slotNumber })}
          onRun={async () => {
            await data.send('weapon.reload', slot);
          }}
        />
        <span className={styles['entrySwitch']}>
          <ActionButton
            actionId={ceasing ? 'weapon.deactivate' : 'weapon.activate'}
            runner={runner}
            display="icon"
            icon="fire"
            pressed={weapon.repeating}
            available={ceasing || (activate.available && targetId !== null)}
            unavailableReason={
              targetId === null && !ceasing ? 'tactical.weapons.noTarget' : activate.unavailableReason
            }
            label={translate(ceasing ? 'tactical.weapons.ceaseSlot' : 'tactical.weapons.fireSlot', {
              slot: slotNumber,
            })}
            onRun={async () => {
              if (ceasing) {
                await data.send('weapon.deactivate', slot);
              } else if (targetId !== null) {
                await data.send('weapon.activate', { ...slot, targetId });
              }
            }}
          />
        </span>
      </div>
      <p className={styles['entryStatus']} data-weapon-status={status}>
        {describeStatus(weapon, status, translate, locale, nameOf)}
      </p>
      <div id={detailId} className={styles['entryDetail']} hidden={!expanded}>
        <WeaponDetail weapon={weapon} data={data} runner={runner} targetId={targetId} />
      </div>
    </li>
  );
}

/** `17/20 (180)` beside an ammunition icon, and the same in words. */
function Magazine({ weapon }: { readonly weapon: WeaponRuntimeData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const loaded = weapon.ammunitionOptions.find((option) => option.loaded) ?? null;
  const hold = loaded?.cargoRounds ?? 0;
  const words = translate('tactical.weapons.magazine', {
    charge:
      weapon.ammunitionNameKey === null
        ? translate('tactical.weapons.empty')
        : translate(weapon.ammunitionNameKey),
    loaded: formatQuantity(weapon.loadedRounds, locale),
    size: formatQuantity(weapon.magazineSize, locale),
    hold: formatQuantity(hold, locale),
  });
  const tooltip = useTooltip({ heading: <span>{words}</span> });

  return (
    <span
      className={styles['magazine']}
      data-magazine={`${String(weapon.loadedRounds)}/${String(weapon.magazineSize)}`}
      data-empty={weapon.loadedRounds === 0}
      {...tooltip.anchorProps}
    >
      <ActionIcon icon="ammunition" className={styles['magazineIcon']} />
      <span aria-hidden="true">
        {translate('tactical.weapons.magazineShort', {
          loaded: formatQuantity(weapon.loadedRounds, locale),
          size: formatQuantity(weapon.magazineSize, locale),
          hold: formatQuantity(hold, locale),
        })}
      </span>
      <span className={styles['visuallyHidden']}>{words}</span>
      {tooltip.element}
    </span>
  );
}

interface WeaponDetailProps {
  readonly weapon: WeaponRuntimeData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly targetId: string | null;
}

/**
 * What a weapon folds away: its charge choice, its ranges, and what it would
 * do to the aimed target.
 */
function WeaponDetail({ weapon, data, runner, targetId }: WeaponDetailProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const effect = targetId === null ? undefined : weapon.effects.find((entry) => entry.targetId === targetId);

  return (
    <>
      <ChargeChoice weapon={weapon} data={data} runner={runner} />
      <dl className={styles['readouts']}>
        <dt>{translate('tactical.weapons.ranges')}</dt>
        <dd>
          {translate('tactical.weapons.rangeValue', {
            optimal: formatDistanceKm(weapon.optimalRangeKm, locale),
            falloff: formatDistanceKm(weapon.falloffKm, locale),
            absolute: formatDistanceKm(weapon.absoluteRangeKm, locale),
          })}
        </dd>
        {effect === undefined ? null : (
          <>
            <dt>{translate('tactical.weapons.hitChanceTerm')}</dt>
            <dd className={styles['hitChance']} data-hit-chance={String(effect.hitChance)}>
              {formatPercent(effect.hitChance, locale)}
            </dd>
            <dt>{translate('tactical.weapons.strainTerm')}</dt>
            <dd data-limiting={effect.limitingFactor}>
              {translate(`tactical.limiting.${effect.limitingFactor}`, {
                range: formatStat(effect.rangeStrain, locale),
                tracking: formatStat(effect.trackingStrain, locale),
              })}
            </dd>
            <dt>{translate('tactical.weapons.expectedTerm')}</dt>
            <dd>
              {translate('tactical.weapons.expected', {
                expected: formatStat(Math.round(effect.expectedDamagePerShot * 10) / 10, locale),
                profile: describeProfile(effect.listedDamage, translate, locale),
              })}
            </dd>
          </>
        )}
      </dl>
      {effect === undefined ? (
        <p className={styles['muted']}>{translate('tactical.weapons.noEffect')}</p>
      ) : (
        <SubstitutedExplanation
          trace={effect.trace}
          label={translate('tactical.weapons.explain')}
          result={formatPercent(effect.hitChance, locale)}
        />
      )}
    </>
  );
}

/** Choosing and loading another charge, with what it would do. */
function ChargeChoice({
  weapon,
  data,
  runner,
}: {
  readonly weapon: WeaponRuntimeData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}): JSX.Element | null {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const options = weapon.ammunitionOptions;
  const [chosen, setChosen] = useState<string>('');
  const choice =
    options.find((option) => option.ammunitionId === chosen) ??
    options.find((option) => !option.loaded) ??
    options[0] ??
    null;
  const change = commandAvailability(choice?.commands, 'weapon.changeAmmunition');
  const slotNumber = weapon.slot.index + 1;

  if (options.length === 0) {
    return null;
  }
  return (
    <div className={styles['chargeChoice']}>
      <div className={styles['commandRow']}>
        <label className={styles['inlineField']}>
          <span>{translate('tactical.weapons.chargeTerm')}</span>
          <select
            aria-label={translate('tactical.weapons.charge', { slot: slotNumber })}
            value={choice?.ammunitionId ?? ''}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          >
            {options.map((option) => (
              <option key={option.ammunitionId} value={option.ammunitionId}>
                {translate(option.loaded ? 'tactical.weapons.optionLoaded' : 'tactical.weapons.option', {
                  name: translate(option.nameKey),
                  rounds: formatQuantity(option.cargoRounds, locale),
                })}
              </option>
            ))}
          </select>
        </label>
        <ActionButton
          actionId="weapon.changeAmmunition"
          runner={runner}
          display="short"
          shortLabel={translate('tactical.weapons.load')}
          available={choice !== null && change.available}
          unavailableReason={change.unavailableReason}
          label={translate('tactical.weapons.loadSlot', { slot: slotNumber })}
          onRun={async () => {
            if (choice !== null) {
              await data.send('weapon.changeAmmunition', {
                slotKind: weapon.slot.kind,
                slotIndex: weapon.slot.index,
                ammunitionId: choice.ammunitionId,
              });
            }
          }}
        />
      </div>
      {/* The loaded charge's figures are the weapon's own, read just below. */}
      {choice === null || choice.loaded ? null : <ChargeSummary option={choice} />}
    </div>
  );
}

/** What a charge would do in this turret, for comparing before loading it. */
function ChargeSummary({ option }: { readonly option: AmmunitionOptionData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  return (
    <p className={styles['muted']} data-charge-summary={option.ammunitionId}>
      {translate('tactical.weapons.chargeSummary', {
        profile: describeProfile(option.listedDamage, translate, locale),
        optimal: formatDistanceKm(option.optimalRangeKm, locale),
        falloff: formatDistanceKm(option.falloffKm, locale),
      })}
    </p>
  );
}

type WeaponStatusKind = 'reloading' | 'firing' | 'finishing' | 'stopped' | 'idle';

function statusKind(weapon: WeaponRuntimeData): WeaponStatusKind {
  if (weapon.reload !== null) return 'reloading';
  if (weapon.cycle !== null) return weapon.repeating ? 'firing' : 'finishing';
  return weapon.stopReason === null ? 'idle' : 'stopped';
}

function clockState(status: WeaponStatusKind): CycleClockState {
  switch (status) {
    case 'firing':
      return 'running';
    case 'finishing':
      return 'stopping';
    case 'reloading':
      return 'reloading';
    case 'stopped':
      return 'stopped';
    default:
      return 'idle';
  }
}

function cycleElapsed(weapon: WeaponRuntimeData): number {
  if (weapon.cycle === null || weapon.cycleSeconds <= 0) {
    return 0;
  }
  return 1 - weapon.cycle.remainingSeconds / weapon.cycleSeconds;
}

type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

function tenths(value: number, locale: string): string {
  return formatStat(Math.round(value * 10) / 10, locale);
}

function clockLabel(
  weapon: WeaponRuntimeData,
  status: WeaponStatusKind,
  translate: Translate,
  locale: string,
): string {
  switch (status) {
    case 'firing':
    case 'finishing':
      return translate('tactical.weapons.nextShot', {
        seconds: tenths(weapon.cycle?.remainingSeconds ?? 0, locale),
      });
    case 'reloading':
      return translate('tactical.weapons.reloadEnds', {
        seconds: tenths(weapon.reload?.remainingSeconds ?? 0, locale),
      });
    default:
      return translate('tactical.clock.idle');
  }
}

function describeStatus(
  weapon: WeaponRuntimeData,
  status: WeaponStatusKind,
  translate: Translate,
  locale: string,
  nameOf: (id: string) => string,
): string {
  switch (status) {
    case 'reloading':
      return translate(
        weapon.reload?.changing === true ? 'tactical.weapons.changing' : 'tactical.weapons.reloading',
        { seconds: tenths(weapon.reload?.remainingSeconds ?? 0, locale) },
      );
    case 'firing':
      return translate('tactical.weapons.firing', { target: nameOf(weapon.cycle?.targetId ?? '') });
    case 'finishing':
      return translate('tactical.weapons.finishing');
    case 'stopped':
      return translate('tactical.weapons.stopped', {
        reason: translate(`combat.stop.${weapon.stopReason ?? 'deactivated'}`),
      });
    default:
      return translate('combat.weapon.idle');
  }
}

function describeProfile(
  damage: Readonly<Record<string, number>>,
  translate: (key: string) => string,
  locale: string,
): string {
  const parts = damageBreakdown(damage).map(
    (entry) => `${translate(`damage.${entry.damageType}`)} ${formatStat(entry.amount, locale)}`,
  );
  return parts.length === 0 ? translate('tactical.noDamage') : parts.join(' · ');
}
