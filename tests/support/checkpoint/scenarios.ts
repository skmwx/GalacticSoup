import { createMemorySaveStore, planWrite } from '@adapters/persistence';
import {
  createEngineHost,
  DEFAULT_SAVE_RETENTION,
  DEFAULT_SLOT_ID,
  isSealed,
  SAVE_FORMAT_VERSION,
  type ContentRepository,
  type SaveEnvelope,
  type SlotManifest,
} from '@engine';
import type {
  AssetsData,
  CombatData,
  DestinationsData,
  EncounterData,
  EngineResponse,
  FrameData,
  InventoryData,
  LossReportData,
  MarketTransactionPreviewData,
  ResupplyPreviewData,
  ShipData,
  SiteData,
  StackData,
  StateHashData,
} from '@protocol';

import { fixtureFit, fixtureScenario, type FixtureFit } from '../progression/fixtures.ts';
import { attachSession, type ScenarioSession } from '../progression/session.ts';
import { describeSortie, flySortie, refit } from '../progression/sortie.ts';

/**
 * Saved campaign checkpoints for browser tests (Test Suite Optimization Plan
 * phases 3, 4, 7 and 8; Technical Specification 11.2, 11.4, 15.1).
 *
 * A browser case that is about one moment of play - a command in a fight, an
 * audit of the combat surfaces, what to do with a sortie's rewards or after a
 * lost ship - should
 * not spend minutes of real time getting there. A checkpoint reaches that
 * moment headlessly, over the same engine host and protocol requests the
 * worker serves, the way the scenario sessions and the golden campaign do,
 * and keeps the save the engine wrote when it closed the campaign. The browser
 * test then seeds that save into a fresh origin's IndexedDB and opens it
 * through the real campaign interface and worker.
 *
 * Nothing here depends on Playwright or on how the content arrives: the
 * caller passes the content repository. In the browser tests that is the
 * content compiled into the served build (`servedContent.ts`), so the save
 * names exactly the content the worker will load it with.
 *
 * Every checkpoint is deterministic: a fixed campaign seed, fixed wall-clock
 * stamps and whole quarter-second steps. The same content therefore always
 * produces the same envelope, byte for byte.
 */

/** The sixteen bytes every checkpoint campaign is created from. */
export const CHECKPOINT_SEED = 'bb22cc33dd44ee55ff6677889900aa11';
export const CHECKPOINT_PILOT = 'Checkpoint Pilot';
const CREATED_AT_REAL_MS = 1_700_000_000_000;
const CLOSED_AT_REAL_MS = 1_700_000_100_000;

const SCOUT_ENCOUNTER = 'encounter.borrell.pirate-scout';
const SCOUT_SITE = 'site.borrell.verge';
/** The hard site the loss checkpoints leave the starter ship idle at until it is destroyed. */
const BASE_SITE = 'site.borrell.outpost-cradle';
const AUTOCANNON = 'module.turret.autocannon.small';
/** The headless progression scenario the patrol checkpoint flies: the intermediate fit, cutters first. */
const PATROL_SCENARIO = 'patrol.intermediate';
/** The scenario the mastery checkpoint flies next: the mastery fit, 10 km from the nearest brawler. */
const BASE_SCENARIO = 'base.mastery';
const STEP_MS = 250;
const LOCALE = 'en';

export const CHECKPOINT_NAMES = [
  'scout-arrived',
  'scout-in-range',
  'scout-fight',
  'patrol-salvage',
  'base-cleared',
  'loss-granted',
  'loss-shipless',
] as const;
export type CheckpointName = (typeof CHECKPOINT_NAMES)[number];

export const CHECKPOINT_DESCRIPTIONS: Readonly<Record<CheckpointName, string>> = {
  'scout-arrived':
    'Paused at the Pirate Scout site the moment the starter ship arrives from a warp 10 km out; nothing selected, ordered or locked.',
  'scout-in-range':
    'Paused at the Pirate Scout site with the starter ship orbiting the scout inside lock and weapon range; nothing locked, no weapon running.',
  'scout-fight':
    'Paused in a fight with the Pirate Scout: the scout locked, the autocannon firing at it, the shield booster running and hits recorded.',
  'patrol-salvage':
    'Docked and paused at Borrell Harbour after clearing the Pirate Patrol with the intermediate fit: the bounty paid, every wreck looted, the salvage and any earned module in the hold.',
  'base-cleared':
    'Docked and paused at Borrell Harbour after the patrol checkpoint, the salvage sold, the mastery fit bought and fitted with the earned plating, and the Pirate Base cleared with it: the Pirate Base still the chosen destination, each site completed once.',
  'loss-granted':
    'Docked and paused at Borrell Harbour after the starter ship, with a spare autocannon bought for the hangar, was destroyed idling at the Pirate Base: the loss reported and insured, a recovery-grant Wayfarer supplied, and what survived waiting in the wreck.',
  'loss-shipless':
    "Docked and paused at Borrell Harbour without a ship after the starter ship's autocannon was taken off and sold and the rest destroyed idling at the Pirate Base: the payout leaves enough to buy a starter ship, so the recovery service supplied none.",
};

/**
 * What a campaign resumed in a site shows, read through its projections. The
 * browser test checks the interface against these, and the helper checks that
 * a save resumed headlessly answers with exactly these.
 */
export interface SiteCheckpointFacts {
  readonly kind: 'site';
  readonly stateHash: string;
  readonly simulationTimeMs: number;
  readonly paused: boolean;
  readonly siteId: string;
  readonly opponentId: string;
  readonly opponentWithinLockRange: boolean;
  readonly opponentRangeKm: number;
  readonly locks: readonly { readonly targetId: string; readonly status: string }[];
  /** The first weapon's target while it repeats, else `null`. */
  readonly firingAt: string | null;
  readonly boosterActive: boolean;
}

/** One fitted slot: what occupies it and the charge it holds, by definition. */
export interface FittedSlotFact {
  readonly slotKind: string;
  readonly slotIndex: number;
  readonly moduleId: string | null;
  readonly moduleName: string | null;
  readonly chargeId: string | null;
}

/** One loose stack in an inventory, by definition, with its English name. */
export interface StackFact {
  readonly stackId: string;
  readonly definitionId: string;
  readonly kind: StackData['item']['kind'];
  readonly name: string;
  readonly quantity: number;
}

/** One line of a loss report's lost or surviving items. */
export interface LossItemFact {
  readonly name: string;
  readonly quantity: number;
  readonly origin: 'fitted' | 'cargo' | 'loaded';
  readonly survived: boolean;
}

/** The most recent loss, as its report explains it. */
export interface LossFact {
  readonly lossId: string;
  readonly hullName: string;
  readonly siteName: string;
  readonly encounterName: string | null;
  readonly recovery: 'granted' | 'otherShip' | 'noShip';
  readonly creditsAfter: number;
  readonly payoutCredits: number;
  readonly wreckPresent: boolean;
  readonly wreckItemCount: number;
  /** In the report's order. */
  readonly items: readonly LossItemFact[];
}

/** What a campaign resumed docked shows: wallet, fit, hold, hangar, the last sortie and the last loss. */
export interface StationCheckpointFacts {
  readonly kind: 'station';
  readonly stateHash: string;
  readonly simulationTimeMs: number;
  readonly paused: boolean;
  readonly stationId: string;
  readonly stationName: string;
  readonly credits: number;
  /** `null` for a pilot left without a ship, who has no fit and no hold. */
  readonly activeShipId: string | null;
  readonly fit: readonly FittedSlotFact[];
  /** Plain stacks in the active ship's hold, in the order the station lists them. */
  readonly hold: readonly StackFact[];
  /** Plain stacks in the station hangar, in the order the station lists them. */
  readonly hangar: readonly StackFact[];
  readonly lastOutcome: {
    readonly encounterId: string;
    readonly name: string;
    readonly status: string;
    readonly npcsDestroyed: number;
    readonly npcsTotal: number;
    readonly bountyCreditsPaid: number;
  } | null;
  /** The encounter chosen as the destination, which space navigation offers first. */
  readonly selectedDestination: { readonly encounterId: string; readonly name: string } | null;
  /** Every encounter completed at least once, with its completion count, in the order destinations are listed. */
  readonly completions: readonly { readonly encounterId: string; readonly name: string; readonly count: number }[];
  /** The campaign's most recent ship loss, or `null` if no ship has been lost. */
  readonly loss: LossFact | null;
}

export type CheckpointFacts = SiteCheckpointFacts | StationCheckpointFacts;

export interface Checkpoint<TFacts extends CheckpointFacts = CheckpointFacts> {
  readonly name: CheckpointName;
  readonly contentVersion: string;
  readonly contentHash: string;
  /** The manifest the IndexedDB store would hold with this save alone in the slot. */
  readonly manifest: SlotManifest;
  readonly envelope: SaveEnvelope;
  readonly facts: TFacts;
}

/** A mismatch between a checkpoint and what it is about to be used with. */
export class CheckpointMismatch extends Error {
  override readonly name = 'CheckpointMismatch';
}

/** Narrows a checkpoint to the kind of place it was taken in, or says it is the other. */
export function checkpointAt<TKind extends CheckpointFacts['kind']>(
  checkpoint: Checkpoint,
  kind: TKind,
): Checkpoint<Extract<CheckpointFacts, { kind: TKind }>> {
  if (checkpoint.facts.kind !== kind) {
    throw new CheckpointMismatch(`Checkpoint "${checkpoint.name}" was taken in a ${checkpoint.facts.kind}, not a ${kind}.`);
  }
  return checkpoint as Checkpoint<Extract<CheckpointFacts, { kind: TKind }>>;
}

/** Answers protocol requests; a scenario session is one. */
type Asker = Pick<ScenarioSession, 'ask' | 'data'>;

/** Advances real time in whole steps until `done`, or gives up after the budget. */
async function until(session: ScenarioSession, done: () => Promise<boolean>, budgetSeconds: number): Promise<boolean> {
  for (let step = 0; step < Math.ceil((budgetSeconds * 1000) / STEP_MS); step += 1) {
    await session.advance(STEP_MS);
    if (await done()) return true;
  }
  return false;
}

/** Reads the facts a checkpoint promises from an open campaign, for where it is. */
async function observe(session: Asker, content: ContentRepository): Promise<CheckpointFacts> {
  const assets = await session.data<AssetsData>('assets.list');
  return assets.location.kind === 'station' ? observeStation(session, content, assets) : observeSite(session);
}

async function observeSite(session: Asker): Promise<SiteCheckpointFacts> {
  const hash = await session.data<StateHashData>('diagnostics.stateHash');
  const frame = await session.data<FrameData>('campaign.frame');
  const site = await session.data<SiteData>('navigation.site');
  const encounter = await session.data<EncounterData>('encounter.state');
  const combat = await session.data<CombatData>('combat.state');
  const opponentId = encounter.instance?.npcs[0]?.shipId;
  if (site.location.kind !== 'site' || opponentId === undefined || hash.stateHash === null) {
    throw new CheckpointMismatch('The checkpoint campaign is not in a site with an opponent.');
  }
  const motion = combat.motion.find((entry) => entry.targetId === opponentId);
  const weapon = combat.weapons[0];
  return {
    kind: 'site',
    stateHash: hash.stateHash,
    simulationTimeMs: frame.simulationTimeMs,
    paused: frame.paused,
    siteId: site.location.siteId,
    opponentId,
    opponentWithinLockRange: motion?.withinLockRange ?? false,
    opponentRangeKm: Math.round((motion?.rangeKm ?? Number.NaN) * 1000) / 1000,
    locks: combat.locks.map((lock) => ({ targetId: lock.targetId, status: lock.status })),
    firingAt: weapon !== undefined && weapon.repeating ? weapon.targetId : null,
    boosterActive: combat.modules.some((module) => module.slot.kind === 'system' && module.status === 'active'),
  };
}

async function observeStation(session: Asker, content: ContentRepository, assets: AssetsData): Promise<StationCheckpointFacts> {
  const hash = await session.data<StateHashData>('diagnostics.stateHash');
  const frame = await session.data<FrameData>('campaign.frame');
  const encounter = await session.data<EncounterData>('encounter.state');
  if (assets.location.kind !== 'station' || hash.stateHash === null) {
    throw new CheckpointMismatch('The checkpoint campaign is not docked.');
  }
  const stationId = assets.location.stationId;
  const shipId = assets.activeShipId;
  const ship = shipId === null ? null : await session.data<ShipData>('ship.get', { shipId });
  const hold = shipId === null ? null : await session.data<InventoryData>('inventory.cargo', { shipId });
  const hangar = await session.data<InventoryData>('inventory.hangar', { stationId });
  const name = (key: string): string => {
    const text = content.message(LOCALE, key);
    if (text === undefined) throw new CheckpointMismatch(`The content has no ${LOCALE} name for ${key}.`);
    return text;
  };
  const loose = (inventory: InventoryData | null): StackFact[] => (inventory?.stacks ?? [])
    .filter((stack) => stack.state.kind === 'plain')
    .map((stack) => ({
      stackId: stack.id,
      definitionId: stack.item.definitionId,
      kind: stack.item.kind,
      name: name(stack.item.nameKey),
      quantity: stack.quantity,
    }));
  const outcome = encounter.lastOutcome;
  const destinations = await session.data<DestinationsData>('navigation.destinations');
  const loss = (await session.data<LossReportData>('loss.report')).report;
  const selected = destinations.destinations.find((entry) => entry.encounterId === destinations.selectedEncounterId);
  return {
    kind: 'station',
    stateHash: hash.stateHash,
    simulationTimeMs: frame.simulationTimeMs,
    paused: frame.paused,
    stationId,
    stationName: name(content.requireStation(stationId as never).nameKey),
    credits: assets.credits,
    activeShipId: shipId,
    fit: (ship?.slots ?? []).map((slot) => ({
      slotKind: slot.slot.kind,
      slotIndex: slot.slot.index,
      moduleId: slot.module?.definitionId ?? null,
      moduleName: slot.module === null ? null : name(slot.module.nameKey),
      chargeId: slot.charge?.item.definitionId ?? null,
    })),
    hold: loose(hold),
    hangar: loose(hangar),
    lastOutcome: outcome === null ? null : {
      encounterId: outcome.encounterId,
      name: name(outcome.nameKey),
      status: outcome.status,
      npcsDestroyed: outcome.npcsDestroyed,
      npcsTotal: outcome.npcsTotal,
      bountyCreditsPaid: outcome.bountyCreditsPaid,
    },
    selectedDestination: selected === undefined ? null : { encounterId: selected.encounterId, name: name(selected.nameKey) },
    completions: destinations.destinations
      .filter((entry) => entry.completionCount > 0)
      .map((entry) => ({ encounterId: entry.encounterId, name: name(entry.nameKey), count: entry.completionCount })),
    loss: loss === null ? null : {
      lossId: loss.lossId,
      hullName: name(loss.hullNameKey),
      siteName: name(loss.siteNameKey),
      encounterName: loss.encounterNameKey === null ? null : name(loss.encounterNameKey),
      recovery: loss.recovery.outcome,
      creditsAfter: loss.recovery.creditsAfter,
      payoutCredits: loss.insurance.payoutCredits,
      wreckPresent: loss.wreck.present,
      wreckItemCount: loss.wreck.itemCount,
      items: loss.items.map((item) => ({
        name: name(item.nameKey),
        quantity: item.quantity,
        origin: item.origin,
        survived: item.survived,
      })),
    },
  };
}

/** Undocks, warps to the scout site at 10 km and waits for arrival; returns the scout's id. */
async function arriveAtScout(session: ScenarioSession): Promise<string> {
  await session.data('ship.undock');
  await session.data('navigation.selectDestination', { encounterId: SCOUT_ENCOUNTER });
  await session.data('navigation.warp', { destinationSiteId: SCOUT_SITE, arrivalDistanceKm: 10 });
  await session.data('time.set', { paused: false, rate: 1 });
  const arrived = await until(session, async () => {
    const site = await session.data<SiteData>('navigation.site');
    return site.location.kind === 'site' && site.location.siteId === SCOUT_SITE;
  }, 120);
  if (!arrived) throw new Error('The checkpoint ship never arrived at the scout site.');
  const encounter = await session.data<EncounterData>('encounter.state');
  const opponent = encounter.instance?.npcs[0]?.shipId;
  if (opponent === undefined) throw new Error('The scout site spawned no opponent.');
  return opponent;
}

/**
 * Orbits the scout at 1 km until it may be locked and the first weapon
 * reaches it, the moment a player would lock. The orbit order is kept.
 */
async function closeToRange(session: ScenarioSession, opponentId: string): Promise<void> {
  await session.data('movement.orbit', { targetId: opponentId, distanceKm: 1 });
  const inRange = await until(session, async () => {
    const combat = await session.data<CombatData>('combat.state');
    const motion = combat.motion.find((entry) => entry.targetId === opponentId);
    const lockable = combat.lockCommands
      .find((entry) => entry.objectId === opponentId)
      ?.commands.some((command) => command.command === 'targeting.lock' && command.available) === true;
    const weapon = combat.weapons[0];
    return motion !== undefined && motion.withinLockRange && lockable &&
      weapon !== undefined && motion.rangeKm <= weapon.optimalRangeKm;
  }, 120);
  if (!inRange) throw new Error('The scout never came inside lock and weapon range.');
}

/** Locks the scout, opens fire, runs the booster and waits for the first exchanges. */
async function engage(session: ScenarioSession, opponentId: string): Promise<void> {
  await session.data('targeting.lock', { targetId: opponentId });
  const locked = await until(
    session,
    async () => (await session.data<CombatData>('combat.state')).locks.some((lock) => lock.status === 'locked'),
    60,
  );
  if (!locked) throw new Error('The scout was never locked.');
  await session.data('weapon.activate', { slotKind: 'weapon', slotIndex: 0, targetId: opponentId });
  await session.data('module.activate', { slotKind: 'system', slotIndex: 0 });
  const fighting = await until(session, async () => {
    const combat = await session.data<CombatData>('combat.state');
    return combat.events.length >= 2 && combat.hostileLocks.length > 0 &&
      combat.weapons.some((weapon) => weapon.repeating && weapon.cycle !== null);
  }, 60);
  if (!fighting) throw new Error('The fight never started both ways.');
}

/** Total units of each definition the campaign owns anywhere, fitted and loaded included. */
function ownedUnits(assets: AssetsData): Map<string, number> {
  const owned = new Map<string, number>();
  for (const inventory of assets.inventories) {
    for (const stack of inventory.stacks) {
      owned.set(stack.item.definitionId, (owned.get(stack.item.definitionId) ?? 0) + stack.quantity);
    }
  }
  return owned;
}

/**
 * Puts a representative fit on the starter ship through the station, over the
 * protocol: buys what the campaign lacks at the market with its own credits,
 * assembles the fit in one draft, fills the magazines and carries the reserve
 * rounds. This is the station flow `progression/assemble.ts` performs on a
 * campaign state, and the purchases the Patrol-to-Base browser case makes,
 * but nothing is set directly - the wallet is what the purchases leave.
 */
async function fitThroughStation(session: ScenarioSession, fit: FixtureFit, content: ContentRepository): Promise<void> {
  const stationId = content.rules.economy.startingStationId;
  if (fit.hullId !== undefined && fit.hullId !== content.rules.economy.starterHullId) {
    throw new Error(`Fit "${fit.id}" needs another hull; a checkpoint fits the starter ship only.`);
  }
  const assets = await session.data<AssetsData>('assets.list');
  const ship = assets.ships.find((entry) => entry.id === assets.activeShipId);
  if (ship === undefined) throw new Error('The checkpoint campaign has no active ship.');

  const needed = new Map<string, number>();
  const add = (definitionId: string, quantity: number): void => {
    needed.set(definitionId, (needed.get(definitionId) ?? 0) + quantity);
  };
  for (const entry of fit.modules) {
    add(entry.moduleId, 1);
    if (entry.ammunitionId !== undefined) {
      const module = content.requireModule(entry.moduleId as never);
      add(entry.ammunitionId, module.category === 'turret' ? module.turret.magazineSize
        : module.category === 'launcher' ? module.launcher.magazineSize : 0);
    }
  }
  for (const entry of fit.cargo) add(entry.definitionId, entry.quantity);
  const owned = ownedUnits(assets);
  const shortfall = [...needed.entries()]
    .map(([definitionId, quantity]): [string, number] => [definitionId, quantity - (owned.get(definitionId) ?? 0)])
    .filter(([, quantity]) => quantity > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [itemId, quantity] of shortfall) {
    const preview = await session.data<MarketTransactionPreviewData>('market.previewBuy', { stationId, itemId, quantity });
    if (!preview.available || preview.token === null) {
      throw new Error(`Fit "${fit.id}" needs ${String(quantity)} ${itemId}, which the market refuses: ${String(preview.unavailableReason)}`);
    }
    await session.data('market.confirmBuy', { token: preview.token });
  }

  await session.data('fitting.begin', { shipId: ship.id });
  const hull = content.requireHull(ship.hullId as never);
  for (const [slotKind, count] of Object.entries(hull.slots)) {
    for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
      const wanted = fit.modules.find((entry) => entry.slot === slotKind && entry.index === slotIndex);
      if (wanted === undefined) await session.data('fitting.clear', { slotKind, slotIndex });
      else {
        await session.data('fitting.set', {
          slotKind,
          slotIndex,
          moduleId: wanted.moduleId,
          online: true,
          ...(wanted.ammunitionId === undefined ? {} : { ammunitionId: wanted.ammunitionId }),
        });
      }
    }
  }
  await session.data('fitting.commit');

  const resupply = await session.data<ResupplyPreviewData>('resupply.preview', { shipId: ship.id });
  if (resupply.available && resupply.token !== null) await session.data('resupply.confirm', { token: resupply.token });

  for (const entry of fit.cargo) {
    // A ship back from a sortie may still carry some of its reserve.
    const carried = (await session.data<InventoryData>('inventory.cargo', { shipId: ship.id })).stacks
      .filter((stack) => stack.item.definitionId === entry.definitionId)
      .reduce((total, stack) => total + stack.quantity, 0);
    let remaining = Math.max(0, entry.quantity - carried);
    const hangar = await session.data<InventoryData>('inventory.hangar', { stationId });
    const stacks = hangar.stacks
      .filter((stack) => stack.item.definitionId === entry.definitionId && stack.state.kind === 'plain')
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const stack of stacks) {
      if (remaining === 0) break;
      const quantity = Math.min(remaining, stack.quantity);
      await session.data('inventory.transfer', { stackId: stack.id, destinationInventoryId: ship.cargoInventoryId, quantity });
      remaining -= quantity;
    }
    if (remaining > 0) throw new Error(`Fit "${fit.id}" could not carry ${String(entry.quantity)} ${entry.definitionId}.`);
  }
}

/**
 * Flies the headless progression scenario's Pirate Patrol sortie with its fit
 * and tactics, loots every wreck and docks: the moment the Patrol-to-Base
 * browser case converts its rewards.
 */
async function clearPatrolAndDock(session: ScenarioSession, content: ContentRepository): Promise<void> {
  const scenario = fixtureScenario(PATROL_SCENARIO);
  await fitThroughStation(session, fixtureFit(scenario.fitId), content);
  const record = await flySortie(session, scenario, content, CHECKPOINT_SEED, 1, { loot: true });
  if (record.status !== 'completed') throw new Error(`The patrol checkpoint sortie did not clear: ${describeSortie(record)}`);
  if (Object.keys(record.loot).length === 0) throw new Error('The patrol checkpoint sortie brought no salvage home.');
  const assets = await session.data<AssetsData>('assets.list');
  if (assets.location.kind !== 'station') throw new Error('The patrol checkpoint sortie did not dock.');
}

/** Sells every plain salvage stack in the active ship's hold, each whole, at the station it is docked at. */
async function sellSalvage(session: ScenarioSession, content: ContentRepository): Promise<void> {
  const stationId = content.rules.economy.startingStationId;
  const assets = await session.data<AssetsData>('assets.list');
  if (assets.activeShipId === null) throw new Error('No active ship to sell salvage from.');
  const hold = await session.data<InventoryData>('inventory.cargo', { shipId: assets.activeShipId });
  for (const stack of hold.stacks.filter((entry) => entry.state.kind === 'plain' && entry.item.kind === 'item')) {
    const preview = await session.data<MarketTransactionPreviewData>('market.previewSell', {
      stationId, stackId: stack.id, quantity: stack.quantity,
    });
    if (!preview.available || preview.token === null) {
      throw new Error(`The market refuses to buy ${stack.item.definitionId}: ${String(preview.unavailableReason)}`);
    }
    await session.data('market.confirmSell', { token: preview.token });
  }
}

/**
 * After the patrol checkpoint: sells the salvage, buys what the mastery fit
 * lacks and fits it with the earned plating, takes the station's repair and
 * resupply, and flies the headless progression scenario's Pirate Base sortie
 * home - the steps the Patrol-to-Base browser case once played at 1x after
 * converting its rewards (Test Suite Optimization Plan phase 6).
 */
async function clearBaseAndDock(session: ScenarioSession, content: ContentRepository): Promise<void> {
  await clearPatrolAndDock(session, content);
  await sellSalvage(session, content);
  const scenario = fixtureScenario(BASE_SCENARIO);
  const fit = fixtureFit(scenario.fitId);
  await fitThroughStation(session, fit, content);
  await refit(session, fit, content);
  const record = await flySortie(session, scenario, content, CHECKPOINT_SEED, 2);
  if (record.status !== 'completed') throw new Error(`The mastery checkpoint sortie did not clear: ${describeSortie(record)}`);
  const assets = await session.data<AssetsData>('assets.list');
  if (assets.location.kind !== 'station') throw new Error('The mastery checkpoint sortie did not dock.');
}

/** Buys one item at the starting station's market with the campaign's own credits. */
async function buyOne(session: ScenarioSession, itemId: string, content: ContentRepository): Promise<void> {
  const stationId = content.rules.economy.startingStationId;
  const preview = await session.data<MarketTransactionPreviewData>('market.previewBuy', { stationId, itemId, quantity: 1 });
  if (!preview.available || preview.token === null) {
    throw new Error(`The market refuses to sell ${itemId}: ${String(preview.unavailableReason)}`);
  }
  await session.data('market.confirmBuy', { token: preview.token });
}

/**
 * Takes the starter ship's autocannon off and sells it at the station, as the
 * loss audit's pilot once did in the browser, so the payout after a loss
 * leaves enough to buy a starter ship back.
 */
async function sellFittedAutocannon(session: ScenarioSession, content: ContentRepository): Promise<void> {
  const stationId = content.rules.economy.startingStationId;
  const assets = await session.data<AssetsData>('assets.list');
  if (assets.activeShipId === null) throw new Error('The checkpoint campaign has no active ship.');
  await session.data('fitting.begin', { shipId: assets.activeShipId });
  await session.data('fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
  await session.data('fitting.commit');
  const hangar = await session.data<InventoryData>('inventory.hangar', { stationId });
  const gun = hangar.stacks.find((stack) => stack.item.definitionId === AUTOCANNON && stack.state.kind === 'plain');
  if (gun === undefined) throw new Error('The autocannon taken off the starter ship is not in the hangar.');
  const preview = await session.data<MarketTransactionPreviewData>('market.previewSell', {
    stationId, stackId: gun.id, quantity: gun.quantity,
  });
  if (!preview.available || preview.token === null) {
    throw new Error(`The market refuses to buy the autocannon: ${String(preview.unavailableReason)}`);
  }
  await session.data('market.confirmSell', { token: preview.token });
}

/**
 * Undocks the starter ship, warps it to the Pirate Base 10 km out and leaves
 * it idle there until it is destroyed and the pilot is recovered at the
 * station - the transition the loss browser case plays at 1x. Refuses a
 * recovery other than the one expected.
 */
async function loseShipAtBase(session: ScenarioSession, expected: 'granted' | 'noShip'): Promise<void> {
  await session.data('ship.undock');
  await session.data('navigation.warp', { destinationSiteId: BASE_SITE, arrivalDistanceKm: 10 });
  await session.data('time.set', { paused: false, rate: 1 });
  const recovered = await until(
    session,
    async () => (await session.data<SiteData>('navigation.site')).location.kind === 'station',
    300,
  );
  if (!recovered) throw new Error('The checkpoint ship was never destroyed at the Pirate Base.');
  const report = (await session.data<LossReportData>('loss.report')).report;
  if (report === null) throw new Error('The checkpoint ship came home without a loss.');
  if (report.recovery.outcome !== expected) {
    throw new Error(`The checkpoint loss was recovered as "${report.recovery.outcome}", not "${expected}".`);
  }
}

const SCRIPTS: Readonly<Record<CheckpointName, (session: ScenarioSession, content: ContentRepository) => Promise<void>>> = {
  async 'scout-arrived'(session) {
    await arriveAtScout(session);
  },
  async 'scout-in-range'(session) {
    const opponent = await arriveAtScout(session);
    await closeToRange(session, opponent);
  },
  async 'scout-fight'(session) {
    const opponent = await arriveAtScout(session);
    await closeToRange(session, opponent);
    await engage(session, opponent);
  },
  async 'patrol-salvage'(session, content) {
    await clearPatrolAndDock(session, content);
  },
  async 'base-cleared'(session, content) {
    await clearBaseAndDock(session, content);
  },
  async 'loss-granted'(session, content) {
    // A spare gun in the hangar leaves too little, after the payout, to buy the starter ship back.
    await buyOne(session, AUTOCANNON, content);
    await loseShipAtBase(session, 'granted');
  },
  async 'loss-shipless'(session, content) {
    await sellFittedAutocannon(session, content);
    await loseShipAtBase(session, 'noShip');
  },
};

/**
 * Plays a checkpoint's script on a new campaign, pauses, closes the campaign
 * and returns the save the engine wrote, with the facts it promises.
 */
export async function prepareCheckpoint(name: CheckpointName, content: ContentRepository): Promise<Checkpoint> {
  const saves = createMemorySaveStore();
  const session = attachSession(createEngineHost({ content, saves }), saves, 0, `checkpoint-${name}`);
  await session.data('campaign.create', {
    displayName: CHECKPOINT_PILOT,
    seed: CHECKPOINT_SEED,
    createdAtRealMs: CREATED_AT_REAL_MS,
  });
  await SCRIPTS[name](session, content);
  await session.data('time.set', { paused: true, rate: 1 });
  const facts = await observe(session, content);
  await session.data('campaign.close', { savedAtRealMs: CLOSED_AT_REAL_MS });

  const written = await saves.readManifest(DEFAULT_SLOT_ID);
  const latest = written?.saves[0];
  if (latest === undefined) throw new Error(`Checkpoint "${name}" closed without a save.`);
  const envelope = (await saves.readSave(DEFAULT_SLOT_ID, latest.saveId)) as SaveEnvelope | null;
  if (envelope === null) throw new Error(`Checkpoint "${name}" lost its save.`);
  // The slot holds this save alone, as the store writes a first save.
  const manifest = planWrite(null, envelope, DEFAULT_SAVE_RETENTION).manifest;
  const checkpoint: Checkpoint = {
    name,
    contentVersion: content.contentVersion,
    contentHash: content.contentHash,
    manifest,
    envelope,
    facts,
  };
  await verifyCheckpoint(checkpoint, content);
  return checkpoint;
}

/**
 * Checks a checkpoint before it is seeded: the current save format, the
 * content it is about to run against, an intact checksum, a manifest naming
 * the save, and - by resuming it in a fresh host from a store holding only
 * that manifest and save - exactly the promised projection. Throws a
 * `CheckpointMismatch` naming the first difference.
 */
export async function verifyCheckpoint(checkpoint: Checkpoint, content: ContentRepository): Promise<void> {
  const { envelope, manifest, name } = checkpoint;
  const fail = (what: string): never => {
    throw new CheckpointMismatch(`Checkpoint "${name}": ${what}`);
  };
  if (envelope.format !== 'galactic-soup/save') fail(`the save format is "${String(envelope.format)}"`);
  if (envelope.formatVersion !== SAVE_FORMAT_VERSION) {
    fail(`the save is format ${String(envelope.formatVersion)}, the engine writes ${String(SAVE_FORMAT_VERSION)}`);
  }
  if (envelope.contentHash !== content.contentHash || envelope.contentVersion !== content.contentVersion) {
    fail(
      `the save names content ${envelope.contentVersion} (${envelope.contentHash.slice(0, 12)}), ` +
        `but it is used with ${content.contentVersion} (${content.contentHash.slice(0, 12)})`,
    );
  }
  if (!isSealed(envelope)) fail('the save checksum does not match its contents');
  if (manifest.slotId !== DEFAULT_SLOT_ID || manifest.saves.length !== 1 || manifest.saves[0]?.saveId !== envelope.saveId) {
    fail('the manifest does not name the save alone in the default slot');
  }

  const store = createMemorySaveStore();
  await store.write({ envelope, retention: DEFAULT_SAVE_RETENTION });
  const session = attachSession(createEngineHost({ content, saves: store }), store, 0, `checkpoint-verify-${name}`);
  const resumed: EngineResponse<unknown> = await session.ask('campaign.resume');
  if (!resumed.ok) fail(`the save does not resume: ${resumed.error.messageKey}`);
  const facts = await observe(session, content);
  const expected = JSON.stringify(checkpoint.facts);
  const actual = JSON.stringify(facts);
  if (actual !== expected) fail(`the resumed projection differs.\n  expected ${expected}\n  resumed  ${actual}`);
}
