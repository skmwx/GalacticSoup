import type { CampaignState, CommandRefusal, NavigationRuleInput } from '@engine/domain';
import {
  distance,
  dockRefusal,
  movementRefusal,
  retreatRefusal,
  selectDestinationRefusal,
  targetOrderRefusal,
  undockRefusal,
  warpRefusal,
} from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type {
  CommandAvailabilityData,
  DestinationData,
  DestinationsData,
  SiteData,
  SiteObjectData,
  TravelStatusData,
} from '@protocol';
import { ruleViolationMessageKey } from '@protocol';
import { deepClone, deepFreeze } from '@shared';

/**
 * Immutable site, object, movement, travel and destination views.
 *
 * Each surface also carries which commands it currently offers and why the
 * others are refused, decided by the same predicates the command handlers ask
 * (Technical Specification 12.3). The interface therefore never re-derives a
 * navigation rule to decide whether to enable a control.
 *
 * @implements TECH-7.3, TECH-10.1, TECH-12.3, FUNC-5.2, FUNC-5.3, FUNC-7.1, FUNC-7.2, FUNC-7.3, FUNC-7.4, FUNC-19.2, FUNC-19.3, MVP-AC-03, MVP-AC-08
 */
export function siteProjection(state: CampaignState, content: ContentRepository): SiteData {
  const rules: NavigationRuleInput = { state, content };
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
                commands: objectCommands(rules, object.id, object.kind),
              })),
          },
    movementOrder: state.navigation.movement === null ? null : deepClone(state.navigation.movement),
    travelStatus: travelProjection(state),
    lastCancellation:
      state.navigation.lastCancellation === null ? null : { ...state.navigation.lastCancellation },
    commands: siteCommands(rules),
    rangePresetsKm: [...content.rules.navigation.rangePresetsKm],
    arrivalDistancesKm: [...content.rules.navigation.arrivalDistancesKm],
  });
}

export function destinationsProjection(
  state: CampaignState,
  content: ContentRepository,
): DestinationsData {
  const rules: NavigationRuleInput = { state, content };
  const location = state.assets.location;
  const known = new Set(state.navigation.knownDestinationSiteIds);
  const destinations = content.encounters()
    .filter((encounter) => encounter.systemId === location.systemId)
    .map((encounter): DestinationData => ({
      encounterId: encounter.id,
      siteId: encounter.siteId,
      nameKey: encounter.nameKey,
      descriptionKey: encounter.descriptionKey,
      rewardSummaryKey: encounter.rewardSummaryKey,
      tier: encounter.tier,
      selected: state.navigation.selectedEncounterId === encounter.id,
      current: location.kind === 'site' && location.siteId === encounter.siteId,
      known: known.has(encounter.siteId),
      commands: [
        availability(
          'navigation.selectDestination',
          selectDestinationRefusal(rules, encounter.id),
        ),
        availability('navigation.warp', warpRefusal(rules, encounter.siteId)),
      ],
    }));
  return deepFreeze({
    revision: state.revision,
    selectedEncounterId: state.navigation.selectedEncounterId,
    destinations,
  });
}

/** The orders that do not name a target object (Functional Specification 7.1). */
function siteCommands(rules: NavigationRuleInput): readonly CommandAvailabilityData[] {
  const movement = movementRefusal(rules);
  return [
    availability('ship.undock', undockRefusal(rules)),
    availability('movement.moveToPoint', movement),
    availability('movement.stop', movement),
    availability('navigation.retreat', retreatRefusal(rules)),
  ];
}

/** The orders that act on one object in the site (Functional Specification 7.2, 7.4). */
function objectCommands(
  rules: NavigationRuleInput,
  objectId: string,
  kind: 'ship' | 'station',
): readonly CommandAvailabilityData[] {
  const target = targetOrderRefusal(rules, objectId);
  return [
    availability('movement.approach', target),
    availability('movement.orbit', target),
    availability('movement.keepRange', target),
    availability('navigation.dock', kind === 'station' ? dockRefusal(rules, objectId) : 'dockUnavailable'),
  ];
}

function availability(command: string, refusal: CommandRefusal): CommandAvailabilityData {
  return {
    command,
    available: refusal === null,
    unavailableReason: refusal === null ? null : ruleViolationMessageKey(refusal),
  };
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
