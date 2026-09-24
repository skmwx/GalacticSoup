import { useState, type JSX } from 'react';

import type {
  AmmunitionOptionData,
  CombatData,
  EncounterData,
  SiteData,
  WeaponRuntimeData,
} from '@protocol';

import { ActionButton, commandAvailability, useActionShortcuts, type ActionRunner } from '../actions';
import { SubstitutedExplanation } from '../common/Explanation';
import { formatDistanceKm, formatPercent, formatQuantity, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import styles from './Space.module.css';
import {
  damageBreakdown,
  describeSubject,
  subjectName,
  weaponGroups,
  type FireAvailability,
  type WeaponGroup,
} from './tactical';

/**
 * Turrets, their charges and what they would do right now
 * (Functional Specification 9.4-9.5, 19.3, 19.6).
 *
 * Weapons that fire the same turret with the same charge are one group and
 * share one hit chance, shown against the target the weapons are aimed at
 * with the half of the formula that limits it and the formula itself. Each
 * weapon still reports its own magazine, cycle and reload, because those are
 * where a fight is lost to an empty gun. Every control is a registry action
 * paired with the availability the engine projected for it.
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
  const groups = weaponGroups(weapons);
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

  useActionShortcuts({
    'weapons.fire': () => {
      runner.run('weapons.fire', onFire);
    },
    'weapons.cease': () => {
      runner.run('weapons.cease', ceaseAll);
    },
    'weapons.reload': () => {
      runner.run('weapons.reload', reloadAll);
    },
  });

  return (
    <section className={styles['panel']} aria-labelledby="weapons-heading" data-panel="weapons">
      <h3 id="weapons-heading" className={styles['panelHeading']}>
        {translate('tactical.weapons.heading')}
      </h3>
      <p className={styles['muted']} data-weapon-target={targetId ?? ''}>
        {targetName === null
          ? translate('tactical.weapons.noTarget')
          : translate('tactical.weapons.aimedAt', { target: targetName })}
      </p>

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
          unavailableReason={
            weapons.map((weapon) => commandAvailability(weapon.commands, 'weapon.reload').unavailableReason)
              .find((reason) => reason !== null) ?? null
          }
          onRun={reloadAll}
        />
      </div>

      {groups.length === 0 ? (
        <p className={styles['muted']}>{translate('tactical.weapons.none')}</p>
      ) : (
        groups.map((group) => (
          <WeaponGroupView
            key={group.key}
            group={group}
            data={data}
            runner={runner}
            targetId={targetId}
            site={site}
            encounter={encounter}
            shipId={shipId}
          />
        ))
      )}
    </section>
  );
}

interface WeaponGroupViewProps {
  readonly group: WeaponGroup;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly targetId: string | null;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
  readonly shipId: string | null;
}

function WeaponGroupView({
  group,
  data,
  runner,
  targetId,
  site,
  encounter,
  shipId,
}: WeaponGroupViewProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const lead = group.weapons[0];
  const effect = targetId === null ? undefined : lead?.effects.find((entry) => entry.targetId === targetId);

  return (
    <article className={styles['group']} data-weapon-group={group.key}>
      <h4 className={styles['groupHeading']}>
        {translate('tactical.weapons.group', {
          count: group.weapons.length,
          name: translate(group.nameKey),
          charge:
            group.ammunitionNameKey === null
              ? translate('tactical.weapons.empty')
              : translate(group.ammunitionNameKey),
        })}
      </h4>

      {lead === undefined ? null : (
        <dl className={styles['readouts']}>
          <dt>{translate('tactical.weapons.ranges')}</dt>
          <dd>
            {translate('tactical.weapons.rangeValue', {
              optimal: formatDistanceKm(lead.optimalRangeKm, locale),
              falloff: formatDistanceKm(lead.falloffKm, locale),
              absolute: formatDistanceKm(lead.absoluteRangeKm, locale),
            })}
          </dd>
          <dt>{translate('ship.tracking')}</dt>
          <dd>
            {translate('tactical.radiansPerSecond', {
              value: formatStat(lead.trackingRadiansPerSecond, locale),
            })}
          </dd>
        </dl>
      )}

      {effect === undefined ? (
        <p className={styles['muted']}>{translate('tactical.weapons.noEffect')}</p>
      ) : (
        <div data-hit-chance={String(effect.hitChance)} data-limiting={effect.limitingFactor}>
          <p className={styles['hitChance']}>
            {translate('tactical.weapons.hitChance', {
              chance: formatPercent(effect.hitChance, locale),
              target: describeSubject(subjectName(effect.targetId, site, encounter, shipId), translate),
            })}
          </p>
          <p className={styles['limiting']}>
            {translate(`tactical.limiting.${effect.limitingFactor}`, {
              range: formatStat(effect.rangeStrain, locale),
              tracking: formatStat(effect.trackingStrain, locale),
            })}
          </p>
          <p className={styles['muted']}>
            {translate('tactical.weapons.expected', {
              expected: formatStat(Math.round(effect.expectedDamagePerShot * 10) / 10, locale),
              profile: describeProfile(effect.listedDamage, translate, locale),
            })}
          </p>
          <SubstitutedExplanation
            trace={effect.trace}
            label={translate('tactical.weapons.explain')}
            result={formatPercent(effect.hitChance, locale)}
          />
        </div>
      )}

      <ul className={styles['plainList']}>
        {group.weapons.map((weapon) => (
          <WeaponRow key={`${weapon.slot.kind}:${String(weapon.slot.index)}`} weapon={weapon} data={data} runner={runner} targetId={targetId} site={site} encounter={encounter} shipId={shipId} />
        ))}
      </ul>
    </article>
  );
}

interface WeaponRowProps {
  readonly weapon: WeaponRuntimeData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly targetId: string | null;
  readonly site: SiteData | null;
  readonly encounter: EncounterData | null;
  readonly shipId: string | null;
}

function WeaponRow({
  weapon,
  data,
  runner,
  targetId,
  site,
  encounter,
  shipId,
}: WeaponRowProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const slot = { slotKind: weapon.slot.kind, slotIndex: weapon.slot.index };
  const options = weapon.ammunitionOptions;
  const [chosen, setChosen] = useState<string>('');
  const choice =
    options.find((option) => option.ammunitionId === chosen) ??
    options.find((option) => !option.loaded) ??
    options[0] ??
    null;
  const loaded = options.find((option) => option.loaded) ?? null;
  const activate = commandAvailability(weapon.commands, 'weapon.activate');
  const deactivate = commandAvailability(weapon.commands, 'weapon.deactivate');
  const reload = commandAvailability(weapon.commands, 'weapon.reload');
  const change = commandAvailability(choice?.commands, 'weapon.changeAmmunition');
  const slotLabel = translate('tactical.weapons.slot', { slot: weapon.slot.index + 1 });

  return (
    <li className={styles['weaponRow']} data-weapon={`${weapon.slot.kind}:${String(weapon.slot.index)}`}>
      <p className={styles['weaponStatus']}>
        <span className={styles['layerName']}>{slotLabel}</span>{' '}
        <span data-weapon-status={statusKind(weapon)}>
          {describeStatus(weapon, translate, locale, (id) =>
            describeSubject(subjectName(id, site, encounter, shipId), translate),
          )}
        </span>
      </p>
      <p className={styles['muted']}>
        {translate('tactical.weapons.magazine', {
          loaded: formatQuantity(weapon.loadedRounds, locale),
          size: formatQuantity(weapon.magazineSize, locale),
          hold: formatQuantity(loaded?.cargoRounds ?? 0, locale),
        })}
      </p>
      <div className={styles['commandRow']}>
        <ActionButton
          actionId="weapon.activate"
          runner={runner}
          available={activate.available && targetId !== null}
          unavailableReason={targetId === null ? 'tactical.weapons.noTarget' : activate.unavailableReason}
          label={translate('tactical.weapons.fireSlot', { slot: weapon.slot.index + 1 })}
          onRun={async () => {
            if (targetId !== null) {
              await data.send('weapon.activate', { ...slot, targetId });
            }
          }}
        />
        <ActionButton
          actionId="weapon.deactivate"
          runner={runner}
          available={deactivate.available}
          unavailableReason={deactivate.unavailableReason}
          label={translate('tactical.weapons.ceaseSlot', { slot: weapon.slot.index + 1 })}
          onRun={async () => {
            await data.send('weapon.deactivate', slot);
          }}
        />
        <ActionButton
          actionId="weapon.reload"
          runner={runner}
          available={reload.available}
          unavailableReason={reload.unavailableReason}
          label={translate('tactical.weapons.reloadSlot', { slot: weapon.slot.index + 1 })}
          onRun={async () => {
            await data.send('weapon.reload', slot);
          }}
        />
      </div>
      {options.length === 0 ? null : (
        <div className={styles['commandRow']}>
          <label className={styles['field']}>
            {translate('tactical.weapons.charge', { slot: weapon.slot.index + 1 })}
            <select
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
            available={choice !== null && change.available}
            unavailableReason={change.unavailableReason}
            label={translate('tactical.weapons.loadSlot', { slot: weapon.slot.index + 1 })}
            onRun={async () => {
              if (choice !== null) {
                await data.send('weapon.changeAmmunition', { ...slot, ammunitionId: choice.ammunitionId });
              }
            }}
          />
          {choice === null ? null : <ChargeSummary option={choice} />}
        </div>
      )}
    </li>
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

function describeStatus(
  weapon: WeaponRuntimeData,
  translate: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  locale: string,
  nameOf: (id: string) => string,
): string {
  const seconds = (value: number): string => formatStat(Math.round(value * 10) / 10, locale);
  switch (statusKind(weapon)) {
    case 'reloading':
      return translate(
        weapon.reload?.changing === true ? 'tactical.weapons.changing' : 'tactical.weapons.reloading',
        { seconds: seconds(weapon.reload?.remainingSeconds ?? 0) },
      );
    case 'firing':
      return translate('tactical.weapons.firing', {
        target: nameOf(weapon.cycle?.targetId ?? ''),
        seconds: seconds(weapon.cycle?.remainingSeconds ?? 0),
      });
    case 'finishing':
      return translate('tactical.weapons.finishing', {
        seconds: seconds(weapon.cycle?.remainingSeconds ?? 0),
      });
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
