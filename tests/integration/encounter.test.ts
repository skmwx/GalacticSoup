import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost, type EngineHost } from '@engine';
import {
  EMPTY_PAYLOAD,
  PROTOCOL_VERSION,
  type AssetsData,
  type CombatData,
  type DestinationsData,
  type EncounterData,
  type EngineResponse,
  type InventoryData,
  type SiteData,
  type WalletData,
  type WreckContentsData,
} from '@protocol';

import { shippedContent } from '../support/content.ts';

/**
 * The encounter loop over the engine host
 * (Functional Specification 9.10-9.11, 18; MVP Scope 9.1).
 *
 * This is the phase's exit gate: from the starting campaign, the player
 * chooses the easiest site, undocks, warps in, fights the authored opponent
 * with the ordinary commands, collects its bounty and its wreck, and returns
 * to the station richer than they left it. Nothing here reaches past the
 * protocol.
 */

const content = shippedContent();
const SEED = 'bb22cc33dd44ee55ff6677889900aa11';
const SCOUT = 'encounter.borrell.pirate-scout';

let requestOrdinal = 0;

async function ask<TData>(
  host: EngineHost,
  type: string,
  payload: unknown = EMPTY_PAYLOAD,
): Promise<EngineResponse<TData>> {
  requestOrdinal += 1;
  return (await host.handle({
    protocolVersion: PROTOCOL_VERSION,
    requestId: `req-${String(requestOrdinal)}`,
    type,
    payload,
  })) as EngineResponse<TData>;
}

async function data<TData>(host: EngineHost, type: string, payload?: unknown): Promise<TData> {
  const response = await ask<TData>(host, type, payload ?? EMPTY_PAYLOAD);
  if (!response.ok) throw new Error(`${type} failed: ${response.error.messageKey}`);
  return response.data;
}

async function openCampaign(): Promise<EngineHost> {
  const host = createEngineHost({ content, saves: createMemorySaveStore() });
  await ask(host, 'campaign.create', {
    displayName: 'Vela',
    seed: SEED,
    createdAtRealMs: 1_700_000_000_000,
  });
  await ask(host, 'time.set', { paused: false, rate: 1 });
  return host;
}

/** Runs the clock until `done` answers true, or the budget is exhausted. */
async function until(
  host: EngineHost,
  done: () => Promise<boolean>,
  budgetSeconds = 600,
): Promise<boolean> {
  const steps = Math.ceil((budgetSeconds * 1000) / 250);
  for (let step = 0; step < steps; step += 1) {
    await ask(host, 'time.advance', { elapsedRealMs: 250 });
    if (await done()) return true;
  }
  return false;
}

/** Moves the starting ammunition from the station hangar into the hold. */
async function loadCargoAmmunition(host: EngineHost): Promise<void> {
  const assets = await data<AssetsData>(host, 'assets.list');
  const ship = assets.ships.find((entry) => entry.active);
  const hangar = await data<InventoryData>(host, 'inventory.hangar', {
    stationId: content.rules.economy.startingStationId,
  });
  for (const stack of hangar.stacks) {
    if (!stack.item.definitionId.startsWith('ammo.')) continue;
    const moved = await ask(host, 'inventory.transfer', {
      stackId: stack.id,
      destinationInventoryId: ship?.cargoInventoryId ?? '',
      quantity: stack.quantity,
    });
    expect(moved.ok).toBe(true);
  }
}

describe('the authored encounter loop', () => {
  it('discloses each site\'s opponents, bounty and possible loot before entry [MVP-AC-05, MVP-AC-09, FUNC-18]', async () => {
    const host = await openCampaign();
    const destinations = await data<DestinationsData>(host, 'navigation.destinations');

    expect([...destinations.destinations].map((entry) => entry.tier).sort()).toEqual([1, 2, 3]);
    const scout = destinations.destinations.find((entry) => entry.encounterId === SCOUT);
    expect(scout?.spawns).toEqual([
      {
        npcProfileId: 'npc.pirate.scout',
        nameKey: 'content.npc.pirate.scout.name',
        role: 'skirmisher',
        count: 1,
        bountyCredits: 3000,
      },
    ]);
    expect(scout?.totalBountyCredits).toBe(3000);
    expect(scout?.possibleLootItemIds).toEqual([
      'ammo.projectile.small.fusion',
      'item.salvage.alloy',
    ]);
    // Every site stays visible and repeatable; tier is guidance, not a gate.
    expect(destinations.destinations.every((entry) => entry.completionCount === 0)).toBe(true);
    expect(destinations.destinations.every((entry) => entry.known)).toBe(true);

    const harder = destinations.destinations.find((entry) => entry.tier === 3);
    expect(harder?.totalBountyCredits).toBeGreaterThan(scout?.totalBountyCredits ?? 0);
  });

  it('completes the easiest site from the starter state and returns with rewards [MVP-AC-05, MVP-AC-06, MVP-AC-09, FUNC-9.10, FUNC-9.11]', async () => {
    const host = await openCampaign();
    const startingCredits = (await data<WalletData>(host, 'wallet.get')).credits;

    await ask(host, 'navigation.selectDestination', { encounterId: SCOUT });
    // Resupply before undocking: the granted rounds start in the station
    // hangar, and a weapon reloads from cargo (Functional Specification 9.4).
    await loadCargoAmmunition(host);
    await ask(host, 'ship.undock');
    const scoutSiteId = content.requireEncounter(SCOUT as never).siteId;
    await ask(host, 'navigation.warp', { destinationSiteId: scoutSiteId, arrivalDistanceKm: 10 });

    const arrived = await until(host, async () => {
      const site = await data<SiteData>(host, 'navigation.site');
      return site.location.kind === 'site' && site.location.siteId === scoutSiteId;
    }, 120);
    expect(arrived).toBe(true);

    // The authored encounter instantiated with the site.
    const encounter = await data<EncounterData>(host, 'encounter.state');
    expect(encounter.instance?.encounterId).toBe(SCOUT);
    expect(encounter.instance?.status).toBe('active');
    expect(encounter.instance?.objective).toEqual({
      kind: 'destroyGroup',
      destroyed: 0,
      required: 1,
      complete: false,
    });
    const opponentId = encounter.instance?.npcs[0]?.shipId;
    if (opponentId === undefined) throw new Error('The encounter spawned no opponent.');
    expect(encounter.instance?.npcs[0]?.role).toBe('skirmisher');

    // Close, lock and fire with the ordinary commands.
    await ask(host, 'movement.orbit', { targetId: opponentId, distanceKm: 1 });
    const locked = await until(host, async () => {
      const combat = await data<CombatData>(host, 'combat.state');
      if (combat.locks.length === 0) {
        const lockable = combat.lockCommands.find((entry) => entry.objectId === opponentId);
        if (lockable?.commands.some((command) => command.command === 'targeting.lock' && command.available) === true) {
          await ask(host, 'targeting.lock', { targetId: opponentId });
        }
        return false;
      }
      return combat.locks[0]?.status === 'locked';
    }, 120);
    expect(locked).toBe(true);

    await ask(host, 'weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponentId });
    await ask(host, 'module.activate', { slotKind: 'system', slotIndex: 0 });

    const completed = await until(host, async () => {
      const current = await data<EncounterData>(host, 'encounter.state');
      if (current.instance?.status === 'completed') return true;
      // Keep the magazine fed and the guns on the target.
      const combat = await data<CombatData>(host, 'combat.state');
      const weapon = combat.weapons[0];
      if (weapon !== undefined && !weapon.repeating && combat.locks.length > 0) {
        await ask(host, 'weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponentId });
      }
      return false;
    }, 900);
    expect(completed).toBe(true);

    const resolved = await data<EncounterData>(host, 'encounter.state');
    expect(resolved.instance?.objective.complete).toBe(true);
    expect(resolved.instance?.bountyCreditsPaid).toBe(3000);
    expect((await data<WalletData>(host, 'wallet.get')).credits).toBe(startingCredits + 3000);

    // The opponent left a wreck that persists in the site.
    expect(resolved.wrecks).toHaveLength(1);
    const wreck = resolved.wrecks[0];
    if (wreck === undefined) throw new Error('No wreck.');
    expect(wreck.hullId).toBe('hull.pirate.scout');
    expect(wreck.remainingSeconds).toBeGreaterThan(0);

    // Reach it, then take everything the hold will accept.
    await ask(host, 'movement.approach', { targetId: wreck.wreckId, distanceKm: 0 });
    const reached = await until(host, async () => {
      const contents = await data<WreckContentsData>(host, 'loot.contents', { wreckId: wreck.wreckId });
      return contents.accessible;
    }, 300);
    expect(reached).toBe(true);

    const contents = await data<WreckContentsData>(host, 'loot.contents', { wreckId: wreck.wreckId });
    for (const stack of contents.stacks) {
      const allowed = contents.maximumQuantities.find((entry) => entry.stackId === stack.id);
      if ((allowed?.maximumQuantity ?? 0) > 0) {
        const taken = await ask(host, 'loot.take', {
          wreckId: wreck.wreckId,
          stackId: stack.id,
          quantity: allowed?.maximumQuantity ?? 0,
        });
        expect(taken.ok).toBe(true);
      }
    }

    // Retreat and dock. The rewards come home with the ship.
    await ask(host, 'navigation.retreat');
    const home = await until(host, async () => {
      const site = await data<SiteData>(host, 'navigation.site');
      return site.site?.objects.some((object) => object.kind === 'station') === true;
    }, 300);
    expect(home).toBe(true);

    const station = (await data<SiteData>(host, 'navigation.site')).site?.objects.find(
      (object) => object.kind === 'station',
    );
    await ask(host, 'navigation.dock', { stationId: station?.id ?? '' });
    const docked = await until(host, async () =>
      (await data<SiteData>(host, 'navigation.site')).location.kind === 'station', 60);
    expect(docked).toBe(true);

    const shipId = (await data<SiteData>(host, 'navigation.site')).location;
    void shipId;
    const finalEncounter = await data<EncounterData>(host, 'encounter.state');
    expect(finalEncounter.instance).toBeNull();
    expect(finalEncounter.lastOutcome).toMatchObject({
      encounterId: SCOUT,
      status: 'completed',
      bountyCreditsPaid: 3000,
      npcsDestroyed: 1,
      npcsTotal: 1,
    });

    // The site stays repeatable and now records the completion.
    const after = await data<DestinationsData>(host, 'navigation.destinations');
    const scoutAgain = after.destinations.find((entry) => entry.encounterId === SCOUT);
    expect(scoutAgain?.completionCount).toBe(1);
    expect(scoutAgain?.commands.find((command) => command.command === 'navigation.selectDestination')?.available)
      .toBe(true);
  }, 120_000);

  it('abandons the instance on retreat and instantiates a fresh one on return [MVP-AC-08, MVP-AC-09]', async () => {
    const host = await openCampaign();
    const scoutSiteId = content.requireEncounter(SCOUT as never).siteId;

    await ask(host, 'ship.undock');
    await ask(host, 'navigation.warp', { destinationSiteId: scoutSiteId, arrivalDistanceKm: 30 });
    await until(host, async () => {
      const site = await data<SiteData>(host, 'navigation.site');
      return site.location.kind === 'site' && site.location.siteId === scoutSiteId;
    }, 120);

    const first = await data<EncounterData>(host, 'encounter.state');
    const firstInstance = first.instance?.instanceId;
    expect(firstInstance).toBeDefined();

    await ask(host, 'navigation.retreat');
    await until(host, async () => {
      const site = await data<SiteData>(host, 'navigation.site');
      return site.site?.objects.some((object) => object.kind === 'station') === true;
    }, 300);

    const abandoned = await data<EncounterData>(host, 'encounter.state');
    expect(abandoned.instance).toBeNull();
    expect(abandoned.lastOutcome?.status).toBe('abandoned');
    expect(abandoned.lastOutcome?.npcsDestroyed).toBe(0);

    await ask(host, 'navigation.warp', { destinationSiteId: scoutSiteId, arrivalDistanceKm: 30 });
    await until(host, async () => {
      const site = await data<SiteData>(host, 'navigation.site');
      return site.location.kind === 'site' && site.location.siteId === scoutSiteId;
    }, 120);

    const second = await data<EncounterData>(host, 'encounter.state');
    expect(second.instance?.instanceId).not.toBe(firstInstance);
    expect(second.instance?.status).toBe('active');
    expect(second.instance?.objective.destroyed).toBe(0);
  }, 60_000);

  it('refuses loot commands the rules do not permit, with a reason [FUNC-9.11, FUNC-22.10]', async () => {
    const host = await openCampaign();

    const docked = await ask(host, 'loot.take', {
      wreckId: 'c000000000000000000000000-e9',
      stackId: 'c000000000000000000000000-e8',
      quantity: 1,
    });
    expect(docked.ok).toBe(false);
    expect(!docked.ok && docked.error.messageKey).toBe('error.ruleViolation.lootUnavailable');

    await ask(host, 'ship.undock');
    const missing = await ask(host, 'loot.take', {
      wreckId: 'c000000000000000000000000-e9',
      stackId: 'c000000000000000000000000-e8',
      quantity: 1,
    });
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error.messageKey).toBe('error.ruleViolation.wreckNotFound');

    const contents = await ask(host, 'loot.contents', { wreckId: 'c000000000000000000000000-e9' });
    expect(contents.ok).toBe(false);
  });

  it('answers the encounter view while docked [TECH-7.3]', async () => {
    const host = await openCampaign();
    const view = await data<EncounterData>(host, 'encounter.state');

    expect(view.instance).toBeNull();
    expect(view.wrecks).toEqual([]);
    expect(view.lastOutcome).toBeNull();
  });

  it('keeps the player\'s own ships out of the asset list when opponents exist [FUNC-6.1]', async () => {
    const host = await openCampaign();
    const scoutSiteId = content.requireEncounter(SCOUT as never).siteId;
    await ask(host, 'ship.undock');
    await ask(host, 'navigation.warp', { destinationSiteId: scoutSiteId, arrivalDistanceKm: 30 });
    await until(host, async () => {
      const site = await data<SiteData>(host, 'navigation.site');
      return site.location.kind === 'site' && site.location.siteId === scoutSiteId;
    }, 120);

    const assets = await data<{ ships: readonly { owner: string }[] }>(host, 'assets.list');
    expect(assets.ships).toHaveLength(1);
    expect(assets.ships.every((ship) => ship.owner === 'player')).toBe(true);

    // The opponent's hold is not a place the player can reach.
    const cargo = await data<InventoryData>(host, 'inventory.cargo', {
      shipId: (await data<EncounterData>(host, 'encounter.state')).instance?.npcs[0]?.shipId ?? '',
    });
    expect(cargo.accessible).toBe(false);
  });
});
