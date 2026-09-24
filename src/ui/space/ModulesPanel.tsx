import type { JSX } from 'react';

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
import styles from './Space.module.css';

/**
 * Active and passive modules (Functional Specification 9.7-9.8, 19.1).
 *
 * An active module is one toggle: it activates when the engine says it may,
 * and deactivates when it is repeating. Its row says what it is doing, what a
 * cycle costs and what it gives back, so active tanking reads as a trade of
 * capacitor for hit points. Passive modules are listed with the effect they
 * already contribute and no control, because there is nothing to operate.
 * The first active modules are also reachable by number keys, taken from the
 * registry like every other shortcut.
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
            runner.run(actionId, () => toggle(module));
          },
        ];
      }),
    ),
  );

  return (
    <section className={styles['panel']} aria-labelledby="modules-heading" data-panel="modules">
      <h3 id="modules-heading" className={styles['panelHeading']}>
        {translate('tactical.modules.heading')}
      </h3>
      {modules.length === 0 ? (
        <p className={styles['muted']}>{translate('tactical.modules.none')}</p>
      ) : null}
      <ul className={styles['plainList']}>
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
            <li
              key={`${module.slot.kind}:${String(module.slot.index)}`}
              className={styles['weaponRow']}
              data-module={module.moduleId}
              data-module-status={module.status}
            >
              <p className={styles['weaponStatus']}>
                <span className={styles['layerName']}>{translate(module.nameKey)}</span>{' '}
                <span>{describeStatus(module, translate)}</span>
              </p>
              <ModuleEffect module={module} />
              <ActionButton
                actionId={actionId}
                runner={runner}
                pressed={module.repeating}
                available={activate.available || deactivate.available}
                unavailableReason={activate.unavailableReason ?? deactivate.unavailableReason}
                label={translate(turningOff ? 'tactical.modules.deactivate' : 'tactical.modules.activate', {
                  name: translate(module.nameKey),
                })}
                onRun={() => toggle(module)}
              />
            </li>
          );
        })}
        {passive.map((module) => (
          <li
            key={`${module.slot.kind}:${String(module.slot.index)}`}
            className={styles['weaponRow']}
            data-module={module.moduleId}
            data-module-status={module.status}
          >
            <p className={styles['weaponStatus']}>
              <span className={styles['layerName']}>{translate(module.nameKey)}</span>{' '}
              <span>{describeStatus(module, translate)}</span>
            </p>
            <ModuleEffect module={module} />
          </li>
        ))}
      </ul>
    </section>
  );
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
