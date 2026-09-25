import type { CampaignState, ContentRepository } from '@engine';
import { marketBuyPreview, resupplyPreview } from '@engine/projections';

import { command, newCampaign, withCredits } from '../loss.ts';

import type { FixtureFit } from './fixtures.ts';

/**
 * Puts a representative fit on a new campaign's ship through the station
 * (Functional Specification 8.4, 10, 11.3; MVP Scope 4.1).
 *
 * Every item the fit needs and the campaign does not already own is bought at
 * the starting station's market, then the fit is assembled in a fitting draft,
 * the magazines are resupplied and the reserve rounds moved into the hold -
 * exactly the station flow a player follows. A fit that names something the
 * market does not sell, or that the hull cannot carry, therefore fails here
 * rather than being conjured into existence, so a representative fit is also
 * proof that nothing it needs is hidden behind a gate.
 *
 * The only thing set directly is the wallet: the fit's purchases are funded,
 * and afterwards the wallet returns to the starting credits so every fit
 * begins its sorties equally well off. What the purchases cost is returned so
 * a report can say what the fit represents in credits.
 */

export interface FitPurchase {
  readonly definitionId: string;
  readonly quantity: number;
  readonly credits: number;
}

export interface AssembledFit {
  readonly state: CampaignState;
  readonly purchases: readonly FitPurchase[];
  /** What buying the fit from the starting campaign costs at the market. */
  readonly costCredits: number;
}

/** Enough to fund any representative fit; the wallet is restored afterwards. */
const FUNDING_CREDITS = 10_000_000;

export function assembleFit(fit: FixtureFit, seed: string, content: ContentRepository): AssembledFit {
  const stationId = content.rules.economy.startingStationId;
  let state = withCredits(newCampaign(seed, content), FUNDING_CREDITS);
  const shipId = state.assets.activeShipId;
  if (shipId === null) throw new Error('A new campaign has no active ship.');
  const ship = state.assets.ships[shipId];
  if (ship === undefined) throw new Error('The active ship does not exist.');

  // Buy what the campaign does not already own.
  const purchases: FitPurchase[] = [];
  for (const [definitionId, quantity] of shortfall(fit, state, content)) {
    const preview = marketBuyPreview(state, content, { stationId, itemId: definitionId, quantity });
    if (!preview.available || preview.token === null) {
      throw new Error(`Fit "${fit.id}" needs ${String(quantity)} ${definitionId}, which the market refuses: ${String(preview.unavailableReason)}`);
    }
    state = command(state, 'market.confirmBuy', { token: preview.token }, content).state;
    purchases.push({ definitionId, quantity, credits: preview.totalCredits });
  }

  // Assemble the fit in one draft.
  state = command(state, 'fitting.begin', { shipId }, content).state;
  const hull = content.requireHull(ship.hullId);
  for (const [slotKind, count] of Object.entries(hull.slots)) {
    for (let index = 0; index < count; index += 1) {
      const wanted = fit.modules.find((entry) => entry.slot === slotKind && entry.index === index);
      state = wanted === undefined
        ? command(state, 'fitting.clear', { slotKind, slotIndex: index }, content).state
        : command(state, 'fitting.set', {
            slotKind,
            slotIndex: index,
            moduleId: wanted.moduleId,
            online: true,
            ...(wanted.ammunitionId === undefined ? {} : { ammunitionId: wanted.ammunitionId }),
          }, content).state;
    }
  }
  state = command(state, 'fitting.commit', {}, content).state;

  // Fill every magazine from the hangar.
  const resupply = resupplyPreview(state, content, { shipId });
  if (resupply.available && resupply.token !== null) {
    state = command(state, 'resupply.confirm', { token: resupply.token }, content).state;
  }

  // Carry the reserve rounds.
  for (const entry of fit.cargo) {
    let remaining = entry.quantity;
    for (const stack of hangarStacks(state, stationId, entry.definitionId)) {
      if (remaining === 0) break;
      const quantity = Math.min(remaining, stack.quantity);
      state = command(state, 'inventory.transfer', {
        stackId: stack.id,
        destinationInventoryId: ship.cargoInventoryId,
        quantity,
      }, content).state;
      remaining -= quantity;
    }
    if (remaining > 0) {
      throw new Error(`Fit "${fit.id}" could not carry ${String(entry.quantity)} ${entry.definitionId}.`);
    }
  }

  return {
    state: withCredits(state, content.rules.economy.startingCredits),
    purchases,
    costCredits: purchases.reduce((total, purchase) => total + purchase.credits, 0),
  };
}

/** What the fit needs beyond what the campaign owns, by definition, in stable order. */
function shortfall(fit: FixtureFit, state: CampaignState, content: ContentRepository): [string, number][] {
  const needed = new Map<string, number>();
  const add = (definitionId: string, quantity: number): void => {
    needed.set(definitionId, (needed.get(definitionId) ?? 0) + quantity);
  };
  for (const entry of fit.modules) {
    add(entry.moduleId, 1);
    if (entry.ammunitionId !== undefined) {
      const module = content.requireModule(entry.moduleId as never);
      add(entry.ammunitionId, module.category === 'turret' ? module.turret.magazineSize : 0);
    }
  }
  for (const entry of fit.cargo) add(entry.definitionId, entry.quantity);

  const owned = new Map<string, number>();
  for (const stack of Object.values(state.assets.stacks)) {
    owned.set(stack.definitionId, (owned.get(stack.definitionId) ?? 0) + stack.quantity);
  }
  return [...needed.entries()]
    .map(([definitionId, quantity]): [string, number] => [definitionId, quantity - (owned.get(definitionId) ?? 0)])
    .filter(([, quantity]) => quantity > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

function hangarStacks(state: CampaignState, stationId: string, definitionId: string) {
  return Object.values(state.assets.stacks)
    .filter((stack) => {
      const inventory = state.assets.inventories[stack.inventoryId];
      return stack.definitionId === definitionId &&
        stack.state.kind === 'plain' &&
        inventory?.location.kind === 'hangar' &&
        inventory.location.stationId === stationId;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}
