import { useId, useMemo, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type { MarketListingData, StackData } from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { Dialog } from '../common/Dialog';
import { FormulaExplanation } from '../common/Explanation';
import { ItemComparison, ItemSummary } from '../common/ItemDetail';
import { formatCredits, formatQuantity } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import styles from './Station.module.css';
import { TransactionDialog } from './TransactionDialog';
import type { PlayData } from '../frame/usePlayData';
import { useTransactionPreview } from './useTransactionPreview';

/**
 * The local market (Functional Specification 11.1, 11.3, 19.5).
 *
 * Both quote sides, the stock and the formula behind each price come from the
 * engine. Buying and selling go through the same preview-and-confirm path, and
 * a purchase lands in the station hangar unless the player sends it to the
 * ship's hold, which is what the functional specification prescribes.
 *
 * Deferred trade surfaces - remote quotes, price history, routes - are absent
 * rather than shown as empty panels.
 *
 * @implements FUNC-11.1, FUNC-11.3, FUNC-19.5, MVP-AC-02, MVP-AC-06
 */

export interface MarketPanelProps {
  readonly gateway: ClientGateway;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

interface BuyIntent {
  readonly itemId: string;
  readonly quantity: number;
  readonly destinationInventoryId: string | undefined;
}

interface SellIntent {
  readonly stackId: string;
  readonly quantity: number;
}

export function MarketPanel({ gateway, data, runner }: MarketPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const [filter, setFilter] = useState('');
  const [buy, setBuy] = useState<BuyIntent | null>(null);
  const [sell, setSell] = useState<SellIntent | null>(null);
  const [inspecting, setInspecting] = useState<MarketListingData | null>(null);
  const [comparedWith, setComparedWith] = useState<string | null>(null);
  const filterId = useId();

  const stationId = data.services?.stationId ?? null;
  const listings = data.market?.listings ?? [];
  const visible = useMemo(
    () =>
      listings.filter((listing) =>
        translate(listing.item.nameKey).toLowerCase().includes(filter.trim().toLowerCase()),
      ),
    [listings, filter, translate],
  );

  const sellable = useMemo(() => localSellableStacks(data), [data]);

  const buyPreview = useTransactionPreview({
    gateway,
    data,
    type: 'market.previewBuy',
    confirmType: 'market.confirmBuy',
    payload:
      buy === null || stationId === null
        ? null
        : {
            stationId,
            itemId: buy.itemId,
            quantity: buy.quantity,
            ...(buy.destinationInventoryId === undefined
              ? {}
              : { destinationInventoryId: buy.destinationInventoryId }),
          },
  });

  const sellPreview = useTransactionPreview({
    gateway,
    data,
    type: 'market.previewSell',
    confirmType: 'market.confirmSell',
    payload:
      sell === null || stationId === null
        ? null
        : { stationId, stackId: sell.stackId, quantity: sell.quantity },
  });

  const unavailable = data.market?.unavailableReason ?? null;

  return (
    <section className={styles['panel']} aria-labelledby="market-heading">
      <h3 id="market-heading" className={styles['panelHeading']}>
        {translate('market.heading')}
      </h3>

      {unavailable === null ? null : (
        <p className={styles['warning']}>{translate(unavailable)}</p>
      )}

      <div className={styles['toolbar']}>
        <label className={styles['field']} htmlFor={filterId}>
          {translate('market.filter')}
          <input
            id={filterId}
            className={styles['input']}
            type="search"
            value={filter}
            autoComplete="off"
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />
        </label>
      </div>

      <div className={styles['tableWrapper']}>
        <table className={styles['table']}>
          <caption className={styles['caption']}>
            {translate('market.caption', { count: visible.length })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{translate('market.item')}</th>
              <th scope="col">{translate('market.youPay')}</th>
              <th scope="col">{translate('market.youReceive')}</th>
              <th scope="col">{translate('market.stock')}</th>
              <th scope="col">{translate('market.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((listing) => (
              <tr key={listing.item.definitionId}>
                <th scope="row">{translate(listing.item.nameKey)}</th>
                <td className={styles['numeric']}>
                  {translate('credits.amount', {
                    credits: formatCredits(listing.stationSellPriceCredits, locale),
                  })}
                </td>
                <td className={styles['numeric']}>
                  {translate('credits.amount', {
                    credits: formatCredits(listing.stationBuyPriceCredits, locale),
                  })}
                </td>
                <td className={styles['numeric']}>
                  {listing.stock === null
                    ? translate('market.stock.unlimited')
                    : formatQuantity(listing.stock, locale)}
                </td>
                <td>
                  <div className={styles['rowActions']}>
                    <ActionButton
                      actionId="market.buy"
                      runner={runner}
                      available={listing.available}
                      unavailableReason={listing.unavailableReason}
                      label={translate('market.buyItem', {
                        item: translate(listing.item.nameKey),
                      })}
                      onRun={() => {
                        setBuy({
                          itemId: listing.item.definitionId,
                          quantity: 1,
                          destinationInventoryId: undefined,
                        });
                      }}
                    />
                    <ActionButton
                      actionId="item.inspect"
                      runner={runner}
                      label={translate('market.inspectItem', {
                        item: translate(listing.item.nameKey),
                      })}
                      onRun={() => {
                        setInspecting(listing);
                        setComparedWith(null);
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className={styles['panelHeading']}>{translate('market.sellHeading')}</h4>
      {sellable.length === 0 ? (
        <p className={styles['muted']}>{translate('market.nothingToSell')}</p>
      ) : (
        <div className={styles['tableWrapper']}>
          <table className={styles['table']}>
            <caption className={styles['caption']}>{translate('market.sellCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{translate('market.item')}</th>
                <th scope="col">{translate('inventory.quantity')}</th>
                <th scope="col">{translate('market.youReceive')}</th>
                <th scope="col">{translate('market.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sellable.map((stack) => {
                const listing = listings.find(
                  (entry) => entry.item.definitionId === stack.item.definitionId,
                );
                return (
                  <tr key={stack.id}>
                    <th scope="row">{translate(stack.item.nameKey)}</th>
                    <td className={styles['numeric']}>
                      {formatQuantity(stack.quantity, locale)}
                    </td>
                    <td className={styles['numeric']}>
                      {listing === undefined
                        ? translate('market.notTraded')
                        : translate('credits.amount', {
                            credits: formatCredits(listing.stationBuyPriceCredits, locale),
                          })}
                    </td>
                    <td>
                      <ActionButton
                        actionId="market.sell"
                        runner={runner}
                        available={listing !== undefined && unavailable === null}
                        unavailableReason={
                          listing === undefined ? 'market.unavailable.listing' : unavailable
                        }
                        label={translate('market.sellItem', {
                          item: translate(stack.item.nameKey),
                        })}
                        onRun={() => {
                          setSell({ stackId: stack.id, quantity: stack.quantity });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {buy === null ? null : (
        <BuyDialog
          data={data}
          intent={buy}
          onChange={setBuy}
          transaction={buyPreview}
          runner={runner}
          onClose={() => {
            setBuy(null);
          }}
        />
      )}

      {sell === null ? null : (
        <TransactionDialog
          open
          title={translate('market.sellDialog')}
          actionId="market.sell"
          transaction={sellPreview}
          runner={runner}
          walletCredits={data.assets?.credits ?? 0}
          onClose={() => {
            setSell(null);
          }}
          onCommitted={() => {
            setSell(null);
          }}
        />
      )}

      {inspecting === null ? null : (
        <Dialog
          open
          title={translate('item.inspectDialog')}
          onClose={() => {
            setInspecting(null);
          }}
        >
          <ItemSummary
            item={inspecting.item}
            facts={[
              {
                label: translate('market.youPay'),
                value: translate('credits.amount', {
                  credits: formatCredits(inspecting.stationSellPriceCredits, locale),
                }),
              },
              {
                label: translate('market.youReceive'),
                value: translate('credits.amount', {
                  credits: formatCredits(inspecting.stationBuyPriceCredits, locale),
                }),
              },
              {
                label: translate('market.supply'),
                value: translate(`market.supply.${inspecting.supply}`),
              },
            ]}
          />
          <FormulaExplanation
            traces={[inspecting.stationSellTrace, inspecting.stationBuyTrace]}
            label={translate('market.explainPrice')}
          />
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
              {listings
                .filter((entry) => entry.item.definitionId !== inspecting.item.definitionId)
                .map((entry) => (
                  <option key={entry.item.definitionId} value={entry.item.definitionId}>
                    {translate(entry.item.nameKey)}
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

interface BuyDialogProps {
  readonly data: PlayData;
  readonly intent: BuyIntent;
  readonly onChange: (intent: BuyIntent) => void;
  readonly transaction: ReturnType<typeof useTransactionPreview>;
  readonly runner: ActionRunner;
  readonly onClose: () => void;
}

/**
 * Buying names a quantity and a destination before it is confirmed. The
 * destination matters because a bought item goes to the station hangar by
 * default, and the player may want it in the hold they are about to leave with.
 */
function BuyDialog({
  data,
  intent,
  onChange,
  transaction,
  runner,
  onClose,
}: BuyDialogProps): JSX.Element {
  const translate = useTranslate();
  const quantityId = useId();
  const destinationId = useId();
  // The field may be empty while the player is retyping it; the quantity the
  // preview asks about keeps its last usable value until it is not.
  const [text, setText] = useState(String(intent.quantity));
  const cargo = data.assets?.inventories.find(
    (inventory) =>
      inventory.location.kind === 'cargo' &&
      inventory.location.shipId === data.assets?.activeShipId,
  );

  return (
    <TransactionDialog
      open
      title={translate('market.buyDialog')}
      actionId="market.buy"
      transaction={transaction}
      runner={runner}
      walletCredits={data.assets?.credits ?? 0}
      onClose={onClose}
      onCommitted={onClose}
    >
      <label className={styles['field']} htmlFor={quantityId}>
        {translate('market.quantity')}
      </label>
      <input
        id={quantityId}
        className={styles['input']}
        type="number"
        min={1}
        step={1}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number.parseInt(event.target.value, 10);
          if (Number.isSafeInteger(next) && next > 0) {
            onChange({ ...intent, quantity: next });
          }
        }}
      />
      <label className={styles['field']} htmlFor={destinationId}>
        {translate('market.destination')}
      </label>
      <select
        id={destinationId}
        className={styles['select']}
        value={intent.destinationInventoryId ?? ''}
        onChange={(event) => {
          onChange({
            ...intent,
            destinationInventoryId: event.target.value === '' ? undefined : event.target.value,
          });
        }}
      >
        <option value="">{translate('market.destination.hangar')}</option>
        {cargo === undefined ? null : (
          <option value={cargo.id}>{translate('market.destination.cargo')}</option>
        )}
      </select>
    </TransactionDialog>
  );
}

/** Plain stacks in the local hangar or the docked ship's hold. */
function localSellableStacks(data: PlayData): readonly StackData[] {
  const assets = data.assets;
  if (assets === null) {
    return [];
  }
  const local = new Set(
    assets.inventories
      .filter(
        (inventory) =>
          inventory.location.kind === 'hangar' ||
          (inventory.location.kind === 'cargo' &&
            inventory.location.shipId === assets.activeShipId),
      )
      .map((inventory) => inventory.id),
  );
  return assets.inventories
    .filter((inventory) => local.has(inventory.id))
    .flatMap((inventory) => inventory.stacks)
    .filter((stack) => stack.state.kind === 'plain')
    .sort((left, right) => left.id.localeCompare(right.id));
}
