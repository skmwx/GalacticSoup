import type { ContentRepository } from '@engine/ports';
import type { StationId } from '@shared';
import type { NavigationState } from './types';

/** Initial navigation knowledge for the single authored MVP system. */
export function startingNavigation(content: ContentRepository): NavigationState {
  const station = content.requireStation(content.rules.economy.startingStationId as StationId);
  const system = content.requireSystem(station.systemId);
  return {
    version: 1,
    knownDestinationSiteIds: system.sites.map((site) => site.id).sort(),
    selectedEncounterId: null,
    selectedBookmarkId: null,
    currentSite: null,
    movementOrders: {},
    travel: null,
    lastCancellation: null,
  };
}
