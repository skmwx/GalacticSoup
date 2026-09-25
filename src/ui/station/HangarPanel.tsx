import { useId, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { InventoryData, StackData } from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { Dialog } from '../common/Dialog';
import { ItemComparison, ItemSummary } from '../common/ItemDetail';
import { formatQuantity, formatVolume } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Station.module.css';
import type { PlayData } from '../frame/usePlayData';

/**
 * The station hangar and the docked ship's hold
 * (Functional Specification 6.2, 19.5).
 *
 * The two stores are shown side by side with their capacity, because what
 * fits in the hold is the decision the player makes before undocking. Moving
 * a stack is an engine command; the interface only names the stack, the
 * destination and the quantity.
 *
 * A pilot who lost their only ship has no hold (Functional Specification
 * 9.12), so the hangar is shown alone and says why nothing can be loaded.
 * Recovery-grant stacks are labelled in words, because they can be used and
 * refitted but never sold or insured.
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
        <>
          <InventoryTable
            inventory={hangar}
            title={translate('hangar.stationHangar')}
            destination={null}
            destinationLabel={translate('hangar.toCargo')}
            data={data}
            runner={runner}
            onInspect={inspect}
          />
          <p className={styles['muted']} data-no-hold>
            {translate('hangar.noShip')}
          </p>
        </>
      ) : hangar === undefined || cargo === undefined ? (
        <p className={styles['muted']}>{translate('hangar.loading')}</p>
      ) : (
        <>
          <InventoryTable
            inventory={hangar}
            title={translate('hangar.stationHangar')}
            destination={cargo}
            destinationLabel={translate('hangar.toCargo')}
            data={data}
            runner={runner}
            onInspect={inspect}
          />
          <InventoryTable
            inventory={cargo}
            title={translate('hangar.shipCargo')}
            destination={hangar}
            destinationLabel={translate('hangar.toHangar')}
            data={data}
            runner={runner}
            onInspect={inspect}
          />
        </>
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

interface InventoryTableProps {
  readonly inventory: InventoryData;
  readonly title: string;
  /** Where a stack can be moved, or `null` when there is nowhere to move it. */
  readonly destination: InventoryData | null;
  readonly destinationLabel: string;
  readonly data: PlayData;
  readonly runner: ActionRunner;
  readonly onInspect: (stack: StackData) => void;
}

function InventoryTable({
  inventory,
  title,
  destination,
  destinationLabel,
  data,
  runner,
  onInspect,
}: InventoryTableProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const plain = inventory.stacks.filter((stack) => stack.state.kind === 'plain');

  return (
    <div>
      <h4 className={styles['panelHeading']}>{title}</h4>
      <p className={styles['muted']}>
        {inventory.capacityCubicDecimetres === null
          ? translate('inventory.capacity.unlimited', {
              used: formatVolume(inventory.usedCubicDecimetres, locale),
            })
          : translate('inventory.capacity', {
              used: formatVolume(inventory.usedCubicDecimetres, locale),
              capacity: formatVolume(inventory.capacityCubicDecimetres, locale),
            })}
      </p>

      {plain.length === 0 ? (
        <p className={styles['muted']}>{translate('inventory.empty')}</p>
      ) : (
        <div className={styles['tableWrapper']}>
          <table className={styles['table']}>
            <caption className={styles['caption']}>{title}</caption>
            <thead>
              <tr>
                <th scope="col">{translate('market.item')}</th>
                <th scope="col">{translate('inventory.quantity')}</th>
                <th scope="col">{translate('inventory.volume')}</th>
                <th scope="col">{translate('market.actions')}</th>
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
                  <td>
                    <div className={styles['rowActions']}>
                      {destination === null ? null : (
                        <TransferControl
                          stack={stack}
                          destination={destination}
                          destinationLabel={destinationLabel}
                          data={data}
                          runner={runner}
                        />
                      )}
                      <ActionButton
                        actionId="item.inspect"
                        runner={runner}
                        label={translate('market.inspectItem', {
                          item: translate(stack.item.nameKey),
                        })}
                        onRun={() => {
                          onInspect(stack);
                        }}
                      />
                    </div>
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

interface TransferControlProps {
  readonly stack: StackData;
  readonly destination: InventoryData;
  readonly destinationLabel: string;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

function TransferControl({
  stack,
  destination,
  destinationLabel,
  data,
  runner,
}: TransferControlProps): JSX.Element {
  const translate = useTranslate();
  const [text, setText] = useState(String(stack.quantity));
  const quantityId = useId();
  const parsed = Number.parseInt(text, 10);
  const capped = Math.min(
    Math.max(1, Number.isSafeInteger(parsed) ? parsed : stack.quantity),
    stack.quantity,
  );

  return (
    <>
      <label className={styles['field']} htmlFor={quantityId}>
        {translate('inventory.moveQuantity')}
        <input
          id={quantityId}
          className={styles['input']}
          type="number"
          min={1}
          max={stack.quantity}
          step={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
      <ActionButton
        actionId="inventory.transfer"
        runner={runner}
        available={destination.accessible}
        unavailableReason={destination.unavailableReason}
        label={destinationLabel}
        onRun={async () => {
          await data.send('inventory.transfer', {
            stackId: stack.id,
            destinationInventoryId: destination.id,
            quantity: capped,
          });
        }}
      />
    </>
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
