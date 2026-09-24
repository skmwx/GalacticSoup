import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost, type EngineHost } from '@engine';
import {
  EMPTY_PAYLOAD,
  PROTOCOL_VERSION,
  type AssetsData,
  type CombatData,
  type EncounterData,
  type EngineResponse,
  type InventoryData,
  type SiteData,
  type WreckContentsData,
} from '@protocol';

import { shippedContent } from './content.ts';

/**
 * A sortie to the easiest site, driven headlessly over the engine host.
 *
 * Interface tests need a campaign in a particular moment - arrived at the
 * site, in the middle of a fight, beside a wreck, home again with the loot.
 * Reaching those moments through the interface would take minutes of
 * simulation time, so the steps here drive the same protocol the interface
 * does, and the test then opens the interface on the resulting campaign. The
 * seed is fixed, so the opponent's formation and the wreck's contents are the
 * same every run.
 */

export const SORTIE_SEED = 'bb22cc33dd44ee55ff6677889900aa11';
export const SCOUT = 'encounter.borrell.pirate-scout';
export const SCOUT_SITE = 'site.borrell.verge';

export interface Sortie {
  readonly host: EngineHost;
  ask<TData>(type: string, payload?: unknown): Promise<EngineResponse<TData>>;
  data<TData>(type: string, payload?: unknown): Promise<TData>;
  /** Runs the clock in quarter-second steps until `done` answers true. */
  until(done: () => Promise<boolean>, budgetSeconds?: number): Promise<boolean>;
}

export async function startSortie(seed: string = SORTIE_SEED, displayName = 'Vela'): Promise<Sortie> {
  const content = shippedContent();
  const host = createEngineHost({ content, saves: createMemorySaveStore() });
  let ordinal = 0;

  const ask = async <TData>(type: string, payload: unknown = EMPTY_PAYLOAD): Promise<EngineResponse<TData>> => {
    ordinal += 1;
    return (await host.handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `sortie-${String(ordinal)}`,
      type,
      payload,
    })) as EngineResponse<TData>;
  };
  const data = async <TData>(type: string, payload?: unknown): Promise<TData> => {
    const response = await ask<TData>(type, payload ?? EMPTY_PAYLOAD);
    if (!response.ok) throw new Error(`${type} failed: ${response.error.messageKey}`);
    return response.data;
  };
  const until = async (done: () => Promise<boolean>, budgetSeconds = 600): Promise<boolean> => {
    for (let step = 0; step < Math.ceil((budgetSeconds * 1000) / 250); step += 1) {
      await ask('time.advance', { elapsedRealMs: 250 });
      if (await done()) return true;
    }
    return false;
  };

  await data('campaign.create', { displayName, seed, createdAtRealMs: 1_700_000_000_000 });
  return { host, ask, data, until };
}

/** Moves the starting ammunition from the hangar into the hold. */
export async function loadAmmunition(sortie: Sortie): Promise<void> {
  const content = shippedContent();
  const assets = await sortie.data<AssetsData>('assets.list');
  const ship = assets.ships.find((entry) => entry.active);
  const hangar = await sortie.data<InventoryData>('inventory.hangar', {
    stationId: content.rules.economy.startingStationId,
  });
  for (const stack of hangar.stacks) {
    if (!stack.item.definitionId.startsWith('ammo.')) continue;
    await sortie.data('inventory.transfer', {
      stackId: stack.id,
      destinationInventoryId: ship?.cargoInventoryId ?? '',
      quantity: stack.quantity,
    });
  }
}

/** Chooses the scout site, undocks, warps in and waits for arrival. */
export async function arriveAtScout(sortie: Sortie): Promise<string> {
  await sortie.data('navigation.selectDestination', { encounterId: SCOUT });
  await loadAmmunition(sortie);
  await sortie.data('ship.undock');
  await sortie.data('navigation.warp', { destinationSiteId: SCOUT_SITE, arrivalDistanceKm: 10 });
  await sortie.data('time.set', { paused: false, rate: 1 });
  const arrived = await sortie.until(async () => {
    const site = await sortie.data<SiteData>('navigation.site');
    return site.location.kind === 'site' && site.location.siteId === SCOUT_SITE;
  }, 120);
  if (!arrived) throw new Error('The ship never arrived at the scout site.');
  const encounter = await sortie.data<EncounterData>('encounter.state');
  const opponent = encounter.instance?.npcs[0]?.shipId;
  if (opponent === undefined) throw new Error('The scout site spawned no opponent.');
  return opponent;
}

/** Closes on the opponent and waits for a completed lock. */
export async function lockOpponent(sortie: Sortie, opponentId: string): Promise<void> {
  await sortie.data('movement.orbit', { targetId: opponentId, distanceKm: 1 });
  const locked = await sortie.until(async () => {
    const combat = await sortie.data<CombatData>('combat.state');
    if (combat.locks.length === 0) {
      const lockable = combat.lockCommands.find((entry) => entry.objectId === opponentId);
      if (lockable?.commands.some((command) => command.command === 'targeting.lock' && command.available) === true) {
        await sortie.data('targeting.lock', { targetId: opponentId });
      }
      return false;
    }
    return combat.locks[0]?.status === 'locked';
  }, 120);
  if (!locked) throw new Error('The opponent was never locked.');
}

/**
 * Fires until the encounter completes. A weapon or booster already running is
 * left running, so a test may have started the fight itself.
 */
export async function destroyOpponent(sortie: Sortie, opponentId: string): Promise<void> {
  await sortie.ask('weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponentId });
  await sortie.ask('module.activate', { slotKind: 'system', slotIndex: 0 });
  const completed = await sortie.until(async () => {
    const encounter = await sortie.data<EncounterData>('encounter.state');
    if (encounter.instance?.status === 'completed') return true;
    const combat = await sortie.data<CombatData>('combat.state');
    const weapon = combat.weapons[0];
    if (weapon !== undefined && !weapon.repeating && combat.locks.some((lock) => lock.status === 'locked')) {
      await sortie.ask('weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponentId });
    }
    return false;
  }, 900);
  if (!completed) throw new Error('The encounter never completed.');
}

/** Flies to the wreck until it may be opened, and returns its id. */
export async function reachWreck(sortie: Sortie): Promise<string> {
  const encounter = await sortie.data<EncounterData>('encounter.state');
  const wreck = encounter.wrecks[0];
  if (wreck === undefined) throw new Error('No wreck was left.');
  const site = await sortie.data<SiteData>('navigation.site');
  await sortie.data('movement.approach', { targetId: wreck.wreckId, distanceKm: site.rangePresetsKm[0] ?? 0 });
  const reached = await sortie.until(async () => {
    const contents = await sortie.data<WreckContentsData>('loot.contents', { wreckId: wreck.wreckId });
    return contents.accessible;
  }, 300);
  if (!reached) throw new Error('The wreck was never reached with the closest approach.');
  await sortie.data('movement.stop');
  return wreck.wreckId;
}

/** Retreats to the station site and docks. */
export async function returnHome(sortie: Sortie): Promise<void> {
  await sortie.data('navigation.retreat');
  const home = await sortie.until(async () => {
    const site = await sortie.data<SiteData>('navigation.site');
    return site.site?.objects.some((object) => object.kind === 'station') === true;
  }, 300);
  if (!home) throw new Error('The ship never reached the station site.');
  const station = (await sortie.data<SiteData>('navigation.site')).site?.objects.find(
    (object) => object.kind === 'station',
  );
  await sortie.data('navigation.dock', { stationId: station?.id ?? '' });
  const docked = await sortie.until(
    async () => (await sortie.data<SiteData>('navigation.site')).location.kind === 'station',
    60,
  );
  if (!docked) throw new Error('The ship never docked.');
}

/** Pauses and closes the campaign, leaving a snapshot to resume. */
export async function closeSortie(sortie: Sortie): Promise<void> {
  await sortie.data('time.set', { paused: true, rate: 1 });
  await sortie.data('campaign.close', { savedAtRealMs: 1_700_000_100_000 });
}
