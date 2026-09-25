import { describe, expect, it } from 'vitest';

import {
  applyDraftTo,
  campaignStateHash,
  draftOf,
  drawChance,
  inventoryService,
  playerWrecks,
  RANDOM_STREAMS,
  seedStreams,
  setDestroyedAt,
  shipFit,
  slotKey,
  stacksIn,
  starterReferenceValue,
  validateCampaign,
  type CampaignDraft,
  type CampaignState,
  type EntityId,
  type ItemStack,
  type MutableRandomStreams,
} from '@engine/domain';
import { advanceLoss } from '@engine/simulation';
import { runCommand } from '@engine/application';
import { insurancePreview, marketBuyPreview, marketSellPreview, resupplyPreview } from '@engine/projections';
import type { CommandType, EngineError } from '@protocol';
import type { DefinitionId, SiteId } from '@shared';

import { shippedContent } from '../../support/content.ts';
import {
  AUTOCANNON,
  breakHull,
  buy,
  command,
  FUSION,
  HARBOUR,
  inSite,
  insureEnhanced,
  lossContext,
  newCampaign,
  PHASED,
  reasonOf,
  SHIELD_BOOSTER,
  STARTER_HULL,
  stateOf,
  withCredits,
  type LossFixture,
} from '../../support/loss.ts';

/**
 * Properties of loss and recovery over many seeds and random operation
 * sequences (Functional Specification 9.12, 22.1-22.3; Technical
 * Specification 8.3, 9.4, 10.9, 15.1).
 *
 * The engine has no property-testing library, so each property is a seeded
 * loop: the generator is deterministic, every run checks the same cases, and
 * a failure names the seed and step that produced it.
 */

const content = shippedContent();
const REFERENCE = starterReferenceValue(content);
const STATION_SITE_ID = content.requireStation(HARBOUR).siteId as SiteId;
const RECOVERY_SALE = 'market.unavailable.recoveryGrant';
const RECOVERY_INSURANCE = 'insurance.unavailable.recoveryGrant';

/** A small, fast, seedable generator (mulberry32). */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error('Nothing to pick from.');
  return value;
}

function integer(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function hexSeed(random: () => number): string {
  let seed = '';
  while (seed.length < 32) seed += Math.floor(random() * 16).toString(16);
  return seed;
}

function granted(quantity: number) {
  return { grantedQuantity: quantity, purchasedQuantity: 0, purchaseCostCredits: 0 };
}

function hangarId(state: CampaignState): string {
  const hangar = Object.values(state.assets.inventories).find(
    (inventory) => inventory.location.kind === 'hangar' && inventory.location.stationId === HARBOUR,
  );
  if (hangar === undefined) throw new Error('No hangar.');
  return hangar.id;
}

/** The ship's stores the destruction transaction consumes. */
function shipStores(state: CampaignState, shipId: string): Set<string> {
  const ship = state.assets.ships[shipId];
  if (ship === undefined) return new Set();
  const stores = new Set([ship.cargoInventoryId, ship.fittingInventoryId]);
  for (const inventory of Object.values(state.assets.inventories)) {
    if (inventory.location.kind === 'reserve' && inventory.location.ownerId === shipId) stores.add(inventory.id);
  }
  return stores;
}

/** Destroys the player right now, as the loss transaction sees it, without any other system running. */
function resolveLossOnly(fixture: LossFixture): void {
  const now = fixture.draft.time.simulationTimeMs;
  setDestroyedAt(fixture.draft, fixture.playerId, now);
  advanceLoss(fixture.context, now, now);
}

function clone(state: CampaignState): CampaignState {
  return draftOf(state) as unknown as CampaignState;
}

function lossOf(state: CampaignState) {
  const loss = state.recovery.lastLoss;
  if (loss === null) throw new Error('No loss was recorded.');
  return loss;
}

/* -------------------------------------------------------------------------- */
/* (a) Independent survival rolls                                              */
/* -------------------------------------------------------------------------- */

const CARGO: readonly [string, number][] = [
  ['item.salvage.alloy', 4],
  ['item.salvage.circuitry', 2],
  ['module.turret.railgun.small', 1],
  ['ammo.hybrid.small.iron', 40],
  ['module.propulsion.afterburner.small', 1],
];

/** A ship in an empty site: the starting fit plus five cargo stacks of distinct kinds. */
function survivalBase(): { readonly state: CampaignState; readonly playerId: EntityId } {
  const fixture = inSite(newCampaign(), { spawn: false });
  const ship = fixture.draft.assets.ships[fixture.playerId]!;
  const service = inventoryService(fixture.draft, content);
  for (const [definitionId, quantity] of CARGO) {
    service.add(ship.cargoInventoryId, definitionId as DefinitionId, quantity, granted(quantity));
  }
  expect(validateCampaign(stateOf(fixture), content)).toEqual([]);
  return { state: clone(stateOf(fixture)), playerId: fixture.playerId };
}

/** Destroys a copy of `base` whose streams come from `seed`. */
function lossWithSeed(base: CampaignState, seed: string): { readonly fixture: LossFixture; readonly before: CampaignState } {
  const draft = draftOf(base);
  (draft as { random: unknown }).random = seedStreams(seed);
  const before = clone(draft as unknown as CampaignState);
  const playerId = draft.assets.activeShipId as EntityId;
  const fixture: LossFixture = { draft, content, context: lossContext(draft, content), playerId };
  resolveLossOnly(fixture);
  return { fixture, before };
}

describe('independent survival rolls', () => {
  it('rolls each fitted module and cargo stack once, on the loot stream only, in slot then cargo order [FUNC-9.12, TECH-9.4]', () => {
    const { state: base } = survivalBase();
    const random = generator(1);
    for (let round = 0; round < 40; round += 1) {
      const seed = hexSeed(random);
      const { fixture, before } = lossWithSeed(base, seed);
      const loss = lossOf(stateOf(fixture));

      // Weapon slot, its magazine, the system slot, then the hold in stack order.
      expect(loss.items.map((item) => [item.definitionId, item.origin]), seed).toEqual([
        [AUTOCANNON, 'fitted'],
        [FUSION, 'loaded'],
        [SHIELD_BOOSTER, 'fitted'],
        ...CARGO.map(([definitionId]) => [definitionId, 'cargo']),
      ]);

      // Exactly one draw per rolled unit, all from the loot stream, and the
      // results are the ones the loot stream gives in that order.
      const rolled = loss.items.filter((item) => item.origin !== 'loaded');
      const replay = structuredClone(before.random) as MutableRandomStreams;
      const expected = rolled.map(() => drawChance(replay, 'loot', 0.5).outcome === 1);
      expect(rolled.map((item) => item.survived), seed).toEqual(expected);
      expect(fixture.draft.random.loot, seed).toEqual(replay.loot);
      expect(fixture.draft.random.loot.drawIndex - before.random.loot.drawIndex).toBe(rolled.length);
      for (const stream of RANDOM_STREAMS) {
        if (stream !== 'loot') expect(fixture.draft.random[stream], `${seed} ${stream}`).toEqual(before.random[stream]);
      }
    }
  });

  it('is deterministic for a seed [TECH-9.4, TECH-9.5]', () => {
    const { state: base } = survivalBase();
    const seed = 'bb22cc33dd44ee55ff6677889900aa11';
    const first = lossWithSeed(base, seed).fixture;
    const second = lossWithSeed(base, seed).fixture;
    expect(campaignStateHash(stateOf(second))).toBe(campaignStateHash(stateOf(first)));
    expect(stateOf(second).recovery).toEqual(stateOf(first).recovery);
  });

  it('keeps each unit near a 50% survival rate, uncorrelated with every other [FUNC-9.12]', () => {
    const { state: base } = survivalBase();
    const random = generator(2);
    const samples = 400;
    const outcomes: boolean[][] = [];
    for (let round = 0; round < samples; round += 1) {
      const loss = lossOf(stateOf(lossWithSeed(base, hexSeed(random)).fixture));
      outcomes.push(loss.items.filter((item) => item.origin !== 'loaded').map((item) => item.survived));
    }
    const width = outcomes[0]?.length ?? 0;
    expect(width).toBe(2 + CARGO.length);
    const rate = (index: number) => outcomes.filter((row) => row[index] === true).length / samples;
    for (let index = 0; index < width; index += 1) {
      expect(rate(index), `item ${String(index)}`).toBeGreaterThan(0.4);
      expect(rate(index), `item ${String(index)}`).toBeLessThan(0.6);
    }
    for (let a = 0; a < width; a += 1) {
      for (let b = a + 1; b < width; b += 1) {
        const joint = outcomes.filter((row) => row[a] === true && row[b] === true).length / samples;
        const pa = rate(a);
        const pb = rate(b);
        const correlation = (joint - pa * pb) / Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
        expect(Math.abs(correlation), `items ${String(a)} and ${String(b)}`).toBeLessThan(0.2);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (b) Ownership conservation                                                   */
/* -------------------------------------------------------------------------- */

const LOOSE: readonly string[] = [
  'item.salvage.alloy',
  'item.salvage.circuitry',
  'item.commodity.coolant',
  'module.turret.railgun.small',
  'module.propulsion.afterburner.small',
  'module.plating.armor.small',
  'ammo.hybrid.small.iron',
  FUSION,
  PHASED,
];

/** A random ship to lose: a random hold, a random reservation and possibly a second weapon. */
function randomLoss(random: () => number): { readonly base: CampaignState; readonly fixture: LossFixture } {
  let state = newCampaign(hexSeed(random));
  if (random() < 0.5) state = withCredits(state, integer(random, 0, 8_000));
  const draft = draftOf(state);
  const shipId = draft.assets.activeShipId as EntityId;
  const ship = draft.assets.ships[shipId]!;
  const hangar = hangarId(state);
  const service = inventoryService(draft, content);

  if (random() < 0.5) {
    // A second autocannon, loaded with phased rounds, some of them restricted.
    service.add(hangar, AUTOCANNON as DefinitionId, 1, granted(1), { recoveryGrant: random() < 0.5 });
    service.add(hangar, PHASED as DefinitionId, 10, granted(10));
    service.add(hangar, PHASED as DefinitionId, 15, granted(15), { recoveryGrant: true });
    const slots = Object.fromEntries(shipFit(draft.assets, shipId).map((fitted) => [slotKey(fitted.slot), {
      moduleId: fitted.moduleId,
      online: fitted.online,
      ammunitionId: fitted.charge?.ammunitionId ?? null,
    }]));
    slots[slotKey({ kind: 'weapon', index: 1 })] = { moduleId: AUTOCANNON as never, online: true, ammunitionId: PHASED as never };
    expect(applyDraftTo(draft, content, { shipId, baseRevision: draft.revision, slots })).toEqual([]);
  }
  const kinds = integer(random, 0, 5);
  for (let index = 0; index < kinds; index += 1) {
    const definitionId = pick(random, LOOSE) as DefinitionId;
    const quantity = definitionId.startsWith('ammo.') ? integer(random, 1, 60) : integer(random, 1, 3);
    service.add(ship.cargoInventoryId, definitionId, quantity, granted(quantity), { recoveryGrant: random() < 0.3 });
  }
  const cargo = stacksIn(draft.assets, ship.cargoInventoryId).filter((stack) => stack.quantity > 1);
  if (cargo.length > 0 && random() < 0.4) {
    const stack = pick(random, cargo);
    service.reserve(stack.id, integer(random, 1, stack.quantity - 1), shipId);
  }
  const docked = draft as unknown as CampaignState;
  expect(validateCampaign(docked, content)).toEqual([]);
  const fixture = inSite(docked, { spawn: false, playerPositionKm: { x: integer(random, -20, 20), y: integer(random, -20, 20) } });
  return { base: clone(stateOf(fixture)), fixture };
}

type Units = Map<string, number>;

function add(units: Units, key: string, quantity: number): void {
  units.set(key, (units.get(key) ?? 0) + quantity);
}

describe('ownership conservation', () => {
  it('puts every unit of the lost ship in the wreck or destroys it, and moves nothing else [FUNC-9.12, FUNC-22.2, FUNC-22.3, TECH-8.3]', () => {
    const random = generator(3);
    for (let round = 0; round < 60; round += 1) {
      const { base, fixture } = randomLoss(random);
      const label = `round ${String(round)}`;
      const stores = shipStores(base, fixture.playerId);
      resolveLossOnly(fixture);
      const after = stateOf(fixture);
      const loss = lossOf(after);
      const wreck = after.encounter.wrecks[loss.wreckId]!;
      const grantedShip = loss.recovery.outcome === 'granted' ? after.assets.ships[loss.recovery.activeShipId ?? ''] : undefined;
      const grantedStores = grantedShip === undefined
        ? new Set<string>()
        : new Set([grantedShip.cargoInventoryId, grantedShip.fittingInventoryId]);

      // Everything outside the ship is exactly where it was.
      const lostStacks: ItemStack[] = [];
      for (const stack of Object.values(base.assets.stacks)) {
        if (stores.has(stack.inventoryId)) {
          lostStacks.push(stack);
          continue;
        }
        expect(after.assets.stacks[stack.id], label).toEqual(stack);
      }
      // Nothing appears but the wreck's survivors and a granted ship's fit.
      for (const stack of Object.values(after.assets.stacks)) {
        if (base.assets.stacks[stack.id] !== undefined && !stores.has(base.assets.stacks[stack.id]!.inventoryId)) continue;
        expect(stack.inventoryId === wreck.inventoryId || grantedStores.has(stack.inventoryId), label).toBe(true);
      }

      // The record accounts for every stack the ship carried, by where it was.
      const carried: Units = new Map();
      for (const stack of lostStacks) {
        const origin = stack.state.kind === 'plain' ? 'cargo' : stack.state.kind === 'fitted' ? 'fitted' : 'loaded';
        add(carried, `${stack.definitionId}|${origin}|${String(stack.recoveryGrant)}`, stack.quantity);
      }
      const recorded: Units = new Map();
      const survived: Units = new Map();
      for (const item of loss.items) {
        add(recorded, `${item.definitionId}|${item.origin}|${String(item.recoveryGrant)}`, item.quantity);
        if (item.survived) add(survived, `${item.definitionId}|${String(item.recoveryGrant)}`, item.quantity);
        if (item.origin === 'loaded') expect(item.survived, label).toBe(false);
      }
      expect(recorded, label).toEqual(carried);
      expect(loss.items).toHaveLength(lostStacks.length);

      // The wreck holds exactly the survivors, plain, with their marks.
      const inWreck: Units = new Map();
      for (const stack of stacksIn(after.assets, wreck.inventoryId)) {
        expect(stack.state.kind, label).toBe('plain');
        add(inWreck, `${stack.definitionId}|${String(stack.recoveryGrant)}`, stack.quantity);
      }
      expect(inWreck, label).toEqual(survived);

      // No identity is used twice anywhere in the campaign.
      const ids = [
        ...Object.keys(after.assets.ships),
        ...Object.keys(after.assets.inventories),
        ...Object.keys(after.assets.stacks),
        ...Object.keys(after.encounter.wrecks),
        after.recovery.lastLoss?.lossId ?? '',
      ];
      expect(new Set(ids).size, label).toBe(ids.length);
      for (const inventoryId of stores) expect(after.assets.inventories[inventoryId], label).toBeUndefined();
      expect(validateCampaign(after, content), label).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (c) Non-exploitable restricted assets                                        */
/* -------------------------------------------------------------------------- */

interface Attempt {
  readonly state: CampaignState;
  readonly error: EngineError | null;
}

function attempt(state: CampaignState, type: CommandType, payload: unknown): Attempt {
  const result = runCommand({ campaign: state, content, type, payload });
  if (result.kind === 'failed') return { state, error: result.error };
  if (result.kind === 'unchanged' || result.campaign === null) return { state, error: null };
  return { state: result.campaign, error: null };
}

function advanceBy(state: CampaignState, milliseconds: number): CampaignState {
  let current = state;
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 250) {
    current = command(current, 'time.advance', { elapsedRealMs: 250 }).state;
  }
  return current;
}

/** Unmarked units of each definition, anywhere in the campaign. */
function unmarkedUnits(state: CampaignState): Units {
  const units: Units = new Map();
  for (const stack of Object.values(state.assets.stacks)) {
    if (!stack.recoveryGrant) add(units, stack.definitionId, stack.quantity);
  }
  return units;
}

function localAtStation(state: CampaignState, stack: ItemStack): boolean {
  const inventory = state.assets.inventories[stack.inventoryId];
  if (inventory === undefined) return false;
  if (inventory.location.kind === 'hangar') return inventory.location.stationId === HARBOUR;
  if (inventory.location.kind !== 'cargo') return false;
  const owner = state.assets.ships[inventory.location.shipId];
  return owner?.location.kind === 'station' && owner.location.stationId === HARBOUR;
}

const listed = new Set(Object.keys(newCampaign().economy.stations[HARBOUR]?.listings ?? {}));

interface Tally {
  mixedMergesRefused: number;
  markedSalesRefused: number;
  markedHullsRefused: number;
  lootedMarked: number;
  destroyed: number;
  spreadMagazines: number;
}

/**
 * Everything that must hold after any operation: no unmarked unit appeared
 * that was not bought, a marked unit is never sale value, a marked hull is
 * never insurance value, and the campaign is valid.
 */
function checkRestricted(
  before: CampaignState,
  after: CampaignState,
  bought: Units,
  label: string,
  tally: Tally,
): void {
  const previous = unmarkedUnits(before);
  for (const [definitionId, quantity] of unmarkedUnits(after)) {
    expect(quantity, `${label}: unmarked ${definitionId}`)
      .toBeLessThanOrEqual((previous.get(definitionId) ?? 0) + (bought.get(definitionId) ?? 0));
  }
  expect(validateCampaign(after, content), label).toEqual([]);
  if (after.assets.location.kind !== 'station') return;

  for (const stack of Object.values(after.assets.stacks)) {
    if (!stack.recoveryGrant || !listed.has(stack.definitionId) || !localAtStation(after, stack)) continue;
    const preview = marketSellPreview(after, content, { stationId: HARBOUR, stackId: stack.id, quantity: stack.quantity });
    expect(preview.available, `${label}: sell ${stack.id}`).toBe(false);
    expect(preview.token).toBeNull();
    if (stack.state.kind === 'plain') {
      expect(preview.unavailableReason, `${label}: sell ${stack.id}`).toBe(RECOVERY_SALE);
      tally.markedSalesRefused += 1;
    }
  }
  for (const ship of Object.values(after.assets.ships)) {
    if (ship.owner !== 'player' || ship.location.kind !== 'station') continue;
    const preview = insurancePreview(after, content, { shipId: ship.id });
    if (ship.recoveryGrant) {
      expect(preview.unavailableReason, `${label}: insure ${ship.id}`).toBe(RECOVERY_INSURANCE);
      expect(preview.enhancedPayoutCredits).toBe(0);
      tally.markedHullsRefused += 1;
    } else {
      expect(preview.unavailableReason, `${label}: insure ${ship.id}`).not.toBe(RECOVERY_INSURANCE);
    }
  }
}

interface Step {
  readonly state: CampaignState;
  readonly bought: Units;
}

const none = (): Units => new Map();

function activeOf(state: CampaignState) {
  const id = state.assets.activeShipId;
  return id === null ? undefined : state.assets.ships[id];
}

/** Plain stacks the player can handle here: the hangar and the active hold. */
function handled(state: CampaignState): readonly ItemStack[] {
  const ship = activeOf(state);
  const places = new Set([hangarId(state), ...(ship === undefined ? [] : [ship.cargoInventoryId])]);
  return Object.values(state.assets.stacks)
    .filter((stack) => places.has(stack.inventoryId) && stack.state.kind === 'plain')
    .sort((a, b) => a.id.localeCompare(b.id));
}

function split(state: CampaignState, random: () => number): Step {
  const candidates = handled(state).filter((stack) => stack.quantity > 1);
  if (candidates.length === 0) return { state, bought: none() };
  const stack = pick(random, candidates);
  const result = attempt(state, 'inventory.split', { stackId: stack.id, quantity: integer(random, 1, stack.quantity - 1) });
  expect(result.error).toBeNull();
  return { state: result.state, bought: none() };
}

function merge(state: CampaignState, random: () => number, tally: Tally): Step {
  const groups = new Map<string, ItemStack[]>();
  for (const stack of handled(state)) {
    const key = `${stack.inventoryId}|${stack.definitionId}`;
    groups.set(key, [...(groups.get(key) ?? []), stack]);
  }
  const pairs = [...groups.values()].filter((group) => group.length > 1);
  if (pairs.length === 0) return { state, bought: none() };
  const group = pick(random, pairs);
  // Prefer a mixed pair when there is one: it is the pair that must not merge.
  const marked = group.filter((stack) => stack.recoveryGrant);
  const plain = group.filter((stack) => !stack.recoveryGrant);
  const [source, target] = marked.length > 0 && plain.length > 0 && random() < 0.7
    ? [pick(random, marked), pick(random, plain)]
    : [group[0]!, group[1]!];
  const result = attempt(state, 'inventory.merge', { sourceStackId: source.id, targetStackId: target.id });
  if (source.recoveryGrant === target.recoveryGrant) {
    expect(result.error).toBeNull();
  } else {
    expect(reasonOf(result.error)).toBe('incompatibleStacks');
    tally.mixedMergesRefused += 1;
  }
  return { state: result.state, bought: none() };
}

function transfer(state: CampaignState, random: () => number): Step {
  const ship = activeOf(state);
  const candidates = handled(state);
  if (ship === undefined || candidates.length === 0) return { state, bought: none() };
  const stack = pick(random, candidates);
  const destination = stack.inventoryId === ship.cargoInventoryId ? hangarId(state) : ship.cargoInventoryId;
  const result = attempt(state, 'inventory.transfer', {
    stackId: stack.id,
    destinationInventoryId: destination,
    quantity: integer(random, 1, stack.quantity),
  });
  return { state: result.state, bought: none() };
}

/** Changes one slot in a fitting draft and commits it, reverting when the items are missing. */
function refit(state: CampaignState, random: () => number): Step {
  const ship = activeOf(state);
  if (ship === undefined) return { state, bought: none() };
  let current = attempt(state, 'fitting.begin', { shipId: ship.id }).state;
  const roll = random();
  if (roll < 0.45) {
    const ammunition = pick(random, [FUSION, PHASED, null]);
    current = attempt(current, 'fitting.set', {
      slotKind: 'weapon',
      slotIndex: integer(random, 0, 1),
      moduleId: AUTOCANNON,
      online: true,
      ...(ammunition === null ? {} : { ammunitionId: ammunition }),
    }).state;
  } else if (roll < 0.65) {
    current = attempt(current, 'fitting.set', {
      slotKind: 'system', slotIndex: integer(random, 0, 1), moduleId: SHIELD_BOOSTER, online: true,
    }).state;
  } else {
    current = attempt(current, 'fitting.clear', {
      slotKind: pick(random, ['weapon', 'system']), slotIndex: integer(random, 0, 1),
    }).state;
  }
  const committed = attempt(current, 'fitting.commit', {});
  if (committed.error === null) return { state: committed.state, bought: none() };
  return { state: attempt(current, 'fitting.revert', {}).state, bought: none() };
}

function resupply(state: CampaignState): Step {
  const ship = activeOf(state);
  if (ship === undefined) return { state, bought: none() };
  const preview = resupplyPreview(state, content, { shipId: ship.id });
  if (!preview.available || preview.token === null) return { state, bought: none() };
  const bought: Units = new Map();
  for (const line of preview.lines) {
    if (line.ammunitionId !== null) add(bought, line.ammunitionId, line.roundsPurchased);
  }
  return { state: command(state, 'resupply.confirm', { token: preview.token }).state, bought };
}

function purchase(state: CampaignState, random: () => number): Step {
  const [itemId, quantity] = pick(random, [
    [FUSION, integer(random, 10, 60)],
    [PHASED, integer(random, 10, 60)],
    [AUTOCANNON, 1],
    [SHIELD_BOOSTER, 1],
  ] as const);
  const preview = marketBuyPreview(state, content, { stationId: HARBOUR, itemId, quantity });
  if (!preview.available || preview.token === null) return { state, bought: none() };
  const bought: Units = new Map([[itemId, quantity]]);
  return { state: command(state, 'market.confirmBuy', { token: preview.token }).state, bought };
}

function sellUnmarked(state: CampaignState, random: () => number): Step {
  const candidates = handled(state).filter((stack) => !stack.recoveryGrant && listed.has(stack.definitionId));
  if (candidates.length === 0) return { state, bought: none() };
  const stack = pick(random, candidates);
  const preview = marketSellPreview(state, content, { stationId: HARBOUR, stackId: stack.id, quantity: 1 });
  if (!preview.available || preview.token === null) return { state, bought: none() };
  return { state: command(state, 'market.confirmSell', { token: preview.token }).state, bought: none() };
}

/** Breaks the active ship's hull in its site and lets the next quantum destroy it. */
function loseShip(state: CampaignState, lowOnCredits: boolean): CampaignState {
  const draft = draftOf(lowOnCredits ? withCredits(state, 500) : state);
  const playerId = draft.assets.activeShipId as EntityId;
  breakHull({ draft, content, context: lossContext(draft, content), playerId });
  return command(draft as unknown as CampaignState, 'time.advance', { elapsedRealMs: 250 }).state;
}

/**
 * Undocks into the station's own site, loots the player's wrecks lying there,
 * changes or reloads ammunition, and then either docks again or is destroyed
 * there - leaving a wreck of its own for a later sortie.
 */
function sortie(state: CampaignState, random: () => number, label: string, tally: Tally): Step {
  const undocked = attempt(state, 'ship.undock', {});
  if (undocked.error !== null) return { state, bought: none() };
  let current = undocked.state;
  const check = (next: CampaignState, what: string) => {
    checkRestricted(current, next, none(), `${label} ${what}`, tally);
    current = next;
  };

  for (const wreck of playerWrecks(current).filter((entry) => entry.siteId === STATION_SITE_ID)) {
    for (const stack of stacksIn(current.assets, wreck.inventoryId)) {
      const taken = attempt(current, 'loot.take', { wreckId: wreck.id, stackId: stack.id, quantity: stack.quantity });
      if (taken.error === null && stack.recoveryGrant) tally.lootedMarked += stack.quantity;
      check(taken.state, 'loot');
    }
  }

  const ship = activeOf(current);
  const weapons = ship === undefined ? [] : shipFit(current.assets, ship.id)
    .filter((fitted) => fitted.slot.kind === 'weapon');
  if (weapons.length > 0 && random() < 0.7) {
    const weapon = pick(random, weapons);
    const markedBefore = weapon.charge !== null && current.assets.stacks[weapon.charge.stackId ?? '']?.recoveryGrant === true;
    const changed = random() < 0.6
      ? attempt(current, 'weapon.changeAmmunition', {
          slotKind: 'weapon', slotIndex: weapon.slot.index, ammunitionId: pick(random, [FUSION, PHASED]),
        })
      : attempt(current, 'weapon.reload', { slotKind: 'weapon', slotIndex: weapon.slot.index });
    check(changed.state, 'ammunition');
    check(advanceBy(current, 6_000), 'reloaded');
    const after = shipFit(current.assets, ship?.id ?? '').find((fitted) => slotKey(fitted.slot) === slotKey(weapon.slot));
    const markedAfter = after?.charge !== null && after?.charge !== undefined &&
      current.assets.stacks[after.charge.stackId ?? '']?.recoveryGrant === true;
    if (!markedBefore && markedAfter) tally.spreadMagazines += 1;
  }

  if (random() < 0.4) {
    tally.destroyed += 1;
    check(loseShip(current, random() < 0.5), 'destroyed');
    return { state: current, bought: none() };
  }
  const docking = attempt(current, 'navigation.dock', { stationId: HARBOUR });
  expect(docking.error).toBeNull();
  check(docking.state, 'dock');
  for (let elapsed = 0; elapsed < 60_000 && current.assets.location.kind !== 'station'; elapsed += 250) {
    current = command(current, 'time.advance', { elapsedRealMs: 250 }).state;
  }
  expect(current.assets.location.kind, `${label} docked`).toBe('station');
  return { state: current, bought: none() };
}

/** The recovery-granted starting point: a pilot recovered once, then given money to play with. */
function grantedStart(seed: string): CampaignState {
  let state = command(withCredits(newCampaign(seed), 1_000), 'time.set', { paused: false, rate: 1 }).state;
  state = command(state, 'ship.undock', {}).state;
  state = loseShip(state, false);
  expect(lossOf(state).recovery.outcome).toBe('granted');
  state = withCredits(state, 60_000);
  // Unmarked spares of the same kinds as the granted fit.
  state = buy(state, AUTOCANNON, 1).state;
  state = buy(state, SHIELD_BOOSTER, 1).state;
  state = buy(state, PHASED, 40).state;
  return state;
}

describe('non-exploitable restricted assets', () => {
  it('never washes the recovery-grant mark out through any sequence of included operations [FUNC-9.12, FUNC-22.3, TECH-8.3, TECH-10.9]', () => {
    const tally: Tally = {
      mixedMergesRefused: 0, markedSalesRefused: 0, markedHullsRefused: 0,
      lootedMarked: 0, destroyed: 0, spreadMagazines: 0,
    };
    for (let sequence = 0; sequence < 10; sequence += 1) {
      const random = generator(100 + sequence);
      let state = grantedStart(hexSeed(random));
      for (let step = 0; step < 40; step += 1) {
        const label = `sequence ${String(sequence)} step ${String(step)}`;
        const before = state;
        if (state.assets.activeShipId === null) {
          // A shipless pilot can always buy the starter hull, and flies it.
          const next = buy(state, STARTER_HULL, 1).state;
          expect(next.assets.activeShipId).not.toBeNull();
          checkRestricted(before, next, none(), `${label} hull`, tally);
          state = next;
          continue;
        }
        if (state.assets.credits < 20_000) state = withCredits(state, 60_000);
        const roll = random();
        const step_: Step = roll < 0.12 ? split(state, random)
          : roll < 0.3 ? merge(state, random, tally)
          : roll < 0.42 ? transfer(state, random)
          : roll < 0.6 ? refit(state, random)
          : roll < 0.67 ? resupply(state)
          : roll < 0.75 ? purchase(state, random)
          : roll < 0.8 ? sellUnmarked(state, random)
          : sortie(state, random, label, tally);
        checkRestricted(state, step_.state, step_.bought, label, tally);
        state = step_.state;
      }
    }
    // Each property was actually exercised, not vacuously true.
    expect(tally.mixedMergesRefused).toBeGreaterThan(0);
    expect(tally.markedSalesRefused).toBeGreaterThan(0);
    expect(tally.markedHullsRefused).toBeGreaterThan(0);
    expect(tally.destroyed).toBeGreaterThan(0);
    expect(tally.lootedMarked).toBeGreaterThan(0);
    expect(tally.spreadMagazines).toBeGreaterThan(0);
  }, 120_000);

  it('marks a magazine that takes marked rounds and keeps a marked one marked [FUNC-9.12, TECH-8.3]', () => {
    const state = grantedStart('0123456789abcdef0123456789abcdef');
    const ship = activeOf(state)!;
    // Unfit the marked magazine to the hangar, then load unmarked rounds.
    let current = command(state, 'fitting.begin', { shipId: ship.id }).state;
    current = command(current, 'fitting.set', {
      slotKind: 'weapon', slotIndex: 0, moduleId: AUTOCANNON, online: true, ammunitionId: PHASED,
    }).state;
    current = command(current, 'fitting.commit', {}).state;
    const loaded = shipFit(current.assets, ship.id).find((fitted) => fitted.slot.kind === 'weapon');
    const magazine = current.assets.stacks[loaded?.charge?.stackId ?? ''];
    expect(magazine?.definitionId).toBe(PHASED);
    // The rounds taken were the unmarked ones bought; the fusion that came
    // out is still marked, and nothing unmarked came out of it.
    const fusion = stacksIn(current.assets, hangarId(current)).filter((stack) => stack.definitionId === FUSION);
    expect(fusion.filter((stack) => stack.recoveryGrant).reduce((sum, stack) => sum + stack.quantity, 0)).toBe(20);
    // Firing some of the magazine and resupplying it from unmarked hangar
    // rounds leaves a marked magazine marked.
    const marked = grantedStart('fedcba9876543210fedcba9876543210');
    const markedShip = activeOf(marked)!;
    const charge = shipFit(marked.assets, markedShip.id)[0]?.charge;
    const draft = draftOf(marked);
    inventoryService(draft, content).remove(charge?.stackId ?? '', 5);
    const fired = draft as unknown as CampaignState;
    const preview = resupplyPreview(fired, content, { shipId: markedShip.id });
    expect(preview.available).toBe(true);
    const resupplied = command(fired, 'resupply.confirm', { token: preview.token }).state;
    const topped = shipFit(resupplied.assets, markedShip.id).find((fitted) => fitted.charge !== null)?.charge;
    expect(topped?.quantity).toBe(20);
    expect(resupplied.assets.stacks[topped?.stackId ?? '']?.recoveryGrant).toBe(true);
  });

  it('refuses enhanced cover for a granted hull and a sale of a granted unit [FUNC-9.12]', () => {
    const state = grantedStart('aa22cc33dd44ee55ff6677889900aa11');
    const ship = activeOf(state)!;
    const insurance = insurancePreview(state, content, { shipId: ship.id });
    expect(insurance).toMatchObject({
      available: false, unavailableReason: RECOVERY_INSURANCE, token: null, basicPayoutCredits: 0, enhancedPayoutCredits: 0,
    });
    // Unfit the granted autocannon into the hangar; it stays unsellable there.
    let current = command(state, 'fitting.begin', { shipId: ship.id }).state;
    current = command(current, 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 }).state;
    current = command(current, 'fitting.commit', {}).state;
    const cannons = stacksIn(current.assets, hangarId(current)).filter((stack) => stack.definitionId === AUTOCANNON);
    expect(cannons.map((stack) => stack.recoveryGrant).sort()).toEqual([false, true]);
    for (const stack of cannons) {
      const preview = marketSellPreview(current, content, { stationId: HARBOUR, stackId: stack.id, quantity: 1 });
      expect(preview.available).toBe(!stack.recoveryGrant);
      if (stack.recoveryGrant) expect(preview.unavailableReason).toBe(RECOVERY_SALE);
    }
    // And the two never become one stack.
    const [marked, unmarked] = [cannons.find((stack) => stack.recoveryGrant)!, cannons.find((stack) => !stack.recoveryGrant)!];
    expect(reasonOf(attempt(current, 'inventory.merge', { sourceStackId: marked.id, targetStackId: unmarked.id }).error))
      .toBe('incompatibleStacks');
  });
});

/* -------------------------------------------------------------------------- */
/* (d) Inaccessible-state prevention                                            */
/* -------------------------------------------------------------------------- */

function starterQuote(state: CampaignState): number {
  return marketBuyPreview(state, content, { stationId: HARBOUR, itemId: STARTER_HULL, quantity: 1 }).totalCredits;
}

describe('inaccessible-state prevention', () => {
  it('sells the starter hull at the recovery station for no more than its reference value [FUNC-9.12, FUNC-11.2, FUNC-22.1]', () => {
    expect(starterQuote(newCampaign())).toBeLessThanOrEqual(REFERENCE);
  });

  it('always leaves an active ship or the credits for one, after any loss or purchase [FUNC-9.12, FUNC-22.1, TECH-15.3]', () => {
    const random = generator(7);
    const seen = { granted: 0, otherShip: 0, noShip: 0, grantedByPurchase: 0, hullActivated: 0 };
    for (let round = 0; round < 40; round += 1) {
      const label = `round ${String(round)}`;
      let state = withCredits(newCampaign(hexSeed(random)), integer(random, 0, 32_000));
      if (random() < 0.3 && state.assets.credits >= 1_800) state = insureEnhanced(state).state;
      if (random() < 0.3 && state.assets.credits >= starterQuote(state)) state = buy(state, STARTER_HULL, 1).state;
      const fixture = inSite(state, { spawn: false });
      resolveLossOnly(fixture);
      state = stateOf(fixture);
      const loss = lossOf(state);
      seen[loss.recovery.outcome] += 1;

      const assertReachable = (current: CampaignState, what: string) => {
        expect(current.assets.activeShipId !== null || current.assets.credits >= REFERENCE, `${label} ${what}`).toBe(true);
        expect(validateCampaign(current, content), `${label} ${what}`).toEqual([]);
        expect(starterQuote(current)).toBeLessThanOrEqual(REFERENCE);
        if (current.assets.activeShipId === null) {
          const preview = marketBuyPreview(current, content, { stationId: HARBOUR, itemId: STARTER_HULL, quantity: 1 });
          expect(preview.available, `${label} ${what}`).toBe(true);
        }
      };
      assertReachable(state, 'loss');
      const owned = Object.values(state.assets.ships).filter((ship) => ship.owner === 'player');
      expect(loss.recovery.outcome === 'granted', label)
        .toBe(owned.length === 1 && loss.recovery.creditsAfter < REFERENCE && owned[0]?.recoveryGrant === true);

      // Shopping while shipless.
      for (let purchaseIndex = 0; purchaseIndex < 5 && state.assets.activeShipId === null; purchaseIndex += 1) {
        const [itemId, quantity] = pick(random, [
          [AUTOCANNON, 1], [SHIELD_BOOSTER, 1], [FUSION, integer(random, 20, 400)],
          ['module.propulsion.afterburner.small', 1], [STARTER_HULL, 1],
        ] as const);
        const preview = marketBuyPreview(state, content, { stationId: HARBOUR, itemId, quantity });
        if (!preview.available || preview.token === null) continue;
        const result = command(state, 'market.confirmBuy', { token: preview.token });
        const kinds = result.data.events.map((event) => event.kind);
        const after = result.state;
        if (itemId === STARTER_HULL) {
          const bought = Object.keys(after.assets.ships).find((id) => state.assets.ships[id] === undefined);
          expect(after.assets.activeShipId, label).toBe(bought);
          expect(after.assets.ships[bought ?? '']?.recoveryGrant).toBe(false);
          expect(kinds).toContain('recovery.activeShipChanged');
          seen.hullActivated += 1;
        } else if (after.assets.credits < REFERENCE) {
          const grantedShip = activeOf(after);
          expect(grantedShip?.recoveryGrant, label).toBe(true);
          expect(grantedShip?.hullId).toBe(STARTER_HULL);
          expect(kinds).toContain('recovery.shipGranted');
          seen.grantedByPurchase += 1;
        } else {
          expect(after.assets.activeShipId, label).toBeNull();
          expect(kinds).not.toContain('recovery.shipGranted');
        }
        assertReachable(after, `purchase ${itemId}`);
        state = after;
      }
    }
    expect(seen.granted).toBeGreaterThan(0);
    expect(seen.otherShip).toBeGreaterThan(0);
    expect(seen.noShip).toBeGreaterThan(0);
    expect(seen.grantedByPurchase).toBeGreaterThan(0);
    expect(seen.hullActivated).toBeGreaterThan(0);
  });

  it('grants the starter ship when a shipless pilot spends below the reference value [FUNC-9.12, FUNC-22.1]', () => {
    const fixture = inSite(withCredits(newCampaign(), 9_000), { spawn: false });
    resolveLossOnly(fixture);
    let state = stateOf(fixture);
    expect(state.assets.activeShipId).toBeNull();
    expect(state.assets.credits).toBe(12_600);
    const result = buy(state, FUSION, 100);
    state = result.state;
    expect(state.assets.credits).toBeLessThan(REFERENCE);
    const grantedShip = activeOf(state);
    expect(grantedShip).toMatchObject({ hullId: STARTER_HULL, recoveryGrant: true, location: { kind: 'station', stationId: HARBOUR } });
    expect(result.data.events.find((event) => event.kind === 'recovery.shipGranted')?.params)
      .toEqual({ shipId: grantedShip?.id, stationId: HARBOUR });
    // The rounds bought are ordinary, unmarked goods in the hangar.
    expect(stacksIn(state.assets, hangarId(state)).filter((stack) => stack.definitionId === FUSION && !stack.recoveryGrant)
      .reduce((sum, stack) => sum + stack.quantity, 0)).toBe(200);
    expect(validateCampaign(state, content)).toEqual([]);
  });

  it('refuses an invariant state a shipless pilot below the reference value would be [TECH-15.3]', () => {
    const fixture = inSite(newCampaign(), { spawn: false });
    resolveLossOnly(fixture);
    const draft: CampaignDraft = draftOf(stateOf(fixture));
    draft.assets.credits = REFERENCE - 1;
    expect(validateCampaign(draft as unknown as CampaignState, content).map((issue) => issue.path))
      .toContain('assets.activeShipId');
  });
});
