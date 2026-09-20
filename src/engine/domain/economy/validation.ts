import type { ContentRepository } from '@engine/ports';
import { isCount, isDefinitionId, isNonNegativeNumber } from '@shared';

import type { CampaignState } from '../campaign/state';
import { ECONOMY_SERVICE_NAMES, type EconomyState } from './types';

/** @implements TECH-15.3 */

type Report = (rule: string, path: string, detail: string) => void;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

export function isEconomyState(value: unknown): value is EconomyState {
  if (!exact(value, ['stations']) || !record(value['stations'])) return false;
  return Object.entries(value['stations']).every(([stationId, candidate]) => {
    if (!exact(candidate, ['stationId', 'services', 'listings']) || candidate['stationId'] !== stationId ||
        !stationId.startsWith('station.') || !record(candidate['services']) || !record(candidate['listings'])) return false;
    const services = candidate['services'];
    if (Object.keys(services).sort().join(',') !== [...ECONOMY_SERVICE_NAMES].sort().join(',')) return false;
    if (!Object.values(services).every((service) => exact(service, ['available', 'version']) &&
      typeof service['available'] === 'boolean' && isCount(service['version']) && service['version'] > 0)) return false;
    return Object.entries(candidate['listings']).every(([itemId, listing]) =>
      isDefinitionId(itemId) && exact(listing,
        ['itemId', 'stock', 'stockAccumulator', 'lastProcessedHour', 'eventFactor', 'version']) &&
      listing['itemId'] === itemId && isCount(listing['stock']) &&
      typeof listing['stockAccumulator'] === 'number' && Number.isFinite(listing['stockAccumulator']) &&
      Math.abs(listing['stockAccumulator']) < 1 && isCount(listing['lastProcessedHour']) &&
      isNonNegativeNumber(listing['eventFactor']) && listing['eventFactor'] > 0 &&
      isCount(listing['version']) && listing['version'] > 0);
  });
}

/** Station economy ownership, content references and quote-relevant bounds. */
export function validateEconomy(state: CampaignState, add: Report, content?: ContentRepository): void {
  if (!isEconomyState(state.economy)) {
    add('economyShape', 'economy', 'Station economies have an unknown field, missing field or invalid value.');
    return;
  }
  if (content === undefined) return;

  for (const [stationId, station] of Object.entries(state.economy.stations)) {
    const path = `economy.stations.${stationId}`;
    const definition = content.station(stationId);
    if (definition === undefined) {
      add('economyReference', path, 'Station does not resolve.');
      continue;
    }
    const authored = content.listings(stationId);
    const authoredIds = authored.map((listing) => listing.itemId).sort();
    if (Object.keys(station.listings).sort().join(',') !== authoredIds.join(',')) {
      add('economyReference', `${path}.listings`, 'Stored listings differ from authored listings.');
    }
    for (const listing of Object.values(station.listings)) {
      const source = authored.find((candidate) => candidate.itemId === listing.itemId);
      if (source === undefined) continue;
      const listingPath = `${path}.listings.${listing.itemId}`;
      if (listing.lastProcessedHour > Math.floor(state.time.simulationTimeMs / 3_600_000)) {
        add('economyTime', `${listingPath}.lastProcessedHour`, 'A listing cannot be processed beyond campaign time.');
      }
      if (listing.eventFactor < 0.75 || listing.eventFactor > 1.5) {
        add('boundedValues', `${listingPath}.eventFactor`, 'A market event factor must be from 0.75 through 1.50.');
      }
      if (source.supply === 'fixed' &&
          (listing.stock !== source.initialStock || listing.stockAccumulator !== 0)) {
        add('economyStock', listingPath, 'Fixed recovery stock cannot be consumed or accumulated.');
      }
    }
  }
}
