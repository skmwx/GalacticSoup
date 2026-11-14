import { useId, useMemo, useState, type JSX } from 'react';

import type { ClientGateway } from '@gateway';
import type {
  FormulaTraceData,
  MarketItemData,
  MarketListingData,
  MarketOwnedStackData,
  MarketSuitabilityData,
} from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { Dialog } from '../common/Dialog';
import { FormulaExplanation } from '../common/Explanation';
import { ItemComparison, ItemSummary } from '../common/ItemDetail';
import { formatCredits, formatQuantity } from '../format/numbers';
import { readWholeQuantity } from '../format/quantity';
import { useLocalizer, useTranslate } from '../localization';
import { RecoveryGrantLabel } from './HangarPanel';
import styles from './Station.module.css';
import { TransactionDialog } from './TransactionDialog';
import type { PlayData } from '../frame/usePlayData';
import { useTransactionPreview } from './useTransactionPreview';

/**
 * The local market (Functional Specification 11.1, 11.3, 19.5).
 *
 * The market shows one direction at a time, from the player's side: Buy lists
 * what the station offers and what the player pays; Sell lists what the player
 * owns here - in the station hangar or the docked ship's hold, never fitted
 * modules or loaded charges - and what the station pays. The stock, both
 * prices, the formula behind each, which slot a module occupies and which
 * weapons a charge suits all come from the engine. Buying and selling go
 * through the same preview-and-confirm path, and a purchase lands in the
 * station hangar unless the player sends it to the ship's hold, which is what
 * the functional specification prescribes.
 *
 * Deferred trade surfaces - remote quotes, price history, routes - are absent
 * rather than shown as empty panels.
 *
 * An owned stack the station will not take stays listed, with its Sell control
 * unavailable and the engine's reason in its tooltip: the item is not traded
 * here, or it is a recovery grant with no sale value (Functional Specification
 * 9.12). A pilot with no ship is told that the hull they buy here becomes
 * their active ship.
 *
 * @implements FUNC-11.1, FUNC-11.3, FUNC-19.5, FUNC-8.3, FUNC-9.12, MVP-AC-02, MVP-AC-06, MVP-AC-08
 */

export interface MarketPanelProps {
  readonly gateway: ClientGateway;
  readonly data: PlayData;
  readonly runner: ActionRunner;
}

type MarketMode = 'buy' | 'sell';

interface BuyIntent {
  readonly itemId: string;
  readonly quantity: number;
  readonly destinationInventoryId: string | undefined;
}

interface SellIntent {
  readonly stackId: string;
  readonly quantity: number;
  readonly available: number;
}

/** What the inspection dialog shows: the item, and the one price of the active mode. */
interface Inspection {
  readonly item: MarketItemData;
  readonly suitability: MarketSuitabilityData | null;
  readonly mode: MarketMode;
  readonly priceCredits: number | null;
  readonly trace: FormulaTraceData | null;
  readonly supply: MarketListingData['supply'] | null;
}

export function MarketPanel({ gateway, data, runner }: MarketPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const [mode, setMode] = useState<MarketMode>('buy');
  const [filter, setFilter] = useState('');
  const [buy, setBuy] = useState<BuyIntent | null>(null);
  const [sell, setSell] = useState<SellIntent | null>(null);
  const [inspecting, setInspecting] = useState<Inspection | null>(null);
  const [comparedWith, setComparedWith] = useState<string | null>(null);
  const filterId = useId();
  const modeName = useId();

  const stationId = data.services?.stationId ?? null;
  const listings = useMemo(() => data.market?.listings ?? [], [data.market]);
  const owned = useMemo(() => data.market?.owned ?? [], [data.market]);
  const matches = (nameKey: string): boolean =>
    translate(nameKey).toLowerCase().includes(filter.trim().toLowerCase());
  const visibleListings = listings.filter((listing) => matches(listing.item.nameKey));
  const visibleOwned = owned.filter((stack) => matches(stack.item.nameKey));

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

  const inspect = (next: Inspection): void => {
    setInspecting(next);
    setComparedWith(null);
  };

  return (
    <section className={styles['panel']} aria-labelledby="market-heading">
      <h3 id="market-heading" className={styles['panelHeading']}>
        {translate('market.heading')}
      </h3>

      {unavailable === null ? null : (
        <p className={styles['warning']}>{translate(unavailable)}</p>
      )}

      {data.assets !== null && data.assets.activeShipId === null ? (
        <p className={styles['warning']} data-no-ship>
          {translate('market.noShip')}
        </p>
      ) : null}

      <div className={styles['toolbar']}>
        <fieldset className={styles['modeSwitch']}>
          <legend className={styles['visuallyHidden']}>{translate('market.mode')}</legend>
          {(['buy', 'sell'] as const).map((option) => (
            <label key={option} className={styles['modeOption']}>
              <input
                type="radio"
                name={modeName}
                value={option}
                checked={mode === option}
                onChange={() => {
                  setMode(option);
                }}
              />
              <span>{translate(`market.mode.${option}`)}</span>
            </label>
          ))}
        </fieldset>
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

      {mode === 'buy' ? (
        <div className={styles['tableWrapper']} tabIndex={0} data-market-mode="buy">
          <table className={styles['table']}>
            <caption className={styles['caption']}>
              {translate('market.caption', { count: visibleListings.length })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{translate('market.item')}</th>
                <th scope="col">{translate('market.fits')}</th>
                <th scope="col" className={styles['numeric']}>
                  {translate('market.youPay')}
                </th>
                <th scope="col" className={styles['numeric']}>
                  {translate('market.stock')}
                </th>
                <th scope="col">
                  <span className={styles['visuallyHidden']}>{translate('market.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleListings.map((listing) => {
                const name = translate(listing.item.nameKey);
                return (
                  <tr key={listing.item.definitionId}>
                    <th scope="row">{name}</th>
                    <td className={styles['suitabilityCell']}>
                      <Suitability suitability={listing.suitability} />
                    </td>
                    <td className={styles['numeric']}>
                      {translate('credits.amount', {
                        credits: formatCredits(listing.stationSellPriceCredits, locale),
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
                          display="icon"
                          available={listing.available}
                          unavailableReason={listing.unavailableReason}
                          label={translate('market.buyItem', { item: name })}
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
                          display="icon"
                          label={translate('market.inspectItem', { item: name })}
                          onRun={() => {
                            inspect({
                              item: listing.item,
                              suitability: listing.suitability,
                              mode: 'buy',
                              priceCredits: listing.stationSellPriceCredits,
                              trace: listing.stationSellTrace,
                              supply: listing.supply,
                            });
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : owned.length === 0 ? (
        <p className={styles['muted']} data-market-mode="sell">
          {translate('market.nothingToSell')}
        </p>
      ) : (
        <div className={styles['tableWrapper']} tabIndex={0} data-market-mode="sell">
          <table className={styles['table']}>
            <caption className={styles['caption']}>
              {translate('market.sellCaption', { count: visibleOwned.length })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{translate('market.item')}</th>
                <th scope="col">{translate('market.fits')}</th>
                <th scope="col">{translate('market.source')}</th>
                <th scope="col" className={styles['numeric']}>
                  {translate('inventory.quantity')}
                </th>
                <th scope="col" className={styles['numeric']}>
                  {translate('market.youReceive')}
                </th>
                <th scope="col">
                  <span className={styles['visuallyHidden']}>{translate('market.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleOwned.map((stack) => (
                <OwnedRow
                  key={stack.stackId}
                  stack={stack}
                  listing={listings.find(
                    (entry) => entry.item.definitionId === stack.item.definitionId,
                  )}
                  runner={runner}
                  onSell={() => {
                    setSell({
                      stackId: stack.stackId,
                      quantity: stack.quantity,
                      available: stack.quantity,
                    });
                  }}
                  onInspect={inspect}
                />
              ))}
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
        >
          <QuantityField
            initial={sell.quantity}
            maximum={sell.available}
            onChange={(quantity) => {
              setSell({ ...sell, quantity });
            }}
          />
        </TransactionDialog>
      )}

      {inspecting === null ? null : (
        <Dialog
          open
          title={translate('item.inspectDialog')}
          onClose={() => {
            setInspecting(null);
          }}
        >
          <ItemSummary item={inspecting.item} facts={inspectionFacts(inspecting, translate, locale)} />
          {inspecting.trace === null ? null : (
            <FormulaExplanation
              traces={[inspecting.trace]}
              label={translate('market.explainPrice')}
            />
          )}
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

interface OwnedRowProps {
  readonly stack: MarketOwnedStackData;
  readonly listing: MarketListingData | undefined;
  readonly runner: ActionRunner;
  readonly onSell: () => void;
  readonly onInspect: (inspection: Inspection) => void;
}

/** One stack the player owns here, with where it is and what the station pays. */
function OwnedRow({ stack, listing, runner, onSell, onInspect }: OwnedRowProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const name = translate(stack.item.nameKey);
  const source = translate(`market.source.${stack.source}`);
  return (
    <tr
      data-recovery-grant={stack.recoveryGrant ? 'true' : undefined}
      data-source={stack.source}
    >
      <th scope="row">
        {name}
        {stack.recoveryGrant ? <RecoveryGrantLabel /> : null}
      </th>
      <td className={styles['suitabilityCell']}>
        <Suitability suitability={stack.suitability} />
      </td>
      <td>{source}</td>
      <td className={styles['numeric']}>{formatQuantity(stack.quantity, locale)}</td>
      <td className={styles['numeric']}>
        {stack.unitSalePriceCredits === null
          ? translate('market.notTraded')
          : translate('credits.amount', {
              credits: formatCredits(stack.unitSalePriceCredits, locale),
            })}
      </td>
      <td>
        <div className={styles['rowActions']}>
          <ActionButton
            actionId="market.sell"
            runner={runner}
            display="icon"
            available={stack.sellable}
            unavailableReason={stack.unavailableReason}
            label={translate('market.sellItemFrom', { item: name, source })}
            onRun={onSell}
          />
          <ActionButton
            actionId="item.inspect"
            runner={runner}
            display="icon"
            label={translate('market.inspectItemFrom', { item: name, source })}
            onRun={() => {
              onInspect({
                item: stack.item,
                suitability: stack.suitability,
                mode: 'sell',
                priceCredits: stack.unitSalePriceCredits,
                trace: listing?.stationBuyTrace ?? null,
                supply: listing?.supply ?? null,
              });
            }}
          />
        </div>
      </td>
    </tr>
  );
}

/**
 * What an item is for: a module's slot, or the weapons a charge suits and
 * whether one of them is in the active ship's committed fit. The match is
 * stated in words, with a mark that is not colour alone.
 */
function Suitability({
  suitability,
}: {
  readonly suitability: MarketSuitabilityData | null;
}): JSX.Element | null {
  const translate = useTranslate();
  if (suitability === null) {
    return null;
  }
  if (suitability.kind === 'module') {
    return <span data-suitability="module">{moduleSlotText(suitability, translate)}</span>;
  }
  return (
    <span className={styles['suitability']} data-suitability="ammunition">
      <span>{ammunitionUsesText(suitability, translate)}</span>
      <span className={styles['fitMatch']} data-fit-match={suitability.currentFit}>
        {suitability.currentFit === 'compatible' ? (
          <span aria-hidden="true" className={styles['fitMark']}>
            ✓{' '}
          </span>
        ) : null}
        <span>{translate(`market.fitMatch.${suitability.currentFit}`)}</span>
      </span>
    </span>
  );
}

type Translate = ReturnType<typeof useTranslate>;

function moduleSlotText(
  suitability: Extract<MarketSuitabilityData, { kind: 'module' }>,
  translate: Translate,
): string {
  const slot = translate(`slot.${suitability.slot}`);
  return suitability.hardpoint === null
    ? translate('market.slotFit', { slot })
    : translate('market.slotFitHardpoint', {
        slot,
        hardpoint: translate(`hardpoint.${suitability.hardpoint}`),
      });
}

function ammunitionUsesText(
  suitability: Extract<MarketSuitabilityData, { kind: 'ammunition' }>,
  translate: Translate,
): string {
  if (suitability.weapons.length === 0) {
    return translate('market.chargeFor.none');
  }
  return translate('market.chargeFor', {
    weapons: suitability.weapons.map((weapon) => translate(weapon.nameKey)).join(', '),
  });
}

/** The inspection facts of one mode: its single price, supply, and what the item is for. */
function inspectionFacts(
  inspection: Inspection,
  translate: Translate,
  locale: string,
): { readonly label: string; readonly value: string }[] {
  const facts: { label: string; value: string }[] = [
    {
      label: translate(inspection.mode === 'buy' ? 'market.youPay' : 'market.youReceive'),
      value:
        inspection.priceCredits === null
          ? translate('market.notTraded')
          : translate('credits.amount', {
              credits: formatCredits(inspection.priceCredits, locale),
            }),
    },
  ];
  if (inspection.supply !== null) {
    facts.push({
      label: translate('market.supply'),
      value: translate(`market.supply.${inspection.supply}`),
    });
  }
  const suitability = inspection.suitability;
  if (suitability?.kind === 'module') {
    facts.push({ label: translate('market.fits'), value: moduleSlotText(suitability, translate) });
  } else if (suitability?.kind === 'ammunition') {
    facts.push({
      label: translate('market.fits'),
      value: ammunitionUsesText(suitability, translate),
    });
    facts.push({
      label: translate('market.yourFit'),
      value: translate(`market.fitMatch.${suitability.currentFit}`),
    });
  }
  return facts;
}

/**
 * A whole positive quantity, up to an optional maximum. The field may be
 * empty or out of range while the player retypes it; the quantity the preview
 * asks about keeps its last usable value until the text is one again.
 */
function QuantityField({
  initial,
  maximum,
  onChange,
}: {
  readonly initial: number;
  readonly maximum?: number;
  readonly onChange: (quantity: number) => void;
}): JSX.Element {
  const translate = useTranslate();
  const id = useId();
  const [text, setText] = useState(String(initial));
  return (
    <>
      <label className={styles['field']} htmlFor={id}>
        {translate('market.quantity')}
      </label>
      <input
        id={id}
        className={styles['input']}
        type="number"
        min={1}
        {...(maximum === undefined ? {} : { max: maximum })}
        step={1}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const reading = readWholeQuantity(event.target.value, maximum);
          if (reading.ok) {
            onChange(reading.quantity);
          }
        }}
      />
    </>
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
  const destinationId = useId();
  const cargo = data.assets?.inventories.find(
    (inventory) =>
      inventory.location.kind === 'cargo' &&
      inventory.location.shipId === data.assets?.activeShipId,
  );
  // A hull is not cargo: it arrives as a ship of its own, empty, and the ship
  // the player flies stays active (FeatureSpec02 4.2).
  const preview = transaction.preview;
  const isHull = preview !== null && 'item' in preview && preview.item.kind === 'hull';
  const shipless = data.assets !== null && data.assets.activeShipId === null;

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
      <QuantityField
        initial={intent.quantity}
        onChange={(quantity) => {
          onChange({ ...intent, quantity });
        }}
      />
      {isHull ? (
        <p className={styles['notice']} data-hull-arrives>
          {translate(shipless ? 'market.noShip' : 'market.hullArrives')}
        </p>
      ) : null}
      <label className={styles['field']} htmlFor={destinationId} hidden={isHull}>
        {translate('market.destination')}
      </label>
      <select
        hidden={isHull}
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
