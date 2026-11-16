import { useId, useState, type JSX, type ReactNode } from 'react';

import type { ModuleRuntimeData } from '@protocol';

import {
  ActionButton,
  commandAvailability,
  MODULE_TOGGLE_COUNT,
  moduleToggleActionId,
  useActionShortcuts,
  type ActionRunner,
  type CommandAvailability,
} from '../actions';
import { SubstitutedExplanation } from '../common/Explanation';
import { formatPercent, formatSpeedKmPerSecond, formatStat } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { CycleClock, type CycleClockState } from './CycleClock';
import styles from './Space.module.css';

/**
 * Active and passive modules (Functional Specification 9.7-9.8, 19.1).
 *
 * The second half of the equipment panel, as compact as the weapons above it.
 * Each active module is one line: its name, a round clock for its cycle and
 * an on/off switch. The switch activates the module when the engine says it
 * may and deactivates it while it repeats. When a module cannot keep cycling,
 * because it waits for capacitor or was stopped for a reason, the line gains
 * that reason in words. What a cycle costs and gives back, and the formula
 * behind it, fold beneath the name. Passive modules are listed with no
 * control, because there is nothing to operate. The first active modules are
 * also reachable by number keys, taken from the registry like every other
 * shortcut.
 *
 * @implements FUNC-9.7, FUNC-9.8, FUNC-19.1, TECH-12.3, MVP-AC-03, MVP-AC-04
 */

export interface ModulesPanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly modules: readonly ModuleRuntimeData[];
  /**
   * The locked target the weapon controls aim at. A targeted module (the web)
   * acts on it; with none aimed, the engine takes the only target in reach.
   */
  readonly targetId?: string | null;
  /** Turns a ship id into the name the player knows it by. */
  readonly nameOf?: (shipId: string) => string;
}

/**
 * Whether a module's switch would start it now. A targeted module answers for
 * the aimed target, from the same predicate the command handler asks
 * (Functional Specification 9.9; Technical Specification 12.3).
 */
function activation(module: ModuleRuntimeData, targetId: string | null): CommandAvailability {
  if (!module.targeted || targetId === null) return commandAvailability(module.commands, 'module.activate');
  const entry = module.targets.find((candidate) => candidate.targetId === targetId);
  return entry === undefined
    ? { available: false, unavailableReason: 'error.ruleViolation.lockNotHeld' }
    : { available: entry.command.available, unavailableReason: entry.command.unavailableReason };
}

/** A repeating module's switch turns it off, unless it would move a web to the aimed target. */
function turnsOff(module: ModuleRuntimeData, targetId: string | null): boolean {
  return module.repeating && (!module.targeted || targetId === null || module.targetId === targetId);
}

export function ModulesPanel({
  data,
  runner,
  modules,
  targetId = null,
  nameOf = () => '',
}: ModulesPanelProps): JSX.Element {
  const translate = useTranslate();
  const active = modules.filter((module) => !module.passive);
  const passive = modules.filter((module) => module.passive);

  const toggle = async (module: ModuleRuntimeData): Promise<void> => {
    const payload = { slotKind: module.slot.kind, slotIndex: module.slot.index };
    const deactivate = commandAvailability(module.commands, 'module.deactivate');
    if (turnsOff(module, targetId) && deactivate.available) {
      await data.send('module.deactivate', payload);
    } else if (activation(module, targetId).available) {
      await data.send(
        'module.activate',
        module.targeted && targetId !== null ? { ...payload, targetId } : payload,
      );
    } else if (deactivate.available) {
      await data.send('module.deactivate', payload);
    }
  };

  useActionShortcuts(
    Object.fromEntries(
      active.slice(0, MODULE_TOGGLE_COUNT).map((module, index) => {
        const actionId = moduleToggleActionId(index + 1);
        return [
          actionId,
          () => {
            const activate = activation(module, targetId);
            const deactivate = commandAvailability(module.commands, 'module.deactivate');
            if (!activate.available && !deactivate.available) {
              return activate.unavailableReason ?? deactivate.unavailableReason ?? 'shortcut.unavailable';
            }
            runner.run(actionId, () => toggle(module));
            return undefined;
          },
        ];
      }),
    ),
  );

  return (
    <section className={styles['equipmentGroup']} aria-labelledby="modules-heading" data-panel="modules">
      <h4 id="modules-heading" className={styles['panelHeading']}>
        {translate('tactical.modules.heading')}
      </h4>
      {modules.length === 0 ? (
        <p className={styles['muted']}>{translate('tactical.modules.none')}</p>
      ) : (
        <ul className={styles['entryList']}>
          {active.map((module, index) => {
            const activate = activation(module, targetId);
            const deactivate = commandAvailability(module.commands, 'module.deactivate');
            const turningOff = turnsOff(module, targetId) ? deactivate.available : !activate.available && deactivate.available;
            const actionId =
              index < MODULE_TOGGLE_COUNT
                ? moduleToggleActionId(index + 1)
                : turningOff
                  ? 'module.deactivate'
                  : 'module.activate';
            return (
              <ModuleEntry
                key={`${module.slot.kind}:${String(module.slot.index)}`}
                module={module}
                nameOf={nameOf}
                controls={
                  <>
                    <CycleClock
                      state={clockState(module)}
                      elapsed={cycleElapsed(module)}
                      label={describeStatus(module, translate, nameOf)}
                    />
                    <span className={styles['entrySwitch']}>
                      <ActionButton
                        actionId={actionId}
                        runner={runner}
                        display="icon"
                        icon="power"
                        pressed={module.repeating}
                        available={activate.available || deactivate.available}
                        unavailableReason={activate.unavailableReason ?? deactivate.unavailableReason}
                        label={
                          module.targeted && !turningOff && targetId !== null
                            ? translate('tactical.modules.activateOn', {
                                name: translate(module.nameKey),
                                target: nameOf(targetId),
                              })
                            : translate(
                                turningOff ? 'tactical.modules.deactivate' : 'tactical.modules.activate',
                                { name: translate(module.nameKey) },
                              )
                        }
                        onRun={() => toggle(module)}
                      />
                    </span>
                  </>
                }
              />
            );
          })}
          {passive.map((module) => (
            <ModuleEntry
              key={`${module.slot.kind}:${String(module.slot.index)}`}
              module={module}
              nameOf={nameOf}
              controls={<span className={styles['entryTag']}>{translate('tactical.modules.passiveTag')}</span>}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ModuleEntryProps {
  readonly module: ModuleRuntimeData;
  /** What sits on the line after the name: the clock and switch, or a tag. */
  readonly controls: ReactNode;
  readonly nameOf: (shipId: string) => string;
}

/** One module: its name and controls on a line, its description folded beneath. */
function ModuleEntry({ module, controls, nameOf }: ModuleEntryProps): JSX.Element {
  const translate = useTranslate();
  const detailId = useId();
  const [expanded, setExpanded] = useState(false);
  const alert = module.status === 'waiting' || module.status === 'offline' ||
    (module.status === 'inactive' && module.stopReason !== null);

  return (
    <li
      className={styles['entry']}
      data-module={module.moduleId}
      data-module-status={module.status}
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
          <span className={styles['entryName']}>{translate(module.nameKey)}</span>
          <span className={styles['visuallyHidden']}>{translate('tactical.modules.details')}</span>
        </button>
        {controls}
      </div>
      {alert ? (
        <p className={styles['entryAlert']} data-module-alert>
          {describeStatus(module, translate, nameOf)}
        </p>
      ) : null}
      <div id={detailId} className={styles['entryDetail']} hidden={!expanded}>
        {alert ? null : <p className={styles['muted']}>{describeStatus(module, translate, nameOf)}</p>}
        <ModuleEffect module={module} nameOf={nameOf} />
      </div>
    </li>
  );
}

function clockState(module: ModuleRuntimeData): CycleClockState {
  switch (module.status) {
    case 'active':
      return 'running';
    case 'deactivating':
      return 'stopping';
    case 'waiting':
      return 'waiting';
    case 'inactive':
      return module.stopReason === null ? 'idle' : 'stopped';
    default:
      return 'idle';
  }
}

function cycleElapsed(module: ModuleRuntimeData): number {
  if (module.cycle === null || module.cycleSeconds <= 0) {
    return 0;
  }
  return 1 - module.cycle.remainingSeconds / module.cycleSeconds;
}

function describeStatus(
  module: ModuleRuntimeData,
  translate: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  nameOf: (shipId: string) => string,
): string {
  const seconds = (value: number): string => String(Math.round(value * 10) / 10);
  switch (module.status) {
    case 'active':
      if (module.targeted && module.cycle?.targetId != null) {
        return translate('tactical.modules.webActive', {
          target: nameOf(module.cycle.targetId),
          seconds: seconds(module.cycle.remainingSeconds),
        });
      }
      return translate('tactical.modules.active', { seconds: seconds(module.cycle?.remainingSeconds ?? 0) });
    case 'deactivating':
      return translate('tactical.modules.deactivating', {
        seconds: seconds(module.cycle?.remainingSeconds ?? 0),
      });
    case 'waiting':
      return translate('tactical.modules.waiting');
    case 'offline':
      return translate('tactical.modules.offline');
    case 'passive':
      return translate('tactical.modules.passive');
    default:
      return module.stopReason === null
        ? translate('tactical.modules.inactive')
        : translate('tactical.modules.stopped', {
            reason: translate(`combat.stop.${module.stopReason}`),
          });
  }
}

/** What one module contributes, in the terms its category is judged by. */
function ModuleEffect({
  module,
  nameOf,
}: {
  readonly module: ModuleRuntimeData;
  readonly nameOf: (shipId: string) => string;
}): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const effect = module.effect;

  switch (effect.kind) {
    case 'web':
      // A web slows a target; it is never presented as extra damage, and the
      // text says it does not stop warp (FeatureSpec02 5.2, 6.3).
      return (
        <>
          <p className={styles['muted']} data-web-effect>
            {translate('tactical.modules.web', {
              percent: Math.round((effect.values['speedReductionFraction'] ?? 0) * 100),
              range: formatStat(effect.values['rangeKm'] ?? 0, locale),
              duration: formatStat(effect.values['effectDurationSeconds'] ?? 0, locale),
              floor: Math.round((effect.values['floorFraction'] ?? 0) * 100),
              capacitor: formatStat(module.capacitorPerCycle, locale),
              seconds: formatStat(module.cycleSeconds, locale),
            })}
          </p>
          {module.targets.length === 0 ? (
            <p className={styles['muted']}>{translate('tactical.modules.webNoLock')}</p>
          ) : (
            <ul className={styles['entryList']}>
              {module.targets.map((target) => (
                <li key={target.targetId} data-web-target={target.targetId} data-within-range={target.withinRange}>
                  {translate(target.withinRange ? 'tactical.modules.webTargetInRange' : 'tactical.modules.webTargetOutOfRange', {
                    target: nameOf(target.targetId),
                    range: formatStat(Math.round(target.rangeKm * 10) / 10, locale),
                  })}
                </li>
              ))}
            </ul>
          )}
          <SubstitutedExplanation
            trace={effect.trace}
            label={translate('explain.show')}
            result={formatStat(effect.trace.displayResult, locale)}
          />
        </>
      );
    case 'repair':
      return (
        <>
          <p className={styles['muted']}>
            {translate('tactical.modules.repair', {
              amount: formatStat(effect.amountPerCycle, locale),
              layer: translate(`layer.${effect.layer ?? 'shield'}`),
              seconds: formatStat(module.cycleSeconds, locale),
              rate: formatStat(Math.round(effect.sustainedPerSecond * 10) / 10, locale),
              capacitor: formatStat(module.capacitorPerCycle, locale),
            })}
          </p>
          <SubstitutedExplanation
            trace={effect.trace}
            label={translate('explain.show')}
            result={translate('tactical.perSecond', {
              value: formatStat(effect.trace.displayResult, locale),
            })}
          />
        </>
      );
    case 'propulsion':
      return (
        <p className={styles['muted']}>
          {translate('tactical.modules.propulsion', {
            base: formatSpeedKmPerSecond(effect.baseValue, locale),
            active: formatSpeedKmPerSecond(effect.activeValue, locale),
            capacitor: formatStat(module.capacitorPerCycle, locale),
            seconds: formatStat(module.cycleSeconds, locale),
          })}
        </p>
      );
    case 'passive':
      // A registered passive operator module: each modifier by name, with its
      // authored magnitude (FeatureSpec02 5.1). Flat shield is in hit points;
      // every other operator is a fraction.
      return (
        <p className={styles['muted']} data-passive-effect>
          {translate('tactical.modules.passive.effect', {
            values: Object.entries(effect.values)
              .map(([operator, value]) => `${translate(`stat.modifier.${operator}`)} ${
                operator === 'shieldCapacity' ? `+${formatStat(value, locale)}` : formatPercent(value, locale)
              }`)
              .join(' · '),
          })}
        </p>
      );
    case 'resistance':
      return (
        <p className={styles['muted']}>
          {translate('tactical.modules.resistance', {
            layer: translate(`layer.${effect.layer ?? 'armor'}`),
            values: Object.entries(effect.values)
              .map(([type, value]) => `${translate(`damage.${type}`)} +${formatPercent(value, locale)}`)
              .join(' · '),
          })}
        </p>
      );
    default:
      return (
        <p className={styles['muted']}>
          {translate('tactical.modules.capacitorSupport', {
            base: formatStat(effect.baseValue, locale),
            active: formatStat(effect.activeValue, locale),
          })}
        </p>
      );
  }
}
