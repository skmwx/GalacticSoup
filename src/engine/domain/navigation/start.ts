import type { ContentRepository } from '@engine/ports';
import type { SiteId, StationId } from '@shared';
import type { NavigationState } from './types';

/**
 * The navigation knowledge a campaign holds under the installed content
 * (Functional Specification 5.2; Technical Specification 11.4).
 *
 * Permanent sites appear once their system has been entered, so a site the
 * content adds to a system the campaign is already in is known at once - the
 * twelve-site ladder must be selectable from a campaign begun before it was
 * authored (FeatureSpec02 8.2). Only additions are applied: a known site is
 * never forgotten, and with unchanged content the state is returned as it is.
 */
export function withAuthoredSitesKnown(navigation: NavigationState, systemSiteIds: readonly SiteId[]): NavigationState {
  const known = new Set(navigation.knownDestinationSiteIds);
  const missing = systemSiteIds.filter((siteId) => !known.has(siteId));
  if (missing.length === 0) return navigation;
  return { ...navigation, knownDestinationSiteIds: [...known, ...missing].sort() };
}

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
