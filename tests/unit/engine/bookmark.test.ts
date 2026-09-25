import { describe, expect, it } from 'vitest';

import {
  distance,
  playerWrecks,
  retreatRefusal,
  stacksIn,
  validateCampaign,
  type CampaignState,
  type WreckState,
} from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import { destinationsProjection, lossReportProjection, siteProjection } from '@engine/projections';
import type { SiteId } from '@shared';

import { TEST_SEED } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';
import { SCOUT_ENCOUNTER_ID, SCOUT_SITE_ID } from '../../support/encounter.ts';
import {
  ANNEX,
  ANNEX_SITE_ID,
  breakHull,
  command,
  destroyPlayer,
  fixtureOf,
  HARBOUR,
  inSite,
  newCampaign,
  reasonOf,
  refusal,
  settleInstant,
  stateOf,
  twoStationContent,
  withCredits,
} from '../../support/loss.ts';

/**
 * The player's own wreck as a destination (Functional Specification 5.4,
 * 7.1, 7.3, 9.12).
 *
 * The MVP has no system map, so the wreck is reached through the same
 * station choice and warp control as an encounter: chosen at the station,
 * warped to from space, arriving the chosen distance short of the wreck
 * itself. These cases drive the real commands over a campaign that has just
 * lost a ship.
 */

const content = shippedContent();
const HARBOUR_SITE_ID = content.requireStation(HARBOUR).siteId as SiteId;

/** A campaign whose ship was just lost at the scout site, with time running. */
function lostAtScout(credits?: number, source: ContentRepository = content): CampaignState {
  let state = newCampaign(TEST_SEED, source);
  if (credits !== undefined) state = withCredits(state, credits);
  const fixture = inSite(state, { content: source });
  destroyPlayer(fixture);
  return command(stateOf(fixture), 'time.set', { paused: false, rate: 1 }, source).state;
}

function wreckOf(state: CampaignState): WreckState {
  const wreck = playerWrecks(state)[0];
  if (wreck === undefined) throw new Error('No player wreck.');
  return wreck;
}

function until(
  state: CampaignState,
  done: (current: CampaignState) => boolean,
  source: ContentRepository = content,
  limitMs = 120_000,
): CampaignState {
  let current = state;
  for (let elapsed = 0; elapsed < limitMs; elapsed += 250) {
    if (done(current)) return current;
    current = command(current, 'time.advance', { elapsedRealMs: 250 }, source).state;
  }
  if (!done(current)) throw new Error('The campaign never reached the expected state.');
  return current;
}

function playerPosition(state: CampaignState) {
  const id = state.assets.activeShipId;
  const object = id === null ? undefined : state.navigation.currentSite?.objects[id];
  if (object === undefined) throw new Error('The player is not in a site.');
  return object.position;
}

/** The shipped content with a player wreck that lasts only a few seconds. */
function shortLived(seconds: number): ContentRepository {
  return {
    ...content,
    rules: { ...content.rules, combat: { ...content.rules.combat, playerWreckLifetimeSeconds: seconds } },
  };
}

describe('choosing the wreck at the station', () => {
  it('replaces a chosen encounter, and an encounter replaces it [FUNC-5.4, FUNC-7.1, FUNC-9.12]', () => {
    let state = lostAtScout();
    const wreck = wreckOf(state);

    state = command(state, 'navigation.selectDestination', { encounterId: SCOUT_ENCOUNTER_ID }).state;
    expect(state.navigation.selectedEncounterId).toBe(SCOUT_ENCOUNTER_ID);

    const selected = command(state, 'navigation.selectBookmark', { bookmarkId: wreck.id });
    state = selected.state;
    expect(state.navigation.selectedBookmarkId).toBe(wreck.id);
    expect(state.navigation.selectedEncounterId).toBeNull();
    expect(selected.data.events.find((event) => event.kind === 'navigation.bookmarkSelected')?.params)
      .toEqual({ bookmarkId: wreck.id, siteId: SCOUT_SITE_ID });

    // Choosing it again changes nothing.
    const again = command(state, 'navigation.selectBookmark', { bookmarkId: wreck.id });
    expect(again.data.committed).toBe(false);

    const destinations = destinationsProjection(state, content);
    expect(destinations.selectedBookmarkId).toBe(wreck.id);
    expect(destinations.bookmarks).toHaveLength(1);
    expect(destinations.bookmarks[0]).toMatchObject({
      bookmarkId: wreck.id,
      kind: 'playerWreck',
      siteId: SCOUT_SITE_ID,
      encounterId: SCOUT_ENCOUNTER_ID,
      selected: true,
      current: false,
      remainingSeconds: 7_200,
      itemCount: stacksIn(state.assets, wreck.inventoryId).length,
    });
    const commands = Object.fromEntries(destinations.bookmarks[0]!.commands.map((entry) => [entry.command, entry]));
    expect(commands['navigation.selectBookmark']?.available).toBe(true);
    expect(commands['navigation.warpToBookmark']?.available).toBe(false);
    expect(lossReportProjection(state, content).report?.wreck.selected).toBe(true);

    state = command(state, 'navigation.selectDestination', { encounterId: SCOUT_ENCOUNTER_ID }).state;
    expect(state.navigation.selectedEncounterId).toBe(SCOUT_ENCOUNTER_ID);
    expect(state.navigation.selectedBookmarkId).toBeNull();
    expect(validateCampaign(state, content)).toEqual([]);
  });

  it('refuses an unknown id, an opponent\'s wreck, and a choice made in space [FUNC-7.1, FUNC-22.10]', () => {
    // A pilot who won and died in the same instant leaves both kinds of wreck.
    const fixture = inSite(withCredits(newCampaign(), 1_000));
    const opponent = fixture.draft.encounter.active?.npcs[0]?.shipId ?? '';
    breakHull(fixture, opponent);
    breakHull(fixture);
    settleInstant(fixture);
    const state = command(stateOf(fixture), 'time.set', { paused: false, rate: 1 }).state;
    const npcWreck = Object.values(state.encounter.wrecks).find((wreck) => wreck.owner === 'npc');
    expect(npcWreck).toBeDefined();

    expect(reasonOf(refusal(state, 'navigation.selectBookmark', { bookmarkId: 'no-such-wreck' }))).toBe('bookmarkUnknown');
    expect(reasonOf(refusal(state, 'navigation.selectBookmark', { bookmarkId: npcWreck?.id ?? '' }))).toBe('bookmarkUnknown');
    expect(destinationsProjection(state, content).bookmarks.map((entry) => entry.bookmarkId)).toEqual([wreckOf(state).id]);

    const inSpace = command(state, 'ship.undock', {}).state;
    expect(reasonOf(refusal(inSpace, 'navigation.selectBookmark', { bookmarkId: wreckOf(state).id })))
      .toBe('destinationSelectionUnavailable');
  });
});

describe('warping to the wreck', () => {
  it('refuses outside a site, an unknown or foreign bookmark, the current site and an unknown distance [FUNC-7.3, FUNC-22.10]', () => {
    const fixture = inSite(withCredits(newCampaign(), 1_000));
    const opponent = fixture.draft.encounter.active?.npcs[0]?.shipId ?? '';
    breakHull(fixture, opponent);
    breakHull(fixture);
    settleInstant(fixture);
    const docked = command(stateOf(fixture), 'time.set', { paused: false, rate: 1 }).state;
    const wreck = wreckOf(docked);
    const npcWreck = Object.values(docked.encounter.wrecks).find((entry) => entry.owner === 'npc')!;

    expect(reasonOf(refusal(docked, 'navigation.warpToBookmark', { bookmarkId: wreck.id, arrivalDistanceKm: 0 })))
      .toBe('warpUnavailable');

    const space = command(docked, 'ship.undock', {}).state;
    expect(reasonOf(refusal(space, 'navigation.warpToBookmark', { bookmarkId: 'no-such-wreck', arrivalDistanceKm: 0 })))
      .toBe('bookmarkUnknown');
    expect(reasonOf(refusal(space, 'navigation.warpToBookmark', { bookmarkId: npcWreck.id, arrivalDistanceKm: 0 })))
      .toBe('bookmarkUnknown');
    expect(reasonOf(refusal(space, 'navigation.warpToBookmark', { bookmarkId: wreck.id, arrivalDistanceKm: 3 })))
      .toBe('invalidArrivalDistance');

    // At the wreck's own site it is reached by flying, not warping.
    const there = inSite(space, { siteId: SCOUT_SITE_ID, spawn: false });
    expect(reasonOf(refusal(stateOf(there), 'navigation.warpToBookmark', { bookmarkId: wreck.id, arrivalDistanceKm: 0 })))
      .toBe('destinationCurrent');
    const bookmark = destinationsProjection(stateOf(there), content).bookmarks[0];
    expect(bookmark?.current).toBe(true);
  });

  it('arrives on the wreck at 0 km, close enough to take what survived [FUNC-7.3, FUNC-9.11, FUNC-9.12, MVP-AC-08]', () => {
    let state = lostAtScout(1_000);
    const wreck = wreckOf(state);
    const survivors = stacksIn(state.assets, wreck.inventoryId);
    expect(survivors.length).toBeGreaterThan(0);
    state = command(state, 'navigation.selectBookmark', { bookmarkId: wreck.id }).state;
    state = command(state, 'ship.undock', {}).state;
    const warp = command(state, 'navigation.warpToBookmark', { bookmarkId: wreck.id, arrivalDistanceKm: 0 });
    state = warp.state;
    expect(state.navigation.travel).toMatchObject({
      kind: 'warp',
      destinationSiteId: SCOUT_SITE_ID,
      bookmarkId: wreck.id,
      anchor: wreck.position,
      arrivalDistanceKm: 0,
    });
    expect(siteProjection(state, content).travelStatus).toMatchObject({ bookmarkId: wreck.id });

    state = until(state, (current) =>
      current.assets.location.kind === 'site' && current.assets.location.siteId === SCOUT_SITE_ID);

    expect(distance(playerPosition(state), wreck.position)).toBeLessThanOrEqual(content.rules.combat.wreckAccessRangeKm);
    expect(state.navigation.currentSite?.objects[wreck.id]?.kind).toBe('wreck');
    // The site's encounter is there again: the wreck lies where the ship was lost.
    expect(state.encounter.active?.encounterId).toBe(SCOUT_ENCOUNTER_ID);

    const cargoId = state.assets.ships[state.assets.activeShipId ?? '']?.cargoInventoryId ?? '';
    for (const stack of survivors) {
      state = command(state, 'loot.take', { wreckId: wreck.id, stackId: stack.id, quantity: stack.quantity }).state;
    }
    const taken = stacksIn(state.assets, cargoId).map((stack) => [stack.definitionId, stack.quantity, stack.recoveryGrant]);
    expect(taken).toEqual(survivors.map((stack) => [stack.definitionId, stack.quantity, false]));
    expect(stacksIn(state.assets, wreck.inventoryId)).toEqual([]);
    expect(validateCampaign(state, content)).toEqual([]);
  });

  it('arrives the chosen distance short of the wreck, not of the site [FUNC-7.3]', () => {
    // The wreck lies off the site's origin, so the two cannot be confused.
    const fixture = inSite(withCredits(newCampaign(), 1_000), { playerPositionKm: { x: 12, y: -7 }, spawn: false });
    destroyPlayer(fixture);
    let state = command(stateOf(fixture), 'time.set', { paused: false, rate: 1 }).state;
    const offset = wreckOf(state);
    expect(offset.position).toEqual({ x: 12, y: -7 });

    state = command(state, 'ship.undock', {}).state;
    state = command(state, 'navigation.warpToBookmark', { bookmarkId: offset.id, arrivalDistanceKm: 10 }).state;
    state = until(state, (current) => current.assets.location.kind === 'site' && current.assets.location.siteId === SCOUT_SITE_ID);

    expect(distance(playerPosition(state), offset.position)).toBeCloseTo(10, 6);
    expect(distance(playerPosition(state), { x: 0, y: 0 })).not.toBeCloseTo(10, 1);
  });
});

describe('expiry', () => {
  it('drops the selection and the bookmark when the wreck expires [FUNC-5.4, FUNC-9.12]', () => {
    const source = shortLived(3);
    let state = lostAtScout(undefined, source);
    const wreck = wreckOf(state);
    state = command(state, 'navigation.selectBookmark', { bookmarkId: wreck.id }, source).state;

    let expired = false;
    for (let elapsed = 0; elapsed < 4_000; elapsed += 250) {
      const step = command(state, 'time.advance', { elapsedRealMs: 250 }, source);
      state = step.state;
      expired ||= step.data.events.some((event) => event.kind === 'encounter.wreckExpired');
    }

    expect(expired).toBe(true);
    expect(state.encounter.wrecks[wreck.id]).toBeUndefined();
    expect(state.assets.inventories[wreck.inventoryId]).toBeUndefined();
    expect(state.navigation.selectedBookmarkId).toBeNull();
    expect(destinationsProjection(state, source).bookmarks).toEqual([]);
    expect(lossReportProjection(state, source).report?.wreck).toMatchObject({ present: false, itemCount: 0, selected: false });
    expect(reasonOf(refusal(state, 'navigation.selectBookmark', { bookmarkId: wreck.id }, source))).toBe('bookmarkUnknown');
    expect(validateCampaign(state, source)).toEqual([]);
  });

  it('lets a warp already on its way keep the point it was aimed at [FUNC-5.4, FUNC-7.3]', () => {
    const source = shortLived(2);
    const fixture = inSite(withCredits(newCampaign(TEST_SEED, source), 1_000), {
      content: source, playerPositionKm: { x: 12, y: -7 }, spawn: false,
    });
    destroyPlayer(fixture);
    let state = command(stateOf(fixture), 'time.set', { paused: false, rate: 1 }, source).state;
    const wreck = wreckOf(state);
    state = command(state, 'ship.undock', {}, source).state;
    state = command(state, 'navigation.warpToBookmark', { bookmarkId: wreck.id, arrivalDistanceKm: 10 }, source).state;

    state = until(state, (current) => current.encounter.wrecks[wreck.id] === undefined, source);
    const travel = state.navigation.travel;
    expect(travel?.kind).toBe('warp');
    if (travel?.kind !== 'warp') return;
    expect(travel.bookmarkId).toBeNull();
    expect(travel.anchor).toEqual(wreck.position);

    state = until(state, (current) => current.assets.location.kind === 'site' &&
      current.assets.location.siteId === SCOUT_SITE_ID, source);
    expect(distance(playerPosition(state), wreck.position)).toBeCloseTo(10, 6);
    expect(state.navigation.currentSite?.objects[wreck.id]).toBeUndefined();
    expect(validateCampaign(state, source)).toEqual([]);
  });
});

describe('the most recently docked station', () => {
  it('is set by docking, and is where retreat heads and a lost pilot is recovered [FUNC-9.11, FUNC-9.12, TECH-8.1]', () => {
    const source = twoStationContent();
    let state = command(newCampaign(TEST_SEED, source), 'time.set', { paused: false, rate: 1 }, source).state;
    expect(state.assets.lastDockedStationId).toBe(HARBOUR);

    // Fly to the second station and dock there.
    state = command(state, 'ship.undock', {}, source).state;
    state = command(state, 'navigation.warp', { destinationSiteId: ANNEX_SITE_ID, arrivalDistanceKm: 0 }, source).state;
    state = until(state, (current) => current.assets.location.kind === 'site' &&
      current.assets.location.siteId === ANNEX_SITE_ID, source);
    // Not docked here yet: a retreat would still head for the harbour.
    expect(command(state, 'navigation.retreat', {}, source).state.navigation.travel)
      .toMatchObject({ kind: 'warp', destinationSiteId: HARBOUR_SITE_ID });
    state = command(state, 'navigation.dock', { stationId: ANNEX }, source).state;
    state = until(state, (current) => current.assets.location.kind === 'station', source);
    expect(state.assets.location).toMatchObject({ kind: 'station', stationId: ANNEX });
    expect(state.assets.lastDockedStationId).toBe(ANNEX);

    // Now the annex's own site is home: there is nowhere to retreat to from it.
    state = command(state, 'ship.undock', {}, source).state;
    expect(state.assets.location).toMatchObject({ kind: 'site', siteId: ANNEX_SITE_ID });
    expect(retreatRefusal({ state, content: source })).toBe('retreatUnavailable');

    // Retreat from a combat site heads for the annex, not the starting station.
    state = command(state, 'navigation.warp', { destinationSiteId: SCOUT_SITE_ID, arrivalDistanceKm: 50 }, source).state;
    state = until(state, (current) => current.assets.location.kind === 'site' &&
      current.assets.location.siteId === SCOUT_SITE_ID, source);
    const retreating = command(state, 'navigation.retreat', {}, source).state;
    expect(retreating.navigation.travel).toMatchObject({ kind: 'warp', destinationSiteId: ANNEX_SITE_ID });
    expect(retreating.navigation.travel).not.toMatchObject({ destinationSiteId: HARBOUR_SITE_ID });

    // A pilot lost here is recovered at the annex.
    const lowOnCredits = withCredits(state, 1_000);
    const fixture = fixtureOf(lowOnCredits, source);
    destroyPlayer(fixture);
    const recovered = stateOf(fixture);
    expect(recovered.assets.location).toMatchObject({ kind: 'station', stationId: ANNEX });
    expect(recovered.recovery.lastLoss?.recoveryStationId).toBe(ANNEX);
    const grantedShip = recovered.assets.ships[recovered.assets.activeShipId ?? ''];
    expect(grantedShip?.location).toMatchObject({ kind: 'station', stationId: ANNEX });
    expect(validateCampaign(recovered, source)).toEqual([]);
  });
});
