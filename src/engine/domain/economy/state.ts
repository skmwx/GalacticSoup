import type { ContentRepository } from '@engine/ports';
import type { DefinitionId, StationId } from '@shared';

import type { EconomyServiceName, EconomyState, StationEconomyState } from './types';

/** A simulation hour is structural and shared by market boundaries and stored hour indices. */
export const ECONOMY_HOUR_MS = 3_600_000;
export const ECONOMY_BOUNDARY_KIND = 'economy.hour';

/** Builds the per-campaign station overlay from authored stations and listings. */
export function startingEconomy(content: ContentRepository): EconomyState {
  const stations: Record<string, StationEconomyState> = {};
  for (const station of content.stations()) {
    const services = Object.fromEntries(
      (['market', 'repair', 'resupply', 'insurance'] as const).map((name) => [
        name,
        {
          available:
            name === 'resupply'
              ? station.services.includes('market')
              : station.services.includes(name),
          version: 1,
        },
      ]),
    ) as unknown as Record<EconomyServiceName, { available: boolean; version: number }>;

    const listings: StationEconomyState['listings'] = Object.fromEntries(
      content.listings(station.id).map((listing) => [
        listing.itemId,
        {
          itemId: listing.itemId,
          stock: listing.initialStock,
          stockAccumulator: 0,
          lastProcessedHour: 0,
          eventFactor: 1,
          version: 1,
        },
      ]),
    );
    stations[station.id] = { stationId: station.id, services, listings };
  }
  return { stations };
}

export function requireStationEconomy(state: EconomyState, stationId: string): StationEconomyState {
  const station = Object.hasOwn(state.stations, stationId) ? state.stations[stationId] : undefined;
  if (station === undefined) throw new TypeError(`No station economy for "${stationId}".`);
  return station;
}

export function serviceVersion(
  state: EconomyState,
  stationId: string,
  service: EconomyServiceName,
): number {
  return requireStationEconomy(state, stationId).services[service].version;
}

export function listingKey(stationId: StationId | string, itemId: DefinitionId | string): string {
  return `${stationId}/${itemId}`;
}
