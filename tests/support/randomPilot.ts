import type { CampaignState, ContentRepository } from '@engine';
import { EconomyError, InventoryError } from '@engine/domain';
import {
  assetsProjection,
  combatProjection,
  destinationsProjection,
  encounterProjection,
  fittingDraftProjection,
  insurancePreview,
  marketBuyPreview,
  marketListingsProjection,
  marketSellPreview,
  onboardingProjection,
  repairPreview,
  resupplyPreview,
  siteProjection,
  wreckContentsProjection,
} from '@engine/projections';
import type { PreviewTokenData, StackData } from '@protocol';

/**
 * A random pilot (Technical Specification 15.1, property tests).
 *
 * It plays the whole loop without a plan: it buys, sells, moves goods, opens
 * and abandons fitting drafts, undocks, warps, locks, fires, loots, retreats
 * and docks, in whatever order its generator picks. Most of what it asks for
 * is taken from the projections the interface reads, so most of it is legal;
 * some of it is deliberately not - a stale token, a target that is not there,
 * an order given from inside a station - because a refusal is as much a part
 * of the contract as an acceptance.
 *
 * The generator is its own and is seeded, so a run is repeatable and takes
 * nothing from the campaign's random streams.
 */

export interface PilotAction {
  readonly type: string;
  readonly payload: unknown;
  /**
   * What the wallet must change by if the command commits, when the command
   * said so beforehand in a preview.
   */
  readonly walletDeltaCredits?: number;
}

export type Generator = () => number;

/** mulberry32: small, fast and the same in every JavaScript engine. */
export function generatorOf(seed: number): Generator {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Candidate = readonly [weight: number, make: () => PilotAction | null];

export interface RandomPilot {
  next(state: CampaignState): PilotAction;
}

export interface PilotStart {
  /** What the pilot sets out to do first; a pilot placed in a site starts by fighting. */
  readonly intent: 'visit' | 'fight';
  /** How many steps it gives that before moving on. */
  readonly budget: number;
}

export function randomPilot(content: ContentRepository, random: Generator, start?: PilotStart): RandomPilot {
  const pick = <T>(values: readonly T[]): T | undefined =>
    values.length === 0 ? undefined : values[Math.floor(random() * values.length)];
  const whole = (minimum: number, maximum: number): number =>
    minimum + Math.floor(random() * (maximum - minimum + 1));

  /** Tokens the pilot was handed and has since moved past, to be offered again later. */
  const spent: { type: string; token: PreviewTokenData }[] = [];
  const remember = (type: string, token: PreviewTokenData): void => {
    spent.push({ type, token });
    if (spent.length > 8) spent.shift();
  };

  const stationId = content.rules.economy.startingStationId;

  const docked = (state: CampaignState): Candidate[] => {
    const assets = assetsProjection(state, content);
    const shipId = assets.activeShipId;
    const ship = assets.ships.find((entry) => entry.id === shipId);
    const local = assets.inventories.filter((inventory) =>
      (inventory.location.kind === 'hangar' && inventory.location.stationId === stationId) ||
      (inventory.location.kind === 'cargo' && inventory.location.shipId === shipId));
    const plain: StackData[] = local.flatMap((inventory) => inventory.stacks).filter((stack) => stack.state.kind === 'plain');
    const destinations = destinationsProjection(state, content);

    const economic = (
      type: string,
      preview: { available: boolean; token: PreviewTokenData | null; walletDeltaCredits: number },
    ): PilotAction | null => {
      if (preview.token === null) return null;
      remember(type, preview.token);
      return preview.available
        ? { type, payload: { token: preview.token }, walletDeltaCredits: preview.walletDeltaCredits }
        : { type, payload: { token: preview.token } };
    };

    return [
      [4, () => {
        const listing = pick(marketListingsProjection(state, content, stationId).listings);
        if (listing === undefined) return null;
        const quantity = listing.item.kind === 'ammunition' ? whole(1, 80) : whole(1, 2);
        const destination = random() < 0.3 && ship !== undefined ? { destinationInventoryId: ship.cargoInventoryId } : {};
        return economic('market.confirmBuy', marketBuyPreview(state, content, {
          stationId, itemId: listing.item.definitionId, quantity, ...destination,
        }));
      }],
      [3, () => {
        const stack = pick(plain);
        if (stack === undefined) return null;
        return economic('market.confirmSell', marketSellPreview(state, content, {
          stationId, stackId: stack.id, quantity: whole(1, stack.quantity),
        }));
      }],
      [3, () => {
        const stack = pick(plain);
        const destination = pick(local.filter((inventory) => inventory.id !== stack?.inventoryId));
        if (stack === undefined || destination === undefined) return null;
        return { type: 'inventory.transfer', payload: {
          stackId: stack.id, destinationInventoryId: destination.id, quantity: whole(1, stack.quantity),
        } };
      }],
      [1, () => {
        const stack = pick(plain.filter((entry) => entry.quantity > 1));
        return stack === undefined ? null
          : { type: 'inventory.split', payload: { stackId: stack.id, quantity: whole(1, stack.quantity - 1) } };
      }],
      [1, () => {
        const source = pick(plain);
        const target = pick(plain.filter((entry) =>
          entry.id !== source?.id && entry.item.definitionId === source?.item.definitionId));
        return source === undefined || target === undefined ? null
          : { type: 'inventory.merge', payload: { sourceStackId: source.id, targetStackId: target.id } };
      }],
      [4, () => {
        if (shipId === null) return null;
        const draft = fittingDraftProjection(state, content).draft;
        if (draft === null) return { type: 'fitting.begin', payload: { shipId } };
        const roll = random();
        if (roll < 0.2) return { type: 'fitting.commit', payload: {} };
        if (roll < 0.3) return { type: 'fitting.revert', payload: {} };
        const option = pick(draft.options);
        if (option === undefined) return null;
        const slot = { slotKind: option.slot.kind, slotIndex: option.slot.index };
        const candidate = pick(option.candidates);
        if (candidate === undefined || roll < 0.45) return { type: 'fitting.clear', payload: slot };
        const charge = pick(candidate.charges);
        return { type: 'fitting.set', payload: {
          ...slot,
          moduleId: candidate.module.definitionId,
          online: random() < 0.9,
          ...(charge === undefined || random() < 0.2 ? {} : { ammunitionId: charge.definitionId }),
        } };
      }],
      [3, () => shipId === null ? null : economic('repair.confirm', repairPreview(state, content, { shipId }))],
      [3, () => shipId === null ? null : economic('resupply.confirm', resupplyPreview(state, content, { shipId }))],
      [0.5, () => shipId === null ? null : economic('insurance.confirm', insurancePreview(state, content, { shipId }))],
      [2, () => {
        const destination = pick(destinations.destinations);
        return destination === undefined ? null
          : { type: 'navigation.selectDestination', payload: { encounterId: destination.encounterId } };
      }],
      [0.5, () => {
        const bookmark = pick(destinations.bookmarks);
        return bookmark === undefined ? null
          : { type: 'navigation.selectBookmark', payload: { bookmarkId: bookmark.bookmarkId } };
      }],
      [2.5, () => ({ type: 'ship.undock', payload: {} })],
      // Orders that only make sense in space, given from inside a station.
      [0.3, () => ({ type: 'movement.stop', payload: {} })],
      [0.3, () => ({ type: 'navigation.retreat', payload: {} })],
    ];
  };

  const inSpace = (state: CampaignState): Candidate[] => {
    const site = siteProjection(state, content);
    const combat = combatProjection(state, content);
    const encounter = encounterProjection(state, content);
    const destinations = destinationsProjection(state, content);
    const objects = site.site?.objects ?? [];
    const others = objects.filter((object) => !object.player);
    const ships = others.filter((object) => object.kind === 'ship');
    const station = objects.find((object) => object.kind === 'station');
    const locked = combat.locks.map((lock) => lock.targetId);
    // Mostly close in, where the guns it was given can hit; sometimes anywhere.
    const range = (): number =>
      (random() < 0.7 ? pick(site.rangePresetsKm.slice(0, 2)) : pick(site.rangePresetsKm)) ?? 5;
    const hostile = ships.filter((object) => object.attitude === 'hostile');
    const arrival = (): number => pick(site.arrivalDistancesKm) ?? 0;
    const weaponSlot = (): { slotKind: string; slotIndex: number } | null => {
      const weapon = pick(combat.weapons);
      return weapon === undefined ? null : { slotKind: weapon.slot.kind, slotIndex: weapon.slot.index };
    };

    return [
      [3, () => {
        const target = (random() < 0.7 ? pick(hostile) : undefined) ?? pick(others);
        const kind = pick(['approach', 'orbit', 'keepRange'] as const);
        return target === undefined || kind === undefined ? null
          : { type: `movement.${kind}`, payload: { targetId: target.id, distanceKm: range() } };
      }],
      [0.3, () => ({ type: 'movement.moveToPoint', payload: { xKm: whole(-60, 60), yKm: whole(-60, 60) } })],
      [0.2, () => ({ type: 'movement.stop', payload: {} })],
      [0.2, () => {
        const destination = pick(destinations.destinations);
        return destination === undefined ? null
          : { type: 'navigation.warp', payload: { destinationSiteId: destination.siteId, arrivalDistanceKm: arrival() } };
      }],
      [0.2, () => {
        const bookmark = pick(destinations.bookmarks);
        return bookmark === undefined ? null
          : { type: 'navigation.warpToBookmark', payload: { bookmarkId: bookmark.bookmarkId, arrivalDistanceKm: arrival() } };
      }],
      [0.15, () => ({ type: 'navigation.retreat', payload: {} })],
      [1.5, () => station === undefined ? null : { type: 'navigation.dock', payload: { stationId: station.id } }],
      [5, () => {
        const target = pick(ships);
        return target === undefined ? null : { type: 'targeting.lock', payload: { targetId: target.id } };
      }],
      [0.2, () => {
        const target = pick(locked);
        return target === undefined ? null : { type: 'targeting.unlock', payload: { targetId: target } };
      }],
      [6, () => {
        const slot = weaponSlot();
        const target = pick(locked) ?? pick(others)?.id;
        return slot === null || target === undefined ? null
          : { type: 'weapon.activate', payload: { ...slot, targetId: target } };
      }],
      [0.2, () => {
        const slot = weaponSlot();
        return slot === null ? null : { type: 'weapon.deactivate', payload: slot };
      }],
      [0.5, () => {
        const slot = weaponSlot();
        return slot === null ? null : { type: 'weapon.reload', payload: slot };
      }],
      [0.4, () => {
        const weapon = pick(combat.weapons);
        const ammunitionId = pick(weapon?.compatibleAmmunition ?? []);
        return weapon === undefined || ammunitionId === undefined ? null
          : { type: 'weapon.changeAmmunition', payload: { slotKind: weapon.slot.kind, slotIndex: weapon.slot.index, ammunitionId } };
      }],
      [2, () => {
        // The protocol addresses an operated module by its system slot; a
        // passive one elsewhere has nothing to switch.
        const module = pick(combat.modules.filter((entry) => entry.slot.kind === 'system'));
        return module === undefined ? null : {
          type: random() < 0.7 ? 'module.activate' : 'module.deactivate',
          payload: { slotKind: module.slot.kind, slotIndex: module.slot.index },
        };
      }],
      [encounter.wrecks.length > 0 ? 9 : 0, () => {
        const wreck = pick(encounter.wrecks);
        if (wreck === undefined) return null;
        const contents = wreckContentsProjection(state, content, wreck.wreckId);
        const stack = pick(contents.stacks);
        if (stack === undefined) return { type: 'movement.approach', payload: { targetId: wreck.wreckId, distanceKm: 0 } };
        if (!contents.accessible && random() < 0.8) {
          return { type: 'movement.approach', payload: { targetId: wreck.wreckId, distanceKm: site.rangePresetsKm[0] ?? 0 } };
        }
        return { type: 'loot.take', payload: { wreckId: wreck.wreckId, stackId: stack.id, quantity: whole(1, stack.quantity) } };
      }],
      // A station service asked for from space.
      [0.3, () => ({ type: 'fitting.commit', payload: {} })],
    ];
  };

  const anywhere = (state: CampaignState, advanceWeight: number): Candidate[] => [
    [advanceWeight, () => ({ type: 'time.advance', payload: { elapsedRealMs: pick([250, 250, 250, 100, 37, 1]) ?? 250 } })],
    [0.6, () => ({ type: 'time.set', payload: { paused: random() < 0.25, rate: 1 } })],
    [0.3, () => {
      const onboarding = onboardingProjection(state, content);
      const step = pick(onboarding.chains.flatMap((chain) => chain.steps));
      const roll = random();
      if (roll < 0.3) return { type: 'onboarding.hide', payload: {} };
      if (roll < 0.6) return { type: 'onboarding.show', payload: {} };
      return step === undefined ? null : { type: 'onboarding.skipStep', payload: { stepId: step.id } };
    }],
    // A token the campaign has moved past, confirmed again (Technical Specification 7.4).
    [0.4, () => {
      const old = pick(spent);
      return old === undefined ? null : { type: old.type, payload: { token: old.token } };
    }],
    // Things that are not there.
    [0.3, () => pick<PilotAction>([
      { type: 'targeting.lock', payload: { targetId: `${state.campaignId}-e999999` } },
      { type: 'inventory.transfer', payload: { stackId: `${state.campaignId}-e999999`, destinationInventoryId: `${state.campaignId}-e999998`, quantity: 1 } },
      { type: 'navigation.selectDestination', payload: { encounterId: 'encounter.nowhere.nothing' } },
      { type: 'navigation.warp', payload: { destinationSiteId: 'site.nowhere.nothing', arrivalDistanceKm: 0 } },
      { type: 'loot.take', payload: { wreckId: `${state.campaignId}-e999999`, stackId: `${state.campaignId}-e999998`, quantity: 1 } },
      { type: 'onboarding.skipStep', payload: { stepId: 'guide.nowhere.nothing' } },
      { type: 'time.set', payload: { paused: false, rate: 8 } },
    ]) ?? null],
  ];

  const choose = (candidates: readonly Candidate[]): PilotAction | null => {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const total = candidates.reduce((sum, [weight]) => sum + weight, 0);
      let roll = random() * total;
      for (const [weight, make] of candidates) {
        roll -= weight;
        if (roll > 0) continue;
        let action: PilotAction | null;
        try {
          action = make();
        } catch (error: unknown) {
          // A projection refuses a request it cannot answer the way the host
          // would; anything else thrown while reading is a defect.
          if (!(error instanceof InventoryError) && !(error instanceof EconomyError)) throw error;
          action = null;
        }
        if (action !== null) return action;
        break;
      }
    }
    return null;
  };

  const ADVANCE: PilotAction = { type: 'time.advance', payload: { elapsedRealMs: 250 } };

  /**
   * The next thing a pilot who wants to win would do: lock the nearest
   * hostile, close on it, keep the guns on it and run the booster when the
   * shield is down. Half of a fight is this, so that opponents die, wrecks
   * appear and ships come home damaged; the other half is the random menu.
   */
  const fightSensibly = (state: CampaignState): PilotAction | null => {
    const site = siteProjection(state, content);
    const combat = combatProjection(state, content);
    const nearest = (site.site?.objects ?? [])
      .filter((object) => object.kind === 'ship' && object.attitude === 'hostile')
      .sort((left, right) => left.rangeFromPlayerKm - right.rangeFromPlayerKm || left.id.localeCompare(right.id))[0];
    if (nearest === undefined) return null;

    const lock = combat.locks.find((entry) => entry.targetId === nearest.id);
    if (lock === undefined) {
      return nearest.rangeFromPlayerKm <= combat.maxLockRangeKm
        ? { type: 'targeting.lock', payload: { targetId: nearest.id } }
        : { type: 'movement.approach', payload: { targetId: nearest.id, distanceKm: site.rangePresetsKm[0] ?? 0 } };
    }
    const order = site.movementOrder;
    if (order === null || !('targetId' in order) || order.targetId !== nearest.id) {
      return { type: 'movement.orbit', payload: { targetId: nearest.id, distanceKm: site.rangePresetsKm[0] ?? 1 } };
    }
    if (lock.status === 'locked') {
      const idle = combat.weapons.find((weapon) => weapon.online && !(weapon.repeating && weapon.targetId === nearest.id));
      if (idle !== undefined) {
        return idle.loadedRounds === 0 && idle.reload === null
          ? { type: 'weapon.reload', payload: { slotKind: idle.slot.kind, slotIndex: idle.slot.index } }
          : { type: 'weapon.activate', payload: { slotKind: idle.slot.kind, slotIndex: idle.slot.index, targetId: nearest.id } };
      }
    }
    const shield = combat.defenses?.layers.find((layer) => layer.layer === 'shield')?.fractionRemaining ?? 1;
    const booster = combat.modules.find((module) =>
      module.slot.kind === 'system' && module.category === 'shieldBooster' && !module.repeating);
    if (booster !== undefined && shield < 0.7) {
      return { type: 'module.activate', payload: { slotKind: booster.slot.kind, slotIndex: booster.slot.index } };
    }
    return null;
  };

  /**
   * What the pilot is roughly trying to do. It is the pilot's own and nothing
   * authoritative: without it a random walk never leaves the station's
   * doorstep, and the sites, the loot and the losses would go unexercised.
   */
  let intent: 'visit' | 'leave' | 'fight' | 'home' = start?.intent ?? 'visit';
  let budget = start?.budget ?? whole(4, 14);

  return {
    next(state: CampaignState): PilotAction {
      const location = state.assets.location;
      // One step in twelve ignores the intent entirely.
      const wandering = random() < 0.08;

      if (location.kind === 'station') {
        if (intent !== 'visit' && intent !== 'leave') {
          intent = 'visit';
          budget = whole(4, 14);
        }
        if (intent === 'visit' && !wandering) {
          budget -= 1;
          if (budget <= 0) intent = 'leave';
          return choose([...docked(state).filter(([, make]) => make !== undefined), ...anywhere(state, 2)]) ?? ADVANCE;
        }
        if (intent === 'leave' && !wandering) {
          if (state.fitting !== null) return { type: random() < 0.7 ? 'fitting.commit' : 'fitting.revert', payload: {} };
          if (state.time.paused) return { type: 'time.set', payload: { paused: false, rate: 1 } };
          const destinations = destinationsProjection(state, content).destinations;
          if (!destinations.some((destination) => destination.selected) || random() < 0.3) {
            const destination = pick(destinations);
            if (destination !== undefined) {
              return { type: 'navigation.selectDestination', payload: { encounterId: destination.encounterId } };
            }
          }
          return { type: 'ship.undock', payload: {} };
        }
        return choose([...docked(state), ...anywhere(state, 4)]) ?? ADVANCE;
      }

      if (location.kind === 'warp') {
        return wandering ? choose(anywhere(state, 20)) ?? ADVANCE : ADVANCE;
      }

      const site = siteProjection(state, content);
      const station = site.site?.objects.find((object) => object.kind === 'station');
      const travelling = site.travelStatus !== null;
      if (wandering) return choose([...inSpace(state), ...anywhere(state, 45)]) ?? ADVANCE;
      if (state.time.paused) return { type: 'time.set', payload: { paused: false, rate: 1 } };

      if (station !== undefined) {
        // On the station's doorstep: on the way out, or on the way home.
        if (travelling) return ADVANCE;
        if (intent === 'leave') {
          const destinations = destinationsProjection(state, content);
          const destination = destinations.destinations.find((entry) => entry.selected) ?? pick(destinations.destinations);
          intent = 'fight';
          budget = whole(150, 700);
          return destination === undefined ? ADVANCE : {
            type: 'navigation.warp',
            payload: { destinationSiteId: destination.siteId, arrivalDistanceKm: pick(site.arrivalDistancesKm) ?? 0 },
          };
        }
        // Back on the doorstep without having been sent home: a stray retreat. Go in.
        intent = 'home';
        return { type: 'navigation.dock', payload: { stationId: station.id } };
      }

      // In an encounter site.
      if (intent !== 'home') {
        intent = 'fight';
        budget -= 1;
        if (budget <= 0) intent = 'home';
        if (random() < 0.5) return fightSensibly(state) ?? ADVANCE;
        return choose([...inSpace(state), ...anywhere(state, 45)]) ?? ADVANCE;
      }
      return travelling ? ADVANCE : { type: 'navigation.retreat', payload: {} };
    },
  };
}
