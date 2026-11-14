import { useId, useState, type JSX, type ReactNode } from 'react';

import type { ModuleRuntimeData } from '@protocol';

import {
  ActionButton,
  commandAvailability,
  MODULE_TOGGLE_COUNT,
  moduleToggleActionId,
  useActionShortcuts,
  type ActionRunner,
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
}

export function ModulesPanel({ data, runner, modules }: ModulesPanelProps): JSX.Element {
  const translate = useTranslate();
  const active = modules.filter((module) => !module.passive);
  const passive = modules.filter((module) => module.passive);

  const toggle = async (module: ModuleRuntimeData): Promise<void> => {
    const payload = { slotKind: module.slot.kind, slotIndex: module.slot.index };
    if (commandAvailability(module.commands, 'module.activate').available) {
      await data.send('module.activate', payload);
    } else if (commandAvailability(module.commands, 'module.deactivate').available) {
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
            const activate = commandAvailability(module.commands, 'module.activate');
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
            const activate = commandAvailability(module.commands, 'module.activate');
            const deactivate = commandAvailability(module.commands, 'module.deactivate');
            const turningOff = !activate.available && deactivate.available;
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
                controls={
                  <>
                    <CycleClock
                      state={clockState(module)}
                      elapsed={cycleElapsed(module)}
                      label={describeStatus(module, translate)}
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
                        label={translate(
                          turningOff ? 'tactical.modules.deactivate' : 'tactical.modules.activate',
                          { name: translate(module.nameKey) },
                        )}
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
}

/** One module: its name and controls on a line, its description folded beneath. */
function ModuleEntry({ module, controls }: ModuleEntryProps): JSX.Element {
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
          {describeStatus(module, translate)}
        </p>
      ) : null}
      <div id={detailId} className={styles['entryDetail']} hidden={!expanded}>
        {alert ? null : <p className={styles['muted']}>{describeStatus(module, translate)}</p>}
        <ModuleEffect module={module} />
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
): string {
  const seconds = (value: number): string => String(Math.round(value * 10) / 10);
  switch (module.status) {
    case 'active':
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
function ModuleEffect({ module }: { readonly module: ModuleRuntimeData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const effect = module.effect;

  switch (effect.kind) {
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
