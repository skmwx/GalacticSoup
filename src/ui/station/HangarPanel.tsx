import { useId, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { InventoryData, StackData } from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { Dialog } from '../common/Dialog';
import { ItemComparison, ItemSummary } from '../common/ItemDetail';
import { formatQuantity, formatVolume } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Station.module.css';
import type { StationData } from './useStationData';

/**
 * The station hangar and the docked ship's hold
 * (Functional Specification 6.2, 19.5).
 *
 * The two stores are shown side by side with their capacity, because what
 * fits in the hold is the decision the player makes before undocking. Moving
 * a stack is an engine command; the interface only names the stack, the
 * destination and the quantity.
 *
 * @implements FUNC-6.2, FUNC-19.5, MVP-AC-02
 */

export interface HangarPanelProps {
  readonly gateway: ClientGateway;
  readonly station: StationData;
  readonly runner: ActionRunner;
}

export function HangarPanel({ gateway, station, runner }: HangarPanelProps): JSX.Element {
  const translate = useTranslate();
  const assets = station.assets;
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

  return (
    <section className={styles['panel']} aria-labelledby="hangar-heading">
      <h3 id="hangar-heading" className={styles['panelHeading']}>
        {translate('hangar.heading')}
      </h3>

      {hangar === undefined || cargo === undefined ? (
        <p className={styles['muted']}>{translate('hangar.loading')}</p>
      ) : (
        <>
          <InventoryTable
            inventory={hangar}
            title={translate('hangar.stationHangar')}
            destination={cargo}
            destinationLabel={translate('hangar.toCargo')}
            station={station}
            runner={runner}
            onInspect={inspect}
          />
          <InventoryTable
            inventory={cargo}
            title={translate('hangar.shipCargo')}
            destination={hangar}
            destinationLabel={translate('hangar.toHangar')}
            station={station}
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
  readonly destination: InventoryData;
  readonly destinationLabel: string;
  readonly station: StationData;
  readonly runner: ActionRunner;
  readonly onInspect: (stack: StackData) => void;
}

function InventoryTable({
  inventory,
  title,
  destination,
  destinationLabel,
  station,
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
                <tr key={stack.id}>
                  <th scope="row">{translate(stack.item.nameKey)}</th>
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
                      <TransferControl
                        stack={stack}
                        destination={destination}
                        destinationLabel={destinationLabel}
                        station={station}
                        runner={runner}
                      />
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
  readonly station: StationData;
  readonly runner: ActionRunner;
}

function TransferControl({
  stack,
  destination,
  destinationLabel,
  station,
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
          await station.send('inventory.transfer', {
            stackId: stack.id,
            destinationInventoryId: destination.id,
            quantity: capped,
          });
        }}
      />
    </>
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
      ]}
    />
  );
}
