import type { CampaignState, CommandRefusal, NavigationRuleInput } from '@engine/domain';
import {
  completionCount,
  distance,
  movementOrderOf,
  possibleLoot,
  dockRefusal,
  movementRefusal,
  npcOf,
  objectAttitude,
  playerWrecks,
  retreatRefusal,
  selectBookmarkRefusal,
  selectDestinationRefusal,
  stacksIn,
  targetOrderRefusal,
  undockRefusal,
  warpRefusal,
  warpToBookmarkRefusal,
  wreckAccessRefusal,
} from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type {
  BookmarkDestinationData,
  CommandAvailabilityData,
  DestinationData,
  DestinationLootData,
  DestinationSpawnData,
  DestinationsData,
  SiteData,
  SiteObjectData,
  TravelStatusData,
} from '@protocol';
import { ruleViolationMessageKey } from '@protocol';

import { objectLockCommands } from './combat';
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
  // The site view carries the player's own standing order; an opponent's is
  // its own business (Technical Specification 10.3).
  const playerId = state.assets.activeShipId;
  const playerOrder = playerId === null ? null : movementOrderOf(state, playerId);
  const runtime = state.navigation.currentSite;
  const player = playerId === null ? undefined : runtime?.objects[playerId];
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
                nameKey: displayNameKey(state, content, object.id, object.nameKey),
                attitude: objectAttitude(state, object.id),
                position: { ...object.position },
                velocity: { ...object.velocity },
                facingRadians: object.facingRadians,
                radiusKm: object.radiusKm,
                rangeFromPlayerKm: distance(player.position, object.position),
                player: object.id === state.assets.activeShipId,
                commands: objectCommands(rules, object.id, object.kind),
              })),
          },
    movementOrder: playerOrder === null ? null : deepClone(playerOrder),
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
      spawns: encounter.spawns.map((spawn): DestinationSpawnData => {
        const profile = content.npcProfile(spawn.npcProfileId);
        return {
          npcProfileId: spawn.npcProfileId,
          nameKey: profile?.nameKey ?? '',
          role: profile?.role ?? '',
          count: spawn.count,
          bountyCredits: profile?.bountyCredits ?? 0,
        };
      }),
      totalBountyCredits: encounter.spawns.reduce(
        (total, spawn) => total + (content.npcProfile(spawn.npcProfileId)?.bountyCredits ?? 0) * spawn.count,
        0,
      ),
      possibleLootItemIds: disclosedLoot(content, encounter.spawns),
      possibleLoot: disclosedLoot(content, encounter.spawns).map(
        (itemId): DestinationLootData => ({
          itemId,
          nameKey: content.tradeable(itemId)?.nameKey ?? '',
        }),
      ),
      completionCount: completionCount(state, encounter.id),
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
    selectedBookmarkId: state.navigation.selectedBookmarkId,
    destinations,
    bookmarks: bookmarkDestinations(rules),
  });
}

/**
 * The player's own wrecks as destinations (Functional Specification 5.4, 7.3,
 * 9.12). Each is chosen at the station and warped to from space through the
 * same flow as an encounter, so recovering a wreck needs no system map. What
 * waits at its site is disclosed alongside, because the wreck lies where the
 * ship was lost.
 */
function bookmarkDestinations(rules: NavigationRuleInput): readonly BookmarkDestinationData[] {
  const { state, content } = rules;
  const location = state.assets.location;
  return playerWrecks(state)
    .filter((entry) => entry.systemId === location.systemId)
    .map((entry): BookmarkDestinationData => {
      const siteDefinition = content.system(entry.systemId)?.sites.find((site) => site.id === entry.siteId);
      const encounter = content.encounters().find(
        (candidate) => candidate.siteId === entry.siteId && candidate.systemId === entry.systemId,
      );
      return {
        bookmarkId: entry.id,
        kind: 'playerWreck',
        siteId: entry.siteId,
        siteNameKey: siteDefinition?.nameKey ?? '',
        hullNameKey: entry.nameKey,
        encounterId: encounter?.id ?? null,
        encounterNameKey: encounter?.nameKey ?? null,
        tier: encounter?.tier ?? null,
        createdAtMs: entry.createdAtMs,
        expiresAtMs: entry.expiresAtMs,
        remainingSeconds: Math.max(0, (entry.expiresAtMs - state.time.simulationTimeMs) / 1000),
        itemCount: stacksIn(state.assets, entry.inventoryId).length,
        selected: state.navigation.selectedBookmarkId === entry.id,
        current: location.kind === 'site' && location.siteId === entry.siteId,
        commands: [
          availability('navigation.selectBookmark', selectBookmarkRefusal(rules, entry.id)),
          availability('navigation.warpToBookmark', warpToBookmarkRefusal(rules, entry.id)),
        ],
      };
    });
}

/**
 * Every item the opponents of one encounter can drop, in stable order
 * (MVP Scope 4.2).
 *
 * The summary is disclosed before entry; it does not replace the reward
 * timing and ownership rules of Functional Specification 9.11.
 */
function disclosedLoot(
  content: ContentRepository,
  spawns: readonly { readonly npcProfileId: string }[],
): readonly string[] {
  const items = new Set<string>();
  for (const spawn of spawns) {
    const profile = content.npcProfile(spawn.npcProfileId);
    const table = profile === undefined ? undefined : content.lootTable(profile.lootTableId);
    if (table !== undefined) for (const item of possibleLoot(table)) items.add(item);
  }
  return [...items].sort();
}

/**
 * The name an object is shown by. An opponent's ship carries its hull's name,
 * but the player meets it as the encounter's opponent - the name the roster,
 * the reward summary and the combat log use - so the site shows it by that
 * name too. Everything else is shown by the name it carries.
 */
function displayNameKey(
  state: CampaignState,
  content: ContentRepository,
  objectId: string,
  nameKey: string,
): string {
  const npc = npcOf(state, objectId);
  return npc === null ? nameKey : (content.npcProfile(npc.profileId)?.nameKey ?? nameKey);
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

/**
 * The orders that act on one object in the site
 * (Functional Specification 7.2, 7.4, 9.2).
 *
 * Locking is a combat rule rather than a navigation one, so its availability
 * comes from the combat predicates; it is carried here because the object list
 * is where the player selects a target.
 */
function objectCommands(
  rules: NavigationRuleInput,
  objectId: string,
  kind: 'ship' | 'station' | 'wreck',
): readonly CommandAvailabilityData[] {
  const target = targetOrderRefusal(rules, objectId);
  const wreckRefusal = kind === 'wreck' ? wreckAccessRefusal(rules, objectId) : 'wreckNotFound';
  return [
    availability('movement.approach', target),
    availability('movement.orbit', target),
    availability('movement.keepRange', target),
    availability('navigation.dock', kind === 'station' ? dockRefusal(rules, objectId) : 'dockUnavailable'),
    {
      command: 'loot.take',
      available: wreckRefusal === null,
      unavailableReason: wreckRefusal === null ? null : ruleViolationMessageKey(wreckRefusal),
    },
    ...objectLockCommands(rules.state, rules.content, objectId),
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
      bookmarkId: travel.bookmarkId,
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
