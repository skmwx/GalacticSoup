import type { ContentRepository } from '@engine';
import type {
  AssetsData,
  CombatData,
  DestinationsData,
  DomainEventData,
  EncounterData,
  InventoryData,
  MarketTransactionPreviewData,
  RepairPreviewData,
  ResupplyPreviewData,
  ShipData,
  SiteData,
  WreckContentsData,
} from '@protocol';

import { assembleFit, type AssembledFit } from './assemble.ts';
import { fixtureFit, type FixtureFit, type FixtureScenario } from './fixtures.ts';
import { fightEncounter, type FightStatus } from './pilot.ts';
import { openSession, type ScenarioSession } from './session.ts';

/**
 * A progression scenario, run headlessly (MVP Implementation Plan phase 16;
 * Technical Specification 16).
 *
 * One scenario is a representative fit, an encounter, the tactics a competent
 * pilot would use and the seeds to try. Each seed is a campaign: the fit is
 * bought and assembled at the station, the campaign is saved and resumed, and
 * then the pilot flies the configured number of consecutive sorties - choose
 * the site, undock, warp in, fight, loot, return, dock, repair and resupply -
 * through the protocol alone.
 *
 * The record a sortie returns is the diagnosis a failure needs: which opponents
 * died when, how often each side hit, how much each opponent took off which
 * layer, what the repairers put back and what the ship ended with. A failed
 * progression claim therefore names the data that caused it instead of ending
 * in a timeout.
 */

/** Simulated seconds a fight may last before the scenario gives up on it. */
export const FIGHT_BUDGET_SECONDS = 900;

export interface OpponentRecord {
  readonly shipId: string;
  readonly profileId: string;
  /** Seconds from arrival, or `null` when it survived. */
  readonly destroyedAtSeconds: number | null;
  readonly shotsAtPlayer: number;
  readonly hitsOnPlayer: number;
  /** Damage it applied to the player after resistances, by layer. */
  readonly damageToPlayer: Readonly<Record<'shield' | 'armor' | 'hull', number>>;
  /** Shots the player fired at it, and how many hit. */
  readonly shotsTaken: number;
  readonly hitsTaken: number;
}

export interface SortieRecord {
  readonly seed: string;
  readonly sortie: number;
  /** The encounter instance the arrival created; a repeat must meet a fresh one. */
  readonly instanceId: string | null;
  readonly status: FightStatus;
  readonly fightSeconds: number;
  readonly opponents: readonly OpponentRecord[];
  readonly bountyCredits: number;
  /** Hit points the player's repairers restored, by layer. */
  readonly repaired: Readonly<Record<string, number>>;
  /** Share of each layer left when the fight ended, or zero after a loss. */
  readonly finalLayers: Readonly<Record<'shield' | 'armor' | 'hull', number>>;
  /** Share of the ship's total hit points left when the fight ended, or zero after a loss. */
  readonly hitPointsShare: number;
  /** The smallest share of its total hit points the ship was down to during the fight, or zero after a loss. */
  readonly lowestHitPointsShare: number;
  /** Rounds the player fired. */
  readonly roundsFired: number;
  /** Units of each definition taken from wrecks. */
  readonly loot: Readonly<Record<string, number>>;
  /** Completions the station reports for the encounter once the sortie is over. */
  readonly completionCount: number;
}

export interface ScenarioRun {
  readonly scenario: FixtureScenario;
  readonly fit: FixtureFit;
  readonly costCredits: number;
  readonly sorties: readonly SortieRecord[];
}

export interface RunOptions {
  /** Take everything from the wrecks before going home. */
  readonly loot?: boolean;
}

/** Runs every seed of a scenario. */
export async function runScenario(
  scenario: FixtureScenario,
  content: ContentRepository,
  options: RunOptions = {},
): Promise<ScenarioRun> {
  const fit = fixtureFit(scenario.fitId);
  const sorties: SortieRecord[] = [];
  let costCredits = 0;
  for (const seed of scenario.seeds) {
    const assembled = assembleFit(fit, seed, content);
    costCredits = assembled.costCredits;
    sorties.push(...(await runSeed(scenario, fit, assembled, seed, content, options)));
  }
  return { scenario, fit, costCredits, sorties };
}

async function runSeed(
  scenario: FixtureScenario,
  fit: FixtureFit,
  assembled: AssembledFit,
  seed: string,
  content: ContentRepository,
  options: RunOptions,
): Promise<SortieRecord[]> {
  const session = await openSession(assembled.state, content);
  const records: SortieRecord[] = [];
  for (let sortie = 1; sortie <= scenario.sorties; sortie += 1) {
    const record = await flySortie(session, scenario, content, seed, sortie, options);
    records.push(record);
    if (record.status === 'lost' || record.status === 'timedOut') break;
    await refit(session, fit, content);
  }
  return records;
}

/** One sortie from the station and, unless the ship is lost, back again. */
export async function flySortie(
  session: ScenarioSession,
  scenario: FixtureScenario,
  content: ContentRepository,
  seed: string,
  sortie: number,
  options: RunOptions = {},
): Promise<SortieRecord> {
  const encounter = content.requireEncounter(scenario.encounterId as never);
  await session.data('navigation.selectDestination', { encounterId: encounter.id });
  await session.data('ship.undock');
  await session.data('navigation.warp', {
    destinationSiteId: encounter.siteId,
    arrivalDistanceKm: scenario.tactics.arrivalDistanceKm,
  });
  await session.data('time.set', { paused: false, rate: 1 });
  await advanceUntil(session, async () => {
    const site = await session.data<SiteData>('navigation.site');
    return site.location.kind === 'site' && site.location.siteId === encounter.siteId;
  }, 180, 'the ship never arrived at the encounter');

  const arrived = await session.data<EncounterData>('encounter.state');
  const roster = arrived.instance?.npcs ?? [];
  const playerId = (await session.data<AssetsData>('assets.list')).activeShipId ?? '';
  const eventsBefore = session.events.length;

  const result = await fightEncounter(session, scenario.tactics, FIGHT_BUDGET_SECONDS);
  const fightEvents = session.events.slice(eventsBefore);
  const finalCombat = result.status === 'lost' ? null : await session.data<CombatData>('combat.state');
  const finalLayers = finalCombat === null ? zeroLayers() : layersOf(finalCombat);
  const ended = await session.data<EncounterData>('encounter.state');
  const bountyCredits = result.status === 'lost'
    ? sumParam(fightEvents, 'encounter.bountyPaid', 'credits')
    : ended.instance?.bountyCreditsPaid ?? 0;

  const loot: Record<string, number> = {};
  if (result.status === 'completed' && options.loot === true) {
    await lootWrecks(session, loot);
  }
  if (result.status !== 'lost') await returnHome(session);
  const destinations = await session.data<DestinationsData>('navigation.destinations');

  return {
    seed,
    sortie,
    instanceId: arrived.instance?.instanceId ?? null,
    status: result.status,
    fightSeconds: (result.endedAtMs - result.startedAtMs) / 1_000,
    opponents: roster.map((npc) => opponentRecord(npc.shipId, npc.profileId, playerId, fightEvents, result.startedAtMs)),
    bountyCredits,
    repaired: repairsOf(fightEvents, playerId),
    finalLayers,
    hitPointsShare: finalCombat === null ? 0 : hitPointsShareOf(finalCombat),
    lowestHitPointsShare: result.lowestHitPointsShare,
    roundsFired: fightEvents.filter((event) =>
      event.kind === 'combat.shotResolved' && event.params?.['attackerId'] === playerId).length,
    loot,
    completionCount: destinations.destinations.find((entry) => entry.encounterId === encounter.id)?.completionCount ?? 0,
  };
}

/**
 * Waits docked, with the clock running, until the active ship's capacitor is
 * full, and returns the share it holds. Repairs restore the layers but not the
 * capacitor, which recharges only as simulation time passes (Functional
 * Specification 9.8, 10): a pilot who undocks straight after a fight takes a
 * nearly empty capacitor into the next one, so a competent one waits.
 */
export async function restUntilCharged(session: ScenarioSession, budgetSeconds = 600): Promise<number> {
  const shipId = (await session.data<AssetsData>('assets.list')).activeShipId;
  if (shipId === null) return 0;
  const share = async (): Promise<number> => {
    const capacitor = (await session.data<ShipData>('ship.get', { shipId })).capacitor;
    return capacitor.capacity > 0 ? capacitor.charge / capacitor.capacity : 1;
  };
  if ((await share()) >= 0.999) return share();
  await session.data('time.set', { paused: false, rate: 1 });
  for (let waited = 0; waited < budgetSeconds && (await share()) < 0.999; waited += 5) await session.advance(5_000);
  await session.data('time.set', { paused: true, rate: 1 });
  return share();
}

/** Repairs, refills the magazines, restores the fit's reserve rounds and rests until charged. */
export async function refit(session: ScenarioSession, fit: FixtureFit, content: ContentRepository): Promise<void> {
  const stationId = content.rules.economy.startingStationId;
  const assets = await session.data<AssetsData>('assets.list');
  const ship = assets.ships.find((entry) => entry.id === assets.activeShipId);
  if (ship === undefined) throw new Error('No active ship to refit.');

  const repair = await session.data<RepairPreviewData>('repair.preview', { shipId: ship.id });
  if (repair.available && repair.token !== null) await session.data('repair.confirm', { token: repair.token });
  const resupply = await session.data<ResupplyPreviewData>('resupply.preview', { shipId: ship.id });
  if (resupply.available && resupply.token !== null) await session.data('resupply.confirm', { token: resupply.token });

  const hold = await session.data<InventoryData>('inventory.cargo', { shipId: ship.id });
  for (const entry of fit.cargo) {
    const carried = hold.stacks
      .filter((stack) => stack.item.definitionId === entry.definitionId)
      .reduce((total, stack) => total + stack.quantity, 0);
    const missing = entry.quantity - carried;
    if (missing <= 0) continue;
    const preview = await session.data<MarketTransactionPreviewData>('market.previewBuy', {
      stationId,
      itemId: entry.definitionId,
      quantity: missing,
      destinationInventoryId: ship.cargoInventoryId,
    });
    if (preview.available && preview.token !== null) {
      await session.data('market.confirmBuy', { token: preview.token });
    }
  }
  await restUntilCharged(session);
}

/**
 * Empties every NPC wreck in the site that holds something. A wreck's contents
 * are shown at any range, so empty wrecks - including those a previous sortie
 * already emptied - are not flown to, and a wreck that expires on the way is
 * simply gone (Functional Specification 5.4, 9.11).
 */
async function lootWrecks(session: ScenarioSession, loot: Record<string, number>): Promise<void> {
  const encounter = await session.data<EncounterData>('encounter.state');
  const site = await session.data<SiteData>('navigation.site');
  const closest = site.rangePresetsKm[0] ?? 0;
  const contentsOf = async (wreckId: string): Promise<WreckContentsData | null> => {
    const response = await session.ask<WreckContentsData>('loot.contents', { wreckId });
    return response.ok ? response.data : null;
  };
  for (const wreck of encounter.wrecks.filter((entry) => entry.owner === 'npc')) {
    if (((await contentsOf(wreck.wreckId))?.stacks.length ?? 0) === 0) continue;
    await session.data('movement.approach', { targetId: wreck.wreckId, distanceKm: closest });
    const reached = await advanceUntil(session, async () =>
      (await contentsOf(wreck.wreckId))?.accessible !== false, 300);
    const contents = await contentsOf(wreck.wreckId);
    if (!reached || contents === null) continue;
    for (const stack of contents.stacks) {
      const quantity = contents.maximumQuantities.find((entry) => entry.stackId === stack.id)?.maximumQuantity ?? 0;
      if (quantity <= 0) continue;
      const taken = await session.ask('loot.take', { wreckId: wreck.wreckId, stackId: stack.id, quantity });
      if (taken.ok) loot[stack.item.definitionId] = (loot[stack.item.definitionId] ?? 0) + quantity;
    }
  }
}

async function returnHome(session: ScenarioSession): Promise<void> {
  const site = await session.data<SiteData>('navigation.site');
  if (site.location.kind === 'site' && site.site?.objects.every((object) => object.kind !== 'station')) {
    const travelling = site.travelStatus?.kind === 'warp';
    if (!travelling) await session.data('navigation.retreat');
  }
  await advanceUntil(session, async () => {
    const current = await session.data<SiteData>('navigation.site');
    return current.site?.objects.some((object) => object.kind === 'station') === true;
  }, 300, 'the ship never reached the station site');
  const station = (await session.data<SiteData>('navigation.site')).site?.objects.find((object) => object.kind === 'station');
  await session.data('navigation.dock', { stationId: station?.id ?? '' });
  await advanceUntil(session, async () =>
    (await session.data<SiteData>('navigation.site')).location.kind === 'station', 120, 'the ship never docked');
}

async function advanceUntil(
  session: ScenarioSession,
  done: () => Promise<boolean>,
  budgetSeconds: number,
  failure?: string,
): Promise<boolean> {
  for (let step = 0; step < budgetSeconds * 2; step += 1) {
    if (await done()) return true;
    await session.advance(500);
  }
  if (await done()) return true;
  if (failure !== undefined) throw new Error(`Scenario stalled: ${failure}.`);
  return false;
}

function opponentRecord(
  shipId: string,
  profileId: string,
  playerId: string,
  events: readonly DomainEventData[],
  startedAtMs: number,
): OpponentRecord {
  const destroyed = events.find((event) =>
    event.kind === 'combat.shipDestroyed' && event.params?.['shipId'] === shipId);
  const shots = events.filter((event) =>
    event.kind === 'combat.shotResolved' && event.params?.['attackerId'] === shipId && event.params['targetId'] === playerId);
  const taken = events.filter((event) =>
    event.kind === 'combat.shotResolved' && event.params?.['attackerId'] === playerId && event.params['targetId'] === shipId);
  const damage = events.filter((event) =>
    event.kind === 'combat.damageApplied' && event.params?.['attackerId'] === shipId && event.params['targetId'] === playerId);
  return {
    shipId,
    profileId,
    destroyedAtSeconds: destroyed === undefined ? null : (destroyed.simulationTimeMs - startedAtMs) / 1_000,
    shotsAtPlayer: shots.length,
    hitsOnPlayer: shots.filter((event) => event.params?.['hit'] === true).length,
    damageToPlayer: {
      shield: sum(damage, 'shieldDamage'),
      armor: sum(damage, 'armorDamage'),
      hull: sum(damage, 'hullDamage'),
    },
    shotsTaken: taken.length,
    hitsTaken: taken.filter((event) => event.params?.['hit'] === true).length,
  };
}

function repairsOf(events: readonly DomainEventData[], playerId: string): Record<string, number> {
  const repaired: Record<string, number> = {};
  for (const event of events) {
    if (event.kind !== 'combat.repairApplied' || event.params?.['shipId'] !== playerId) continue;
    const layer = String(event.params['layer']);
    repaired[layer] = (repaired[layer] ?? 0) + Number(event.params['repairedHitPoints'] ?? 0);
  }
  return repaired;
}

function layersOf(combat: CombatData): Record<'shield' | 'armor' | 'hull', number> {
  const fraction = (layer: string): number =>
    combat.defenses?.layers.find((entry) => entry.layer === layer)?.fractionRemaining ?? 0;
  return { shield: fraction('shield'), armor: fraction('armor'), hull: fraction('hull') };
}

function hitPointsShareOf(combat: CombatData): number {
  const layers = combat.defenses?.layers ?? [];
  const maximum = layers.reduce((total, layer) => total + layer.maximumHitPoints, 0);
  return maximum > 0 ? layers.reduce((total, layer) => total + layer.currentHitPoints, 0) / maximum : 0;
}

function zeroLayers(): Record<'shield' | 'armor' | 'hull', number> {
  return { shield: 0, armor: 0, hull: 0 };
}

function sum(events: readonly DomainEventData[], param: string): number {
  return events.reduce((total, event) => total + Number(event.params?.[param] ?? 0), 0);
}

function sumParam(events: readonly DomainEventData[], kind: string, param: string): number {
  return sum(events.filter((event) => event.kind === kind), param);
}

/** One line per sortie, for a failure message or a report. */
export function describeSortie(record: SortieRecord): string {
  const opponents = record.opponents.map((opponent) => {
    const fate = opponent.destroyedAtSeconds === null ? 'survived' : `killed at ${opponent.destroyedAtSeconds.toFixed(0)}s`;
    const dealt = opponent.damageToPlayer.shield + opponent.damageToPlayer.armor + opponent.damageToPlayer.hull;
    return `${opponent.profileId} ${fate}, hit player ${String(opponent.hitsOnPlayer)}/${String(opponent.shotsAtPlayer)} for ${dealt.toFixed(0)}, took ${String(opponent.hitsTaken)}/${String(opponent.shotsTaken)}`;
  });
  const layers = `${pct(record.finalLayers.shield)}/${pct(record.finalLayers.armor)}/${pct(record.finalLayers.hull)}`;
  return `seed ${record.seed.slice(0, 6)} #${String(record.sortie)} ${record.status} in ${record.fightSeconds.toFixed(0)}s, ` +
    `layers ${layers}, rounds ${String(record.roundsFired)}, bounty ${String(record.bountyCredits)}; ${opponents.join('; ')}`;
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}
