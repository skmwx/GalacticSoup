import type { JSX } from 'react';

import type { SiteObjectData } from '@protocol';

import { ActionButton, commandAvailability, type ActionRunner } from '../actions';
import { formatDistanceKm } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import styles from './Space.module.css';

/**
 * The commands one object offers, where the object is
 * (Functional Specification 7.1, 9.2, 9.11, 19.2; Technical Specification 12.3).
 *
 * The selected-object panel and the view's context menu render this same
 * component, so the two cannot disagree about an object. The panel sits
 * beside the command bar and the weapons, so it lists only what neither of
 * those offers - locking; the menu is the one place a right-click reaches, so
 * it lists everything the object allows. Each entry is a registry action
 * paired with the availability the engine projected for this object; an order
 * that cannot be given stays visible and says why.
 *
 * @implements FUNC-7.1, FUNC-9.2, FUNC-9.11, FUNC-19.2, TECH-12.3, MVP-AC-03
 */

export interface ObjectCommandsProps {
  readonly object: SiteObjectData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  /** `menu` lists every command; `panel` only those no other surface offers. */
  readonly variant: 'panel' | 'menu';
  /** The distance range orders use, as the command bar has it set. */
  readonly rangeKm: number;
  /** The closest distance an approach offers, which is how a wreck is reached. */
  readonly closestKm: number;
  /** Whether the player's weapons could fire at this object now. */
  readonly canFire: boolean;
  readonly fireReason: string | null;
  onFire(): Promise<void>;
  /** Called after a command is sent, so a menu can close. */
  onDone?(): void;
}

export function ObjectCommands({
  object,
  data,
  runner,
  variant,
  rangeKm,
  closestKm,
  canFire,
  fireReason,
  onFire,
  onDone,
}: ObjectCommandsProps): JSX.Element {
  const translate = useTranslate();
  const lock = commandAvailability(object.commands, 'targeting.lock');
  const unlock = commandAvailability(object.commands, 'targeting.unlock');
  const approachKm = object.kind === 'wreck' ? closestKm : rangeKm;

  const after = async (work: () => Promise<unknown>): Promise<void> => {
    await work();
    onDone?.();
  };

  if (object.player) {
    return <p className={styles['muted']}>{translate('tactical.commands.own')}</p>;
  }

  return (
    <div className={styles['objectCommands']} data-object-commands={object.id}>
      {object.kind === 'ship' ? (
        <>
          {unlock.available ? (
            <ActionButton
              actionId="targeting.unlock"
              runner={runner}
              onRun={() => after(() => data.send('targeting.unlock', { targetId: object.id }))}
            />
          ) : (
            <ActionButton
              actionId="targeting.lock"
              runner={runner}
              variant="primary"
              available={lock.available}
              unavailableReason={lock.unavailableReason}
              onRun={() => after(() => data.send('targeting.lock', { targetId: object.id }))}
            />
          )}
          {variant === 'menu' ? (
            <ActionButton
              actionId="weapons.fire"
              runner={runner}
              available={canFire}
              unavailableReason={fireReason}
              onRun={() => after(onFire)}
            />
          ) : null}
        </>
      ) : null}
      {variant === 'panel' ? null : (
        <MenuOrders
          object={object}
          data={data}
          runner={runner}
          rangeKm={rangeKm}
          approachKm={approachKm}
          after={after}
        />
      )}
    </div>
  );
}

interface MenuOrdersProps {
  readonly object: SiteObjectData;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly rangeKm: number;
  readonly approachKm: number;
  after(work: () => Promise<unknown>): Promise<void>;
}

/** The movement and docking orders the context menu adds. */
function MenuOrders({ object, data, runner, rangeKm, approachKm, after }: MenuOrdersProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const approach = commandAvailability(object.commands, 'movement.approach');
  const orbit = commandAvailability(object.commands, 'movement.orbit');
  const keepRange = commandAvailability(object.commands, 'movement.keepRange');
  const dock = commandAvailability(object.commands, 'navigation.dock');
  const range = formatDistanceKm(rangeKm, locale);

  return (
    <>
      {object.kind === 'station' ? (
        <ActionButton
          actionId="navigation.dock"
          runner={runner}
          available={dock.available}
          unavailableReason={dock.unavailableReason}
          onRun={() => after(() => data.send('navigation.dock', { stationId: object.id }))}
        />
      ) : null}
      <ActionButton
        actionId="movement.approach"
        runner={runner}
        available={approach.available}
        unavailableReason={approach.unavailableReason}
        label={translate('tactical.commands.approach', {
          range: formatDistanceKm(approachKm, locale),
        })}
        onRun={() =>
          after(() => data.send('movement.approach', { targetId: object.id, distanceKm: approachKm }))
        }
      />
      {object.kind === 'wreck' ? null : (
        <>
          <ActionButton
            actionId="movement.orbit"
            runner={runner}
            available={orbit.available}
            unavailableReason={orbit.unavailableReason}
            label={translate('tactical.commands.orbit', { range })}
            onRun={() =>
              after(() => data.send('movement.orbit', { targetId: object.id, distanceKm: rangeKm }))
            }
          />
          <ActionButton
            actionId="movement.keepRange"
            runner={runner}
            available={keepRange.available}
            unavailableReason={keepRange.unavailableReason}
            label={translate('tactical.commands.keepRange', { range })}
            onRun={() =>
              after(() => data.send('movement.keepRange', { targetId: object.id, distanceKm: rangeKm }))
            }
          />
        </>
      )}
    </>
  );
}
