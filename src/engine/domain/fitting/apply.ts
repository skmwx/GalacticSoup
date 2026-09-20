import { DEFENSE_LAYERS, type ContentRepository, type DefenseLayer } from '@engine/ports';
import { clamp, type DefinitionId, type ModuleId } from '@shared';

import { attributeValue, deriveShipAttributes } from '../attributes';
import { inventoryService, requireInventory, stacksIn } from '../assets/inventory';
import { InventoryError, type AssetDraft, type AssetState, type ItemStack } from '../assets/types';

import { shipFit } from './fit';
import {
  parseSlotKey,
  slotKey,
  type FittingDraft,
  type MissingItem,
  type PlannedSlot,
  type SlotRef,
} from './types';

/**
 * Committing a fitting draft (Functional Specification 8.4; Technical
 * Specification 10.2).
 *
 * The draft names definitions; this is where they become physical moves. Every
 * module and charge the new fit needs is taken from the station hangar or the
 * ship's own hold, and everything the new fit does not want goes back to the
 * hangar. Nothing is created or destroyed: each unit simply changes what it is
 * doing (Functional Specification 22.3).
 *
 * The caller runs this inside a transaction, so a rejected commit leaves the
 * campaign exactly as it was. An item the draft needs but the player no longer
 * has is reported rather than half-applied.
 *
 * @implements FUNC-8.4, FUNC-22.2, FUNC-22.3, TECH-10.2
 */

export function applyDraftTo(
  work: AssetDraft,
  content: ContentRepository,
  draft: FittingDraft,
): readonly MissingItem[] {
  const ship = work.assets.ships[draft.shipId];
  if (ship === undefined) {
    throw new InventoryError('itemNotFound');
  }

  const service = inventoryService(work, content);
  const fitting = ship.fittingInventoryId;
  const hangar = hangarOf(work.assets, ship.location.stationId);
  const planned = plannedSlots(draft);

  // Everything the new fit does not want comes off first, so a module moved
  // from one slot to another is available to be refitted below.
  for (const stack of stacksIn(work.assets, fitting)) {
    const state = stack.state;
    if (state.kind === 'plain') {
      continue;
    }
    const wanted = planned.get(slotKey(state.slot));

    if (state.kind === 'fitted') {
      if (wanted === undefined || wanted.planned.moduleId !== stack.definitionId) {
        service.transfer(stack.id, hangar, stack.quantity);
      } else if (wanted.planned.online !== state.online) {
        service.setState(stack.id, {
          kind: 'fitted',
          slot: state.slot,
          online: wanted.planned.online,
        });
      }
      continue;
    }

    const keepsCharge =
      wanted !== undefined &&
      wanted.planned.ammunitionId === stack.definitionId &&
      wanted.planned.moduleId === moduleIdAt(work.assets, fitting, state.slot);
    if (!keepsCharge) {
      service.transfer(stack.id, hangar, stack.quantity);
    }
  }

  const missing: MissingItem[] = [];
  const sources = [hangar, ship.cargoInventoryId];

  for (const entry of orderedSlots(planned)) {
    if (moduleIdAt(work.assets, fitting, entry.ref) === undefined) {
      const source = findSource(work.assets, sources, entry.planned.moduleId);
      if (source === null) {
        missing.push(missingItem(work.assets, sources, entry.planned.moduleId, 1));
        continue;
      }
      service.transferAs(source.id, fitting, 1, {
        kind: 'fitted',
        slot: entry.ref,
        online: entry.planned.online,
      });
    }

    const ammunitionId = entry.planned.ammunitionId;
    if (ammunitionId === null || chargeAt(work.assets, fitting, entry.ref) !== undefined) {
      continue;
    }

    const magazineSize = magazineOf(content, entry.planned.moduleId);
    const available = availableQuantity(work.assets, sources, ammunitionId);
    const rounds = Math.min(magazineSize, available);
    if (rounds <= 0) {
      missing.push({ definitionId: ammunitionId, required: magazineSize, available });
      continue;
    }

    let remaining = rounds;
    while (remaining > 0) {
      const source = findSource(work.assets, sources, ammunitionId);
      if (source === null) {
        break;
      }
      const taken = Math.min(remaining, source.quantity);
      service.transferAs(source.id, fitting, taken, { kind: 'charge', slot: entry.ref });
      remaining -= taken;
    }
  }

  syncShipDerived(work, content, draft.shipId);
  return missing;
}

/**
 * Brings stored condition and cargo capacity back inside what the fit allows.
 *
 * A refit never heals or damages a ship, but it can change the maximum a layer
 * or the capacitor holds. A cargo hold that would no longer fit its contents
 * is refused rather than silently emptied (Functional Specification 22.2).
 */
export function syncShipDerived(
  work: AssetDraft,
  content: ContentRepository,
  shipId: string,
): void {
  const ship = work.assets.ships[shipId];
  if (ship === undefined) {
    return;
  }
  const hull = content.requireHull(ship.hullId);
  const derived = deriveShipAttributes({ hull, fit: shipFit(work.assets, shipId), content });

  const damage = {} as Record<DefenseLayer, number>;
  for (const layer of DEFENSE_LAYERS) {
    damage[layer] = clamp(
      0,
      attributeValue(derived, `${layer}HitPoints`),
      ship.condition.damage[layer],
    );
  }

  work.assets.ships[shipId] = {
    ...ship,
    condition: {
      damage,
      capacitorCharge: clamp(
        0,
        attributeValue(derived, 'capacitorCapacity'),
        ship.condition.capacitorCharge,
      ),
    },
  };

  inventoryService(work, content).setCapacity(
    ship.cargoInventoryId,
    attributeValue(derived, 'cargoCapacityCubicDecimetres'),
  );
}

interface PlannedEntry {
  readonly ref: SlotRef;
  readonly planned: PlannedSlot;
}

function plannedSlots(draft: FittingDraft): Map<string, PlannedEntry> {
  const planned = new Map<string, PlannedEntry>();
  for (const key of Object.keys(draft.slots)) {
    const slot = draft.slots[key];
    const ref = parseSlotKey(key);
    if (slot !== undefined && ref !== null) {
      planned.set(key, { ref, planned: slot });
    }
  }
  return planned;
}

/** Slot order is stable so a commit produces the same entity ids every time. */
function orderedSlots(planned: Map<string, PlannedEntry>): readonly PlannedEntry[] {
  return [...planned.keys()].sort().map((key) => planned.get(key) as PlannedEntry);
}

function moduleIdAt(assets: AssetState, fitting: string, slot: SlotRef): DefinitionId | undefined {
  const key = slotKey(slot);
  return stacksIn(assets, fitting).find(
    (stack) => stack.state.kind === 'fitted' && slotKey(stack.state.slot) === key,
  )?.definitionId;
}

function chargeAt(assets: AssetState, fitting: string, slot: SlotRef): ItemStack | undefined {
  const key = slotKey(slot);
  return stacksIn(assets, fitting).find(
    (stack) => stack.state.kind === 'charge' && slotKey(stack.state.slot) === key,
  );
}

function hangarOf(assets: AssetState, stationId: string): string {
  const hangar = Object.keys(assets.inventories)
    .sort()
    .map((id) => assets.inventories[id])
    .find(
      (inventory) =>
        inventory !== undefined &&
        inventory.location.kind === 'hangar' &&
        inventory.location.stationId === stationId,
    );
  if (hangar === undefined) {
    throw new InventoryError('inventoryNotFound');
  }
  return hangar.id;
}

/** The lowest-numbered unfitted stack of `definitionId` in the local stores. */
function findSource(
  assets: AssetState,
  sources: readonly string[],
  definitionId: string,
): ItemStack | null {
  for (const inventoryId of sources) {
    requireInventory(assets, inventoryId);
    const stack = stacksIn(assets, inventoryId).find(
      (candidate) => candidate.definitionId === definitionId && candidate.state.kind === 'plain',
    );
    if (stack !== undefined) {
      return stack;
    }
  }
  return null;
}

function availableQuantity(
  assets: AssetState,
  sources: readonly string[],
  definitionId: string,
): number {
  let available = 0;
  for (const inventoryId of sources) {
    for (const stack of stacksIn(assets, inventoryId)) {
      if (stack.definitionId === definitionId && stack.state.kind === 'plain') {
        available += stack.quantity;
      }
    }
  }
  return available;
}

function missingItem(
  assets: AssetState,
  sources: readonly string[],
  definitionId: string,
  required: number,
): MissingItem {
  return { definitionId, required, available: availableQuantity(assets, sources, definitionId) };
}

function magazineOf(content: ContentRepository, moduleId: ModuleId): number {
  const module = content.module(moduleId);
  return module !== undefined && module.category === 'turret' ? module.turret.magazineSize : 0;
}
