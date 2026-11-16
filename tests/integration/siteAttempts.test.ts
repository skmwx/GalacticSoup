import { describe, expect, it } from 'vitest';

import { draftOf, envelopeChecksum, loadSave, type CampaignState } from '@engine';
import { playerWrecks, shipFit, stacksIn, warpRefusal, selectDestinationRefusal } from '@engine/domain';
import { destinationsProjection } from '@engine/projections';

import { shippedContent } from '../support/content.ts';
import { sealGolden } from '../support/golden/campaign.ts';
import {
  advanceDraft,
  breakHull,
  command,
  destroyPlayer,
  inSite,
  lossContext,
  newCampaign,
  settleInstant,
  stateOf,
  withCredits,
  buy,
} from '../support/loss.ts';

/**
 * Attempts at the twelve ladder sites (FeatureSpec02 8.2; v0.2 Implementation
 * Plan phase 5, items 4-5; Functional Specification 5.4, 9.11, 18).
 *
 * Every site is selectable and reachable from the start, whatever the player
 * flies; an attempt meets the authored opponents and nothing scaled to the
 * player; a selective kill, a retreat, a save and a return pay each bounty
 * once, leave the earlier wreck and its rolled contents alone and start a
 * fresh attempt; and a fresh attempt never erases the player's own wreck.
 */

const content = shippedContent();
const SEED = 'aa11bb22cc33dd44ee55ff6677889900';
const RANGE_CHECK = 'encounter.borrell.range-check';
const RANGE_CHECK_SITE = content.requireEncounter(RANGE_CHECK as never).siteId;

/** Advances a campaign by simulated seconds at 1x through every installed system. */
function advance(state: CampaignState, seconds: number, until?: (state: CampaignState) => boolean): CampaignState {
  const draft = draftOf(state);
  const context = lossContext(draft, content);
  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    advanceDraft(draft, context, 1_000, content);
    if (until?.(stateOf(draft)) === true) break;
  }
  return stateOf(draft);
}

const atSite = (siteId: string) => (state: CampaignState): boolean =>
  state.assets.location.kind === 'site' && state.assets.location.siteId === siteId;

/** Saves and reopens the campaign through the real load pipeline. */
function reopened(state: CampaignState): CampaignState {
  const result = loadSave(JSON.parse(JSON.stringify(sealGolden(state, content))) as unknown, { content });
  if (!result.ok) throw new Error(`The save did not reopen: ${JSON.stringify(result.error)}`);
  return result.state;
}

/** What an attempt spawns, independent of where the player is or what it flies. */
function roster(state: CampaignState): unknown[] {
  const active = state.encounter.active;
  if (active === null) throw new Error('No attempt is active.');
  const objects = state.navigation.currentSite?.objects ?? {};
  return active.npcs.map((npc) => {
    const position = objects[npc.shipId]!.position;
    return {
      profileId: npc.profileId,
      bountyCredits: npc.bountyCredits,
      lootTableId: npc.lootTableId,
      hullId: state.assets.ships[npc.shipId]!.hullId,
      fit: shipFit(state.assets, npc.shipId).map((fitted) => fitted.moduleId).sort(),
      distanceFromCentreKm: Math.round(Math.hypot(position.x, position.y) * 1_000) / 1_000,
    };
  });
}

function contents(state: CampaignState, wreckId: string): Record<string, number> {
  const wreck = state.encounter.wrecks[wreckId];
  if (wreck === undefined) throw new Error(`No wreck ${wreckId}.`);
  return Object.fromEntries(stacksIn(state.assets, wreck.inventoryId)
    .map((stack) => [stack.definitionId, stack.quantity] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
}

describe('ladder sites from a new campaign', () => {
  it('offers every site for selection and warp from the start, with no hidden gate [V02-AC-09, FUNC-18]', () => {
    const undocked = command(newCampaign(SEED), 'ship.undock', {}).state;
    const destinations = destinationsProjection(undocked, content).destinations;
    expect(destinations).toHaveLength(12);
    for (const entry of destinations) {
      expect(entry.known, entry.encounterId).toBe(true);
      expect(selectDestinationRefusal({ state: undocked, content }, entry.encounterId), entry.encounterId).toBeNull();
      expect(warpRefusal({ state: undocked, content }, entry.siteId), entry.encounterId).toBeNull();
    }
  });

  it('meets the same authored opponents whatever the player flies or owns [V02-AC-09, FUNC-5.1, FUNC-9.10]', () => {
    const starter = newCampaign(SEED);
    // The same campaign a fortune later, flying a cruiser.
    const wealthy = withCredits(starter, 5_000_000);
    const bought = buy(wealthy, 'hull.independent.cruiser', 1).state;
    const cruiser = Object.values(bought.assets.ships)
      .find((ship) => ship.owner === 'player' && ship.hullId === 'hull.independent.cruiser')!;
    const flying = command(bought, 'ship.activate', { shipId: cruiser.id }).state;

    for (const encounter of content.encounters()) {
      const humble = inSite(starter, { siteId: encounter.siteId });
      const strong = inSite(flying, { siteId: encounter.siteId });
      expect(roster(stateOf(strong)), encounter.id).toEqual(roster(stateOf(humble)));
      expect(roster(stateOf(humble)).map((entry) => (entry as { profileId: string }).profileId), encounter.id)
        .toEqual(encounter.spawns.flatMap((spawn) => Array<string>(spawn.count).fill(spawn.npcProfileId)));
    }
  });
});

describe('attempts, retreats and returns', () => {
  it('pays a selective kill once, keeps its rolled wreck through retreat and reopen, and meets a fresh attempt [V02-AC-10, V02-AC-13, FUNC-9.11, FUNC-5.4]', () => {
    const fixture = inSite(newCampaign(SEED), { siteId: RANGE_CHECK_SITE as never });
    const first = fixture.draft.encounter.active!;
    const binder = first.npcs.find((npc) => npc.profileId === 'npc.pirate.binder')!;
    const creditsBefore = fixture.draft.assets.credits;

    breakHull(fixture, binder.shipId);
    settleInstant(fixture);
    const killed = stateOf(fixture);
    expect(killed.assets.credits - creditsBefore).toBe(binder.bountyCredits);
    const wreck = Object.values(killed.encounter.wrecks).find((entry) => entry.owner === 'npc')!;
    const rolled = contents(killed, wreck.id);

    // Retreat with the gunner still alive: the attempt is abandoned, the
    // earned bounty stays earned.
    let state = command(killed, 'navigation.retreat', {}).state;
    state = advance(state, 120, (current) => current.encounter.active === null && current.assets.location.kind === 'site');
    expect(state.encounter.active).toBeNull();
    expect(state.encounter.lastOutcome).toMatchObject({ encounterId: RANGE_CHECK, status: 'abandoned', npcsDestroyed: 1, npcsTotal: 2 });

    // Save and reopen, then return to the same site.
    state = reopened(state);
    const credits = state.assets.credits;
    expect(credits).toBe(killed.assets.credits);
    state = command(state, 'navigation.warp', { destinationSiteId: RANGE_CHECK_SITE, arrivalDistanceKm: 30 }).state;
    state = advance(state, 120, atSite(RANGE_CHECK_SITE));
    expect(atSite(RANGE_CHECK_SITE)(state)).toBe(true);

    const second = state.encounter.active!;
    expect(second.instanceId).not.toBe(first.instanceId);
    expect(second.npcs.map((npc) => npc.profileId)).toEqual(first.npcs.map((npc) => npc.profileId));
    expect(second.npcs.every((npc) => npc.destroyedAtMs === null)).toBe(true);
    expect(second.grantedRewardIds).toEqual([]);
    // Nothing paid twice by reopening or returning, and the earlier wreck holds
    // exactly what it rolled.
    expect(state.assets.credits).toBe(credits);
    expect(contents(state, wreck.id)).toEqual(rolled);
    expect(state.navigation.currentSite?.objects[wreck.id]?.kind).toBe('wreck');
  });

  it('never erases the player\'s own wreck when a fresh attempt starts at that site [V02-AC-12, FUNC-5.4, FUNC-9.12]', () => {
    const fixture = inSite(newCampaign(SEED), { siteId: RANGE_CHECK_SITE as never });
    destroyPlayer(fixture);
    let state = stateOf(fixture);
    const [wreck] = playerWrecks(state);
    expect(wreck?.siteId).toBe(RANGE_CHECK_SITE);
    const held = contents(state, wreck!.id);
    expect(state.assets.activeShipId).not.toBeNull();

    state = command(state, 'ship.undock', {}).state;
    state = command(state, 'navigation.warp', { destinationSiteId: RANGE_CHECK_SITE, arrivalDistanceKm: 30 }).state;
    state = advance(state, 120, atSite(RANGE_CHECK_SITE));
    expect(state.encounter.active?.status).toBe('active');
    expect(playerWrecks(state).map((entry) => entry.id)).toEqual([wreck!.id]);
    expect(contents(state, wreck!.id)).toEqual(held);
    expect(state.navigation.currentSite?.objects[wreck!.id]?.kind).toBe('wreck');
  });

  it('teaches every new site at once to a campaign saved before the ladder was authored [V02-AC-13, FUNC-5.2, TECH-11.4]', () => {
    // A campaign that knew only the phase-4 sites, saved under earlier content
    // of the same release.
    const base = newCampaign(SEED);
    const earlier: CampaignState = {
      ...base,
      navigation: {
        ...base.navigation,
        knownDestinationSiteIds: base.navigation.knownDestinationSiteIds
          .filter((siteId) => ['site.borrell.station', 'site.borrell.verge', 'site.borrell.derelict-lane',
            'site.borrell.outpost-cradle', 'site.borrell.signal-spire'].includes(siteId)),
      },
    };
    const envelope = JSON.parse(JSON.stringify(sealGolden(earlier, content))) as Record<string, unknown>;
    const sameHash = loadSave(envelope, { content });
    expect(sameHash.ok && sameHash.state.navigation.knownDestinationSiteIds).toHaveLength(5);

    // Written against an earlier build of content 0.2.0.
    const { checksum: _checksum, ...fields } = envelope;
    void _checksum;
    const olderBuild = { ...fields, contentHash: 'sha256:earlier-0.2.0-build', contentVersion: '0.2.0+earlier' };
    const resealed = loadSave(reseal(olderBuild), { content });
    expect(resealed.ok).toBe(true);
    if (!resealed.ok) return;
    expect(resealed.contentChanged).toBe(true);
    expect([...resealed.state.navigation.knownDestinationSiteIds].sort())
      .toEqual(content.requireSystem('system.borrell' as never).sites.map((site) => site.id).sort());
    expect(destinationsProjection(resealed.state, content).destinations.every((entry) => entry.known)).toBe(true);
  });
});

/** Seals an edited envelope with this build's checksum. */
function reseal(fields: Record<string, unknown>): unknown {
  return { ...fields, checksum: envelopeChecksum(fields as never) };
}
