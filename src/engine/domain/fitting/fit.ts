import type { ContentRepository } from '@engine/ports';
import type { AmmunitionId, ModuleId } from '@shared';

import { stacksIn } from '../assets/inventory';
import type { AssetState, ItemStack } from '../assets/types';

import {
  compareSlots,
  parseSlotKey,
  slotKey,
  type FitDescription,
  type FittedSlotDescription,
  type FittingDraft,
  type LoadedCharge,
  type SlotRef,
} from './types';

/**
 * Reading a fit (Functional Specification 8.4).
 *
 * The fit a ship wears is not a second copy of its modules: it is the set of
 * physical stacks in the ship's fitting store, each carrying the slot it
 * occupies. Reading the fit therefore cannot disagree with the inventory, and
 * a module cannot be both fitted and in a hold.
 *
 * @implements FUNC-8.4, FUNC-22.3, TECH-8.3
 */

export function shipFit(assets: AssetState, shipId: string): FitDescription {
  const ship = assets.ships[shipId];
  if (ship === undefined) {
    return [];
  }

  const stacks = stacksIn(assets, ship.fittingInventoryId);
  const charges = new Map<string, ItemStack>();
  for (const stack of stacks) {
    if (stack.state.kind === 'charge') {
      charges.set(slotKey(stack.state.slot), stack);
    }
  }

  const fitted: FittedSlotDescription[] = [];
  for (const stack of stacks) {
    if (stack.state.kind !== 'fitted') {
      continue;
    }
    const slot = stack.state.slot;
    const charge = charges.get(slotKey(slot));
    fitted.push({
      slot,
      moduleId: stack.definitionId as ModuleId,
      online: stack.state.online,
      stackId: stack.id,
      charge:
        charge === undefined
          ? null
          : {
              ammunitionId: charge.definitionId as AmmunitionId,
              quantity: charge.quantity,
              stackId: charge.id,
            },
    });
  }

  return fitted.sort((a, b) => compareSlots(a.slot, b.slot));
}

/** The fitting store of a ship, or `null` when the ship is unknown. */
export function fittingInventoryOf(assets: AssetState, shipId: string): string | null {
  return assets.ships[shipId]?.fittingInventoryId ?? null;
}

/**
 * The fit a draft describes, independent of whether the items are in hand.
 *
 * Derived statistics depend on what is planned, not on which unit supplies it,
 * so a preview can be shown before the planner has allocated anything.
 */
export function fitFromDraft(draft: FittingDraft, content: ContentRepository): FitDescription {
  const fitted: FittedSlotDescription[] = [];

  for (const key of Object.keys(draft.slots).sort()) {
    const slot = parseSlotKey(key);
    const planned = draft.slots[key];
    if (slot === null || planned === undefined) {
      continue;
    }
    fitted.push({
      slot,
      moduleId: planned.moduleId,
      online: planned.online,
      stackId: null,
      charge: plannedCharge(planned.ammunitionId, planned.moduleId, content),
    });
  }

  return fitted.sort((a, b) => compareSlots(a.slot, b.slot));
}

/** The whole magazine is what a planned charge would load. */
function plannedCharge(
  ammunitionId: AmmunitionId | null,
  moduleId: ModuleId,
  content: ContentRepository,
): LoadedCharge | null {
  if (ammunitionId === null) {
    return null;
  }
  const module = content.module(moduleId);
  const quantity = module !== undefined && module.category === 'turret' ? module.turret.magazineSize : 0;
  return { ammunitionId, quantity, stackId: null };
}

/** The fitted module occupying a slot, or `null`. */
export function moduleAt(fit: FitDescription, slot: SlotRef): FittedSlotDescription | null {
  const key = slotKey(slot);
  return fit.find((entry) => slotKey(entry.slot) === key) ?? null;
}
