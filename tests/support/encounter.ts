import {
  instantiateSite,
  setMovementOrder,
  type CampaignDraft,
  type EntityId,
  type SiteLocation,
} from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import { INSTALLED_BOUNDARY_RESOLVERS, INSTALLED_CONTINUOUS_SYSTEMS } from '@engine/application';
import { advanceTime, instantiateEncounter } from '@engine/simulation';
import type { EncounterId, SiteId, StationId } from '@shared';

import { testDraft, testSimulation, type TestSimulation } from './campaign.ts';
import { shippedContent } from './content.ts';

/**
 * A loaded combat site with its authored encounter instantiated.
 *
 * Nothing here builds an opponent by hand: the fixture puts the player's ship
 * in the site the way an arriving warp does and then runs the shipped
 * instantiation, so the tests exercise the same spawning, fitting and
 * scheduling the game uses.
 */

export const SCOUT_SITE_ID = 'site.borrell.verge' as SiteId;
export const PATROL_SITE_ID = 'site.borrell.derelict-lane' as SiteId;
export const BASE_SITE_ID = 'site.borrell.outpost-cradle' as SiteId;

export const SCOUT_ENCOUNTER_ID = 'encounter.borrell.pirate-scout' as EncounterId;
export const PATROL_ENCOUNTER_ID = 'encounter.borrell.pirate-patrol' as EncounterId;
export const BASE_ENCOUNTER_ID = 'encounter.borrell.pirate-base' as EncounterId;

export interface EncounterFixture {
  readonly draft: CampaignDraft;
  readonly content: ContentRepository;
  readonly context: TestSimulation;
  readonly playerId: EntityId;
}

export interface EncounterFixtureOptions {
  readonly siteId?: SiteId;
  readonly playerPositionKm?: { readonly x: number; readonly y: number };
  /** Skip instantiation, to test an empty site. */
  readonly spawn?: boolean;
}

export function encounterFixture(options: EncounterFixtureOptions = {}): EncounterFixture {
  const content = shippedContent();
  const draft = testDraft();
  const playerId = draft.assets.activeShipId as EntityId;
  const player = draft.assets.ships[playerId];
  if (player === undefined) throw new Error('The test campaign has no active ship.');

  const station = content.requireStation(content.rules.economy.startingStationId as StationId);
  const siteId = options.siteId ?? SCOUT_SITE_ID;
  const location: SiteLocation = { kind: 'site', systemId: station.systemId, siteId };

  draft.navigation.currentSite = instantiateSite(
    draft,
    content,
    siteId,
    { ...player, location },
    { ...(options.playerPositionKm ?? { x: 0, y: 0 }) },
    0,
  );
  draft.assets.location = location;
  player.location = location;
  setMovementOrder(draft, playerId, { kind: 'stop' });
  draft.assets.version += 1;

  const context = testSimulation(draft, content);
  if (options.spawn !== false) instantiateEncounter(context, siteId);

  return { draft, content, context, playerId };
}

/** Advances the fixture by whole milliseconds of real time at 1x. */
export function advance(fixture: EncounterFixture, elapsedRealMs: number): void {
  fixture.draft.time.paused = false;
  let remaining = elapsedRealMs;
  const cap = fixture.content.rules.time.maxFrameDeltaMs;
  while (remaining > 0) {
    const step = Math.min(remaining, cap);
    advanceTime(fixture.context, step, INSTALLED_BOUNDARY_RESOLVERS, INSTALLED_CONTINUOUS_SYSTEMS);
    remaining -= step;
  }
}

/** The opponent ship ids of the running instance, in spawn order. */
export function opponentIds(fixture: EncounterFixture): readonly string[] {
  return [...(fixture.draft.encounter.active?.npcs ?? [])]
    .sort((a, b) => a.spawnOrdinal - b.spawnOrdinal)
    .map((npc) => npc.shipId);
}

/** The kinds of the events the fixture has published, in order. */
export function eventKinds(fixture: EncounterFixture): readonly string[] {
  return fixture.context.events.map((event) => event.kind);
}
