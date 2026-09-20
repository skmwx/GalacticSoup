import type { ContentRepository, MarketListingDefinition } from '@engine/ports';
import { clamp } from '@shared';

import { EconomyError, type BulkQuote, type MarketListingState, type MarketSide, type UnitQuote } from './types';

/**
 * Local quote and stock rules.
 * @implements FUNC-11.1, FUNC-11.2, FUNC-19.6, TECH-10.4
 */

/** The local MVP has Trade rank 0 and neutral controlling-faction standing. */
const TRADE_RANK = 0;
const STANDING = 0;

export function listingDefinition(
  content: ContentRepository,
  stationId: string,
  itemId: string,
): MarketListingDefinition {
  const listing = content.listings(stationId).find((candidate) => candidate.itemId === itemId);
  if (listing === undefined) throw new EconomyError('listingNotFound');
  return listing;
}

/** Functional Specification 11.1, including final per-unit rounding. */
export function unitQuote(
  content: ContentRepository,
  definition: MarketListingDefinition,
  state: MarketListingState,
  side: MarketSide,
  virtualStock: number = state.stock,
): UnitQuote {
  const rules = content.rules.economy;
  const scarcity = definition.supply === 'fixed'
    ? 0
    : clamp(rules.scarcityMinimum, rules.scarcityMaximum,
      (definition.targetStock - virtualStock) / definition.targetStock);
  const scarcityMultiplier = clamp(
    rules.midPriceMultiplierMinimum,
    rules.midPriceMultiplierMaximum,
    1 + definition.elasticity * scarcity,
  );
  const midPrice = definition.basePriceCredits * definition.regionalPriceFactor *
    scarcityMultiplier * state.eventFactor;
  const effectiveSpread = clamp(
    rules.effectiveSpreadMinimum,
    rules.effectiveSpreadMaximum,
    definition.baseSpread * (1 - 0.04 * TRADE_RANK) * (1 - STANDING / 500),
  );
  const spreadMultiplier = side === 'stationSells' ? 1 + effectiveSpread : 1 - effectiveSpread;
  const unrounded = midPrice * spreadMultiplier;
  const display = Math.max(rules.minimumUnitPriceCredits, Math.round(unrounded));

  return {
    side,
    unitPriceCredits: display,
    scarcity,
    midPriceCredits: midPrice,
    effectiveSpread,
    trace: {
      formulaKey: side === 'stationSells' ? 'market.stationSellPrice' : 'market.stationBuyPrice',
      operands: [
        { key: 'basePriceCredits', value: definition.basePriceCredits },
        { key: 'regionalPriceFactor', value: definition.regionalPriceFactor },
        { key: 'targetStock', value: definition.targetStock },
        { key: 'currentStock', value: definition.supply === 'fixed' ? definition.targetStock : virtualStock },
        { key: 'scarcity', value: scarcity },
        { key: 'elasticity', value: definition.elasticity },
        { key: 'scarcityMultiplier', value: scarcityMultiplier },
        { key: 'eventFactor', value: state.eventFactor },
        { key: 'midPriceCredits', value: midPrice },
        { key: 'effectiveSpread', value: effectiveSpread },
        { key: 'spreadMultiplier', value: spreadMultiplier },
      ],
      unroundedResult: unrounded,
      displayResult: display,
    },
  };
}

/** Literal one-unit-at-a-time bulk algorithm required by Functional Specification 11.1. */
export function bulkQuote(
  content: ContentRepository,
  definition: MarketListingDefinition,
  state: MarketListingState,
  side: MarketSide,
  quantity: number,
): BulkQuote {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new RangeError('Quantity must be positive and whole.');
  if (definition.supply === 'dynamic' && side === 'stationSells' && quantity > state.stock) {
    throw new EconomyError('insufficientStock');
  }

  let virtualStock = state.stock;
  let total = 0;
  let first: UnitQuote | null = null;
  let last: UnitQuote | null = null;
  const add = (quote: UnitQuote, count: number, lastQuote: UnitQuote = quote): void => {
    const subtotal = quote.unitPriceCredits * count;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total + subtotal)) {
      throw new RangeError('Market total exceeded the safe integer range.');
    }
    first ??= quote;
    last = lastQuote;
    total += subtotal;
  };

  let remaining = quantity;
  if (definition.supply === 'fixed') {
    const quote = unitQuote(content, definition, state, side, virtualStock);
    add(quote, remaining);
    remaining = 0;
  } else if (side === 'stationSells' && virtualStock >= definition.targetStock * 2) {
    // Scarcity is clamped at -1 while stock is at or above twice target. All
    // of those units have the same rounded price, so a very large recovered
    // stockpile cannot turn confirmation into an unbounded loop.
    const count = Math.min(remaining, virtualStock - definition.targetStock * 2 + 1);
    const quote = unitQuote(content, definition, state, side, virtualStock);
    const finalQuote = unitQuote(content, definition, state, side, virtualStock - count + 1);
    add(quote, count, finalQuote);
    virtualStock -= count;
    remaining -= count;
  }

  while (remaining > 0 && !(side === 'stationBuys' && virtualStock >= definition.targetStock * 2)) {
    const quote = unitQuote(content, definition, state, side, virtualStock);
    add(quote, 1);
    virtualStock += side === 'stationSells' ? -1 : 1;
    remaining -= 1;
  }

  if (remaining > 0) {
    // Station buys are clamped at scarcity -1 once stock reaches twice target.
    const quote = unitQuote(content, definition, state, side, virtualStock);
    const finalQuote = unitQuote(content, definition, state, side, virtualStock + remaining - 1);
    add(quote, remaining, finalQuote);
    virtualStock += remaining;
    remaining = 0;
  }

  return {
    side,
    quantity,
    totalCredits: total,
    averageUnitPriceCredits: total / quantity,
    firstUnitPriceCredits: first!.unitPriceCredits,
    lastUnitPriceCredits: last!.unitPriceCredits,
    initialStock: definition.supply === 'fixed' ? null : state.stock,
    remainingStock: definition.supply === 'fixed' ? null : virtualStock,
    priceMovementCredits: last!.unitPriceCredits - first!.unitPriceCredits,
    firstUnitTrace: first!.trace,
    lastUnitTrace: last!.trace,
  };
}

export function applyStockMovement(
  state: MarketListingState,
  definition: MarketListingDefinition,
  side: MarketSide,
  quantity: number,
): MarketListingState {
  if (definition.supply === 'fixed') return state;
  const stock = state.stock + (side === 'stationSells' ? -quantity : quantity);
  if (!Number.isSafeInteger(stock) || stock < 0) throw new EconomyError('insufficientStock');
  return { ...state, stock, version: state.version + 1 };
}
