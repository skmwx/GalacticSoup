import type { JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { AssetsData, SiteObjectData, WreckData } from '@protocol';

import { ActionButton, commandAvailability, type ActionRunner } from '../actions';
import { formatSimulationDuration } from '../format/duration';
import { formatDistanceKm, formatQuantity, formatVolume } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import styles from './Space.module.css';

/**
 * A wreck and what can be taken from it (Functional Specification 9.11, 6.2).
 *
 * Contents are shown once the wreck is open, which the rules allow within
 * access range; further out the panel says why it cannot be opened and
 * offers the closest approach the authored ranges allow. Each stack offers
 * the most of it the hold will accept - the engine's figure, not a guess - and
 * taking everything re-reads the wreck between stacks, because each take
 * changes what the next one can fit. Nothing is ever dropped for lack of
 * space: a stack that does not fit stays in the wreck.
 *
 * @implements FUNC-9.11, FUNC-6.2, FUNC-22.2, TECH-12.3, MVP-AC-06
 */

export interface LootPanelProps {
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly gateway: ClientGateway;
  readonly object: SiteObjectData;
  readonly wreck: WreckData | null;
  /** The closest range an approach order offers. */
  readonly approachKm: number | null;
  readonly simulationTimeMs: number;
}

export function LootPanel({
  data,
  runner,
  gateway,
  object,
  wreck,
  approachKm,
  simulationTimeMs,
}: LootPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const contents = data.wreck !== null && data.wreck.wreckId === object.id ? data.wreck : null;
  const access = commandAvailability(object.commands, 'loot.take');
  const approach = commandAvailability(object.commands, 'movement.approach');
  const hold = cargoOf(data.assets);
  const takeable = (contents?.maximumQuantities ?? []).some((entry) => entry.maximumQuantity > 0);

  const takeAll = async (): Promise<void> => {
    await takeEverything(gateway, data, object.id);
  };

  return (
    <section className={styles['panel']} aria-labelledby="loot-heading" data-panel="loot" data-wreck={object.id}>
      <h3 id="loot-heading" className={styles['panelHeading']}>
        {translate('tactical.loot.heading')}
      </h3>
      <p className={styles['objectKind']}>{translate(object.nameKey)}</p>
      <dl className={styles['readouts']}>
        <dt>{translate('space.selected.range')}</dt>
        <dd>{translate('space.distance', { distance: formatDistanceKm(object.rangeFromPlayerKm, locale) })}</dd>
        {wreck === null ? null : (
          <>
            <dt>{translate('tactical.loot.expires')}</dt>
            <dd>{formatSimulationDuration(Math.max(0, wreck.expiresAtMs - simulationTimeMs))}</dd>
            <dt>{translate('tactical.loot.items')}</dt>
            <dd>{formatQuantity(wreck.itemCount, locale)}</dd>
          </>
        )}
        {hold === null ? null : (
          <>
            <dt>{translate('tactical.loot.hold')}</dt>
            <dd data-hold-free={String(hold.free)}>
              {translate('tactical.loot.holdValue', {
                used: formatVolume(hold.used, locale),
                capacity: formatVolume(hold.capacity, locale),
              })}
            </dd>
          </>
        )}
      </dl>

      {!access.available || contents === null || !contents.accessible ? (
        <>
          <p className={styles['muted']} role="status">
            {translate(access.unavailableReason ?? contents?.unavailableReason ?? 'tactical.loot.opening')}
          </p>
          <ActionButton
            actionId="movement.approach"
            runner={runner}
            available={approach.available && approachKm !== null}
            unavailableReason={approach.unavailableReason}
            label={translate('tactical.loot.approach')}
            onRun={async () => {
              if (approachKm !== null) {
                await data.send('movement.approach', { targetId: object.id, distanceKm: approachKm });
              }
            }}
          />
        </>
      ) : contents.stacks.length === 0 ? (
        <p className={styles['muted']} role="status">
          {translate('tactical.loot.empty')}
        </p>
      ) : (
        <>
          <ul className={styles['plainList']}>
            {contents.stacks.map((stack) => {
              const maximum =
                contents.maximumQuantities.find((entry) => entry.stackId === stack.id)?.maximumQuantity ?? 0;
              const name = translate(stack.item.nameKey);
              return (
                <li key={stack.id} className={styles['weaponRow']} data-loot-stack={stack.item.definitionId}>
                  <p className={styles['weaponStatus']}>
                    <span className={styles['layerName']}>{name}</span>{' '}
                    <span>
                      {translate('tactical.loot.stack', {
                        quantity: formatQuantity(stack.quantity, locale),
                        fits: formatQuantity(maximum, locale),
                      })}
                    </span>
                  </p>
                  <ActionButton
                    actionId="loot.take"
                    runner={runner}
                    available={maximum > 0}
                    unavailableReason="error.ruleViolation.insufficientCapacity"
                    label={translate('tactical.loot.take', {
                      quantity: formatQuantity(maximum, locale),
                      name,
                    })}
                    onRun={async () => {
                      await data.send('loot.take', {
                        wreckId: object.id,
                        stackId: stack.id,
                        quantity: maximum,
                      });
                    }}
                  />
                </li>
              );
            })}
          </ul>
          <ActionButton
            actionId="loot.takeAll"
            runner={runner}
            variant="primary"
            available={takeable}
            unavailableReason="error.ruleViolation.insufficientCapacity"
            onRun={takeAll}
          />
        </>
      )}
    </section>
  );
}

/**
 * Takes every stack that fits, one at a time, asking the engine afresh before
 * each take. Stops at the first refusal, which the store then reports.
 */
export async function takeEverything(
  gateway: ClientGateway,
  data: PlayData,
  wreckId: string,
): Promise<void> {
  // Each take removes one stack or fills the hold, so the loop is bounded by
  // the wreck's contents; the cap only guards against a misbehaving engine.
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const response = await gateway.request('loot.contents', { wreckId });
    if (!response.ok || !response.data.accessible) {
      return;
    }
    const next = response.data.maximumQuantities.find((entry) => entry.maximumQuantity > 0);
    if (next === undefined) {
      return;
    }
    const answer = await data.send('loot.take', {
      wreckId,
      stackId: next.stackId,
      quantity: next.maximumQuantity,
    });
    if (!answer.ok) {
      return;
    }
  }
}

interface HoldSummary {
  readonly used: number;
  readonly capacity: number;
  readonly free: number;
}

function cargoOf(assets: AssetsData | null): HoldSummary | null {
  if (assets === null) {
    return null;
  }
  const cargo = assets.inventories.find(
    (inventory) => inventory.location.kind === 'cargo' && inventory.location.shipId === assets.activeShipId,
  );
  if (cargo === undefined || cargo.capacityCubicDecimetres === null) {
    return null;
  }
  return {
    used: cargo.usedCubicDecimetres,
    capacity: cargo.capacityCubicDecimetres,
    free: cargo.freeCubicDecimetres ?? 0,
  };
}
