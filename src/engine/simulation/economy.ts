import { ECONOMY_HOUR_MS, listingDefinition, type MarketListingState } from '@engine/domain';

import type { SimulationContext } from './context';
import { scheduleBoundary } from './scheduler';

/** @implements FUNC-11.2, TECH-9.2, TECH-10.4 */

/** Applies whole hourly market production/consumption and queues the next hour. */
export function resolveEconomyHour(context: SimulationContext): void {
  const hour = Math.floor(context.draft.time.simulationTimeMs / ECONOMY_HOUR_MS);
  let quoteChanged = false;

  for (const stationId of Object.keys(context.draft.economy.stations).sort()) {
    const station = context.draft.economy.stations[stationId]!;
    for (const itemId of Object.keys(station.listings).sort()) {
      const current = station.listings[itemId]!;
      const definition = listingDefinition(context.content, stationId, itemId);
      const processed = advanceListing(current, definition, hour);
      station.listings[itemId] = processed;
      quoteChanged ||= processed.version !== current.version;
    }
  }

  scheduleBoundary(context.draft, {
    kind: 'economy.hour',
    dueAtMs: (hour + 1) * ECONOMY_HOUR_MS,
  });
  if (quoteChanged) context.invalidate('market');
}

function advanceListing(
  state: MarketListingState,
  definition: ReturnType<typeof listingDefinition>,
  throughHour: number,
): MarketListingState {
  if (throughHour <= state.lastProcessedHour) return state;
  let stock = state.stock;
  let accumulator = state.stockAccumulator;

  for (let hour = state.lastProcessedHour; hour < throughHour; hour += 1) {
    if (definition.supply === 'dynamic') {
      accumulator += definition.productionPerHour - definition.consumptionPerHour;
      const whole = accumulator < 0 ? Math.ceil(accumulator) : Math.floor(accumulator);
      accumulator -= whole;
      stock = Math.max(0, Math.min(definition.targetStock * 2, stock + whole));
      if ((stock === 0 && accumulator < 0) || (stock === definition.targetStock * 2 && accumulator > 0)) {
        accumulator = 0;
      }
    }
  }

  return {
    ...state,
    stock,
    stockAccumulator: accumulator,
    lastProcessedHour: throughHour,
    version: stock === state.stock ? state.version : state.version + 1,
  };
}
