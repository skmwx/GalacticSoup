import { useEffect, useId, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { InventoryData, StackData } from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { Dialog } from '../common/Dialog';
import { ItemComparison, ItemSummary } from '../common/ItemDetail';
import { formatQuantity, formatVolume } from '../format/numbers';
import { readWholeQuantity } from '../format/quantity';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Station.module.css';
import type { PlayData } from '../frame/usePlayData';

/**
 * The station hangar and the docked ship's hold
 * (Functional Specification 6.2, 19.5).
 *
 * The two stores are two columns, hangar then hold, each listing its own
 * stacks with their quantity and volume, so the direction of every move is
 * where the row sits: a hangar row moves to the hold, a hold row to the hangar.
 * The hold also shows its capacity and free space, because what fits is the
 * decision the player makes before undocking.
 *
 * Each row offers One, All, a typed quantity and - into the hold, which has a
 * limit - Max, the most that fits. All always means the whole stack: when the
 * hold cannot take it, All is unavailable and says so, and never becomes a
 * smaller move. How much fits comes from the engine's `inventory.maximum`
 * query, not from arithmetic here, and the engine still validates every
 * transfer atomically.
 *
 * A typed quantity is a positive whole number no larger than the stack;
 * anything else leaves the move unavailable with the reason in its tooltip
 * rather than moving some other amount. A row's typed quantity is forgotten
 * when its stack changes, so a number typed for twelve units is never reused
 * for the three left after a move.
 *
 * A pilot who lost their only ship has no hold (Functional Specification
 * 9.12), so the hangar is shown alone and the hold column says why nothing can
 * be loaded. Recovery-grant stacks are labelled in words, because they can be
 * used and refitted but never sold or insured.
 *
 * @implements FUNC-6.2, FUNC-19.5, FUNC-9.12, MVP-AC-02, MVP-AC-08
 */

export interface HangarPanelProps {
  readonly gateway: ClientGateway;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

export function HangarPanel({ gateway, data, runner }: HangarPanelProps): JSX.Element {
  const translate = useTranslate();
  const assets = data.assets;
  const [inspecting, setInspecting] = useState<StackData | null>(null);
  const [comparedWith, setComparedWith] = useState<string | null>(null);

  const inspect = (stack: StackData): void => {
    setInspecting(stack);
    setComparedWith(null);
  };

  /** Distinct definitions the player holds locally, for the comparison list. */
  const owned = [
    ...new Map(
      (assets?.inventories ?? [])
        .flatMap((inventory) => inventory.stacks)
        .map((stack) => [stack.item.definitionId, stack.item] as const),
    ).values(),
  ].sort((left, right) => left.definitionId.localeCompare(right.definitionId));

  const hangar = assets?.inventories.find((inventory) => inventory.location.kind === 'hangar');
  const cargo = assets?.inventories.find(
    (inventory) =>
      inventory.location.kind === 'cargo' && inventory.location.shipId === assets.activeShipId,
  );
  const shipless = assets !== null && assets.activeShipId === null;

  return (
    <section className={styles['panel']} aria-labelledby="hangar-heading">
      <h3 id="hangar-heading" className={styles['panelHeading']}>
        {translate('hangar.heading')}
      </h3>

      {hangar !== undefined && shipless ? (
        <div className={styles['inventoryColumns']}>
          <InventoryColumn
            inventory={hangar}
            title={translate('hangar.stationHangar')}
            destination={null}
            direction="toHold"
            gateway={gateway}
            data={data}
            runner={runner}
            onInspect={inspect}
          />
          <div className={styles['inventoryColumn']}>
            <h4 className={styles['panelHeading']}>{translate('hangar.shipCargo')}</h4>
            <p className={styles['muted']} data-no-hold>
              {translate('hangar.noShip')}
            </p>
          </div>
        </div>
      ) : hangar === undefined || cargo === undefined ? (
        <p className={styles['muted']}>{translate('hangar.loading')}</p>
      ) : (
        <div className={styles['inventoryColumns']}>
          <InventoryColumn
            inventory={hangar}
            title={translate('hangar.stationHangar')}
            destination={cargo}
            direction="toHold"
            gateway={gateway}
            data={data}
            runner={runner}
            onInspect={inspect}
          />
          <InventoryColumn
            inventory={cargo}
            title={translate('hangar.shipCargo')}
            destination={hangar}
            direction="toHangar"
            gateway={gateway}
            data={data}
            runner={runner}
            onInspect={inspect}
          />
        </div>
      )}

      {inspecting === null ? null : (
        <Dialog
          open
          title={translate('item.inspectDialog')}
          onClose={() => {
            setInspecting(null);
          }}
        >
          <StackDetail stack={inspecting} />
          <label className={styles['field']}>
            {translate('compare.pick')}
            <select
              className={styles['select']}
              value={comparedWith ?? ''}
              onChange={(event) => {
                setComparedWith(event.target.value === '' ? null : event.target.value);
              }}
            >
              <option value="">{translate('compare.none')}</option>
              {owned
                .filter((item) => item.definitionId !== inspecting.item.definitionId)
                .map((item) => (
                  <option key={item.definitionId} value={item.definitionId}>
                    {translate(item.nameKey)}
                  </option>
                ))}
            </select>
          </label>
          {comparedWith === null ? null : (
            <ItemComparison
              gateway={gateway}
              definitionId={inspecting.item.definitionId}
              againstDefinitionId={comparedWith}
            />
          )}
        </Dialog>
      )}
    </section>
  );
}

/** Which way a column's rows move: the hangar loads the hold, and back. */
type Direction = 'toHold' | 'toHangar';

interface InventoryColumnProps {
  readonly inventory: InventoryData;
  readonly title: string;
  /** Where a stack can be moved, or `null` when there is nowhere to move it. */
  readonly destination: InventoryData | null;
  readonly direction: Direction;
  readonly gateway: ClientGateway;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly onInspect: (stack: StackData) => void;
}

function InventoryColumn({
  inventory,
  title,
  destination,
  direction,
  gateway,
  data,
  runner,
  onInspect,
}: InventoryColumnProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const plain = inventory.stacks.filter((stack) => stack.state.kind === 'plain');
  const maximumFor = useMaximaThatFit(gateway, plain, destination);

  return (
    <div className={styles['inventoryColumn']} data-inventory={inventory.location.kind}>
      <h4 className={styles['panelHeading']}>{title}</h4>
      <Capacity inventory={inventory} />

      {plain.length === 0 ? (
        <p className={styles['muted']}>{translate('inventory.empty')}</p>
      ) : (
        <div className={styles['tableWrapper']} tabIndex={0}>
          <table className={styles['table']}>
            <caption className={styles['visuallyHidden']}>{title}</caption>
            <thead>
              <tr>
                <th scope="col">{translate('market.item')}</th>
                <th scope="col" className={styles['numeric']}>
                  {translate('inventory.quantity')}
                </th>
                <th scope="col" className={styles['numeric']}>
                  {translate('inventory.volume')}
                </th>
                {destination === null ? null : (
                  <th scope="col">
                    {translate(direction === 'toHold' ? 'hangar.toCargo' : 'hangar.toHangar')}
                  </th>
                )}
                <th scope="col">
                  <span className={styles['visuallyHidden']}>{translate('hangar.details')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plain.map((stack) => (
                <tr key={stack.id} data-recovery-grant={stack.recoveryGrant ? 'true' : undefined}>
                  <th scope="row">
                    {translate(stack.item.nameKey)}
                    {stack.recoveryGrant ? <RecoveryGrantLabel /> : null}
                  </th>
                  <td className={styles['numeric']}>{formatQuantity(stack.quantity, locale)}</td>
                  <td className={styles['numeric']}>
                    {translate('volume.cubicMetres', {
                      volume: formatVolume(
                        stack.item.unitVolumeCubicDecimetres * stack.quantity,
                        locale,
                      ),
                    })}
                  </td>
                  {destination === null ? null : (
                    <td>
                      {/* Keyed by quantity: a changed stack starts with an empty field. */}
                      <TransferControls
                        key={`${stack.id}:${String(stack.quantity)}`}
                        stack={stack}
                        destination={destination}
                        direction={direction}
                        maximum={maximumFor(stack)}
                        gateway={gateway}
                        data={data}
                        runner={runner}
                      />
                    </td>
                  )}
                  <td>
                    <ActionButton
                      actionId="item.inspect"
                      runner={runner}
                      display="icon"
                      label={translate('market.inspectItem', {
                        item: translate(stack.item.nameKey),
                      })}
                      onRun={() => {
                        onInspect(stack);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Used volume, and for a store with a limit its capacity and free space, in
 * words with a bar beside them. The bar repeats the words; it is not the only
 * place the figure appears.
 */
function Capacity({ inventory }: { readonly inventory: InventoryData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const capacity = inventory.capacityCubicDecimetres;
  if (capacity === null) {
    return (
      <p className={styles['muted']}>
        {translate('inventory.capacity.unlimited', {
          used: formatVolume(inventory.usedCubicDecimetres, locale),
        })}
      </p>
    );
  }
  const fraction = capacity <= 0 ? 1 : Math.min(1, inventory.usedCubicDecimetres / capacity);
  return (
    <div className={styles['capacity']} data-capacity>
      <p className={styles['muted']}>
        {translate('inventory.capacity', {
          used: formatVolume(inventory.usedCubicDecimetres, locale),
          capacity: formatVolume(capacity, locale),
        })}
        {' · '}
        <strong className={styles['free']}>
          {translate('hangar.free', {
            free: formatVolume(inventory.freeCubicDecimetres ?? 0, locale),
          })}
        </strong>
      </p>
      <span className={styles['bar']} aria-hidden="true">
        <span className={styles['barFill']} style={{ width: `${String(fraction * 100)}%` }} />
      </span>
    </div>
  );
}

/**
 * How many units of each stack the destination can take, from the engine.
 *
 * Returns `null` for a stack when the destination has no limit, and
 * `undefined` while the answer for the current stacks and free space has not
 * arrived; neither blocks a move, because the engine validates it anyway.
 */
function useMaximaThatFit(
  gateway: ClientGateway,
  stacks: readonly StackData[],
  destination: InventoryData | null,
): (stack: StackData) => number | null | undefined {
  const limited = destination !== null && destination.capacityCubicDecimetres !== null;
  // What the answers depend on: the destination's free space and the stacks.
  const key = limited
    ? [
        destination.id,
        String(destination.freeCubicDecimetres),
        ...stacks.map((stack) => `${stack.id}:${String(stack.quantity)}`),
      ].join('|')
    : '';
  const [answers, setAnswers] = useState<{
    readonly key: string;
    readonly maxima: ReadonlyMap<string, number>;
  } | null>(null);

  useEffect(() => {
    if (!limited || stacks.length === 0) {
      return undefined;
    }
    let current = true;
    void Promise.all(
      stacks.map(async (stack) => {
        const response = await gateway.request('inventory.maximum', {
          stackId: stack.id,
          destinationInventoryId: destination.id,
        });
        return response.ok ? ([stack.id, response.data.maximumQuantity] as const) : null;
      }),
    )
      .then((entries) => {
        if (current) {
          setAnswers({
            key,
            maxima: new Map(entries.filter((entry) => entry !== null)),
          });
        }
      })
      .catch(() => {
        // An unanswered query leaves the moves offered; the engine decides.
      });
    return () => {
      current = false;
    };
    // `key` stands for the stacks and the destination: it changes exactly when
    // an answer could.
  }, [gateway, key]);

  return (stack) => {
    if (!limited) {
      return null;
    }
    return answers?.key === key ? answers.maxima.get(stack.id) : undefined;
  };
}

interface TransferControlsProps {
  readonly stack: StackData;
  readonly destination: InventoryData;
  readonly direction: Direction;
  /** Units that fit: `null` for no limit, `undefined` while not yet known. */
  readonly maximum: number | null | undefined;
  readonly gateway: ClientGateway;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

function TransferControls({
  stack,
  destination,
  direction,
  maximum,
  gateway,
  data,
  runner,
}: TransferControlsProps): JSX.Element {
  const translate = useTranslate();
  const quantityId = useId();
  const [text, setText] = useState('');
  const item = translate(stack.item.nameKey);
  const reading = readWholeQuantity(text, stack.quantity);
  const known = maximum !== null && maximum !== undefined;
  const reachable = destination.accessible;
  const blocked = reachable ? null : destination.unavailableReason;

  const move = async (quantity: number): Promise<void> => {
    await data.send('inventory.transfer', {
      stackId: stack.id,
      destinationInventoryId: destination.id,
      quantity,
    });
  };

  const fitsOne = !known || maximum >= 1;
  const fitsAll = !known || maximum >= stack.quantity;
  const typedFits = reading.ok && (!known || maximum >= reading.quantity);
  const typedReason = !reading.ok
    ? `hangar.quantity.${reading.problem}`
    : 'hangar.unavailable.typedDoesNotFit';

  return (
    <div className={styles['transferControls']}>
      <ActionButton
        actionId="inventory.transfer"
        runner={runner}
        display="short"
        shortLabel={translate('hangar.short.one')}
        label={translate(`hangar.${direction}.one`, { item })}
        available={reachable && fitsOne}
        unavailableReason={blocked ?? 'hangar.unavailable.noRoom'}
        onRun={() => move(1)}
      />
      <ActionButton
        actionId="inventory.transfer"
        runner={runner}
        display="short"
        shortLabel={translate('hangar.short.all')}
        label={translate(`hangar.${direction}.all`, { item })}
        available={reachable && fitsAll}
        unavailableReason={blocked ?? 'hangar.unavailable.allDoesNotFit'}
        onRun={() => move(stack.quantity)}
      />
      {destination.capacityCubicDecimetres === null ? null : (
        <ActionButton
          actionId="inventory.transfer"
          runner={runner}
          display="short"
          shortLabel={translate('hangar.short.max')}
          label={translate(`hangar.${direction}.max`, { item })}
          available={reachable && fitsOne}
          unavailableReason={blocked ?? 'hangar.unavailable.noRoom'}
          onRun={async () => {
            // Asked again at the moment of the move, so a stale answer cannot
            // choose the quantity.
            const response = await gateway.request('inventory.maximum', {
              stackId: stack.id,
              destinationInventoryId: destination.id,
            });
            if (response.ok && response.data.maximumQuantity > 0) {
              await move(response.data.maximumQuantity);
            } else {
              await data.refresh();
            }
          }}
        />
      )}
      <span className={styles['transferQuantity']}>
        <label className={styles['visuallyHidden']} htmlFor={quantityId}>
          {translate('hangar.quantityOf', { item })}
        </label>
        <input
          id={quantityId}
          className={styles['quantityInput']}
          type="number"
          inputMode="numeric"
          min={1}
          max={stack.quantity}
          step={1}
          placeholder={translate('hangar.quantityPlaceholder')}
          value={text}
          aria-invalid={text !== '' && !reading.ok ? true : undefined}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <ActionButton
          actionId="inventory.transfer"
          runner={runner}
          display="short"
          shortLabel={translate('hangar.short.move')}
          label={translate(`hangar.${direction}.typed`, { item })}
          available={reachable && typedFits}
          unavailableReason={blocked ?? typedReason}
          onRun={async () => {
            if (reading.ok) {
              await move(reading.quantity);
            }
          }}
        />
      </span>
    </div>
  );
}

/**
 * The word that marks a recovery-grant stack (Functional Specification 9.12):
 * usable and refittable, never saleable or insurable.
 */
export function RecoveryGrantLabel(): JSX.Element {
  const translate = useTranslate();
  return (
    <span className={styles['grant']} data-recovery-grant-label>
      {' '}
      {translate('recovery.grant')}
    </span>
  );
}

function StackDetail({ stack }: { readonly stack: StackData }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();

  return (
    <ItemSummary
      item={stack.item}
      facts={[
        {
          label: translate('inventory.quantity'),
          value: formatQuantity(stack.quantity, locale),
        },
        {
          label: translate('inventory.volume'),
          value: translate('volume.cubicMetres', {
            volume: formatVolume(stack.item.unitVolumeCubicDecimetres * stack.quantity, locale),
          }),
        },
        {
          label: translate('inventory.acquisition'),
          value: translate('inventory.acquisitionDetail', {
            granted: formatQuantity(stack.provenance.grantedQuantity, locale),
            purchased: formatQuantity(stack.provenance.purchasedQuantity, locale),
          }),
        },
        ...(stack.recoveryGrant
          ? [{ label: translate('recovery.grant'), value: translate('recovery.grantDetail') }]
          : []),
      ]}
    />
  );
}
