import type { CampaignState } from '@engine/domain';
import { distance } from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type {
  DestinationData,
  DestinationsData,
  SiteData,
  SiteObjectData,
  TravelStatusData,
} from '@protocol';
import { deepClone, deepFreeze } from '@shared';

/**
 * Immutable site, object, movement, travel and destination views for phase 9.
 *
 * @implements TECH-7.3, TECH-10.1, FUNC-5.2, FUNC-5.3, FUNC-7.1, FUNC-7.2, FUNC-7.3, FUNC-7.4, MVP-AC-03, MVP-AC-08
 */
export function siteProjection(state: CampaignState, content: ContentRepository): SiteData {
  const runtime = state.navigation.currentSite;
  const player = runtime?.objects[state.assets.activeShipId];
  const siteDefinition = runtime === null
    ? undefined
    : content.requireSystem(runtime.systemId).sites.find((candidate) => candidate.id === runtime.siteId);
  const system = runtime === null ? undefined : content.requireSystem(runtime.systemId);

  return deepFreeze({
    revision: state.revision,
    simulationTimeMs: state.time.simulationTimeMs,
    location: deepClone(state.assets.location),
    site:
      runtime === null || player === undefined || siteDefinition === undefined || system === undefined
        ? null
        : {
            instanceId: runtime.instanceId,
            systemId: runtime.systemId,
            systemNameKey: system.nameKey,
            dangerRating: system.dangerRating,
            siteId: runtime.siteId,
            siteNameKey: siteDefinition.nameKey,
            objects: Object.values(runtime.objects)
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((object): SiteObjectData => ({
                id: object.id,
                kind: object.kind,
                definitionId: object.definitionId,
                nameKey: object.nameKey,
                position: { ...object.position },
                velocity: { ...object.velocity },
                facingRadians: object.facingRadians,
                radiusKm: object.radiusKm,
                rangeFromPlayerKm: distance(player.position, object.position),
                player: object.id === state.assets.activeShipId,
              })),
          },
    movementOrder: state.navigation.movement === null ? null : deepClone(state.navigation.movement),
    travelStatus: travelProjection(state),
    lastCancellation:
      state.navigation.lastCancellation === null ? null : { ...state.navigation.lastCancellation },
  });
}

export function destinationsProjection(
  state: CampaignState,
  content: ContentRepository,
): DestinationsData {
  const location = state.assets.location;
  const known = new Set(state.navigation.knownDestinationSiteIds);
  const destinations = content.encounters()
    .filter((encounter) => encounter.systemId === location.systemId)
    .map((encounter): DestinationData => {
      const isKnown = known.has(encounter.siteId);
      const available = location.kind === 'station' && isKnown;
      return {
        encounterId: encounter.id,
        siteId: encounter.siteId,
        nameKey: encounter.nameKey,
        descriptionKey: encounter.descriptionKey,
        rewardSummaryKey: encounter.rewardSummaryKey,
        tier: encounter.tier,
        selected: state.navigation.selectedEncounterId === encounter.id,
        current: location.kind === 'site' && location.siteId === encounter.siteId,
        known: isKnown,
        available,
        unavailableReason: available
          ? null
          : isKnown
            ? 'error.ruleViolation.destinationSelectionUnavailable'
            : 'error.ruleViolation.destinationUnknown',
      };
    });
  return deepFreeze({
    revision: state.revision,
    selectedEncounterId: state.navigation.selectedEncounterId,
    destinations,
  });
}

function travelProjection(state: CampaignState): TravelStatusData | null {
  const travel = state.navigation.travel;
  if (travel === null) return null;
  const completionAtMs = travel.boundaryEntryId === null
    ? null
    : state.scheduler.entries.find((entry) => entry.entryId === travel.boundaryEntryId)?.dueAtMs ?? null;
  if (travel.kind === 'warp') {
    return {
      kind: travel.kind,
      phase: travel.phase,
      originSiteId: travel.originSiteId,
      destinationSiteId: travel.destinationSiteId,
      arrivalDistanceKm: travel.arrivalDistanceKm,
      distanceKm: travel.distanceKm,
      completionAtMs,
    };
  }
  return {
    kind: travel.kind,
    phase: travel.phase,
    stationId: travel.stationId,
    completionAtMs,
  };
}

