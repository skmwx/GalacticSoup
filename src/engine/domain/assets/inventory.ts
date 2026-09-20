import type { ContentRepository } from '@engine/ports';
import { deepClone, type DefinitionId, type Mutable } from '@shared';
import { entityIdOf, MAX_ORDINAL, type EntityId } from '../campaign/identity';
import { compatibleStacks, mergeProvenance, positiveQuantity, safeCount, splitProvenance } from './stack';
import { InventoryError, type AssetDraft, type AssetState, type CapacityPolicy,
  type Inventory, type InventoryId, type InventoryLocation, type ItemStack, type Provenance } from './types';

/** The sole writer of physical stacks/locations. Every operation, including a failed
 * reservation/release, is atomic even when called without an application transaction.
 * @implements TECH-8.3, FUNC-6.1, FUNC-6.2, FUNC-22.2, FUNC-22.3, MVP-AC-02, MVP-AC-06
 */
export function inventoryService(draft: AssetDraft, content: ContentRepository) {
  function atomic<T>(operation: (work: AssetDraft) => T): T {
    const work: AssetDraft = { ...draft, assets: deepClone(draft.assets) };
    const result = operation(work);
    draft.assets = work.assets;
    draft.nextEntityOrdinal = work.nextEntityOrdinal;
    return result;
  }
  function allocate(work: AssetDraft): EntityId {
    if (work.nextEntityOrdinal >= MAX_ORDINAL) throw new InventoryError('numericOverflow');
    return entityIdOf(work.campaignId, work.nextEntityOrdinal++);
  }
  function makeInventory(work: AssetDraft, location: InventoryLocation, capacity: CapacityPolicy): InventoryId {
    const id = allocate(work) as InventoryId;
    work.assets.inventories[id] = deepClone({ id, location, capacity });
    return id;
  }
  function take(work: AssetDraft, id: string, quantity: number): Mutable<ItemStack> {
    const source = requireStack(work.assets, id);
    positiveQuantity(quantity);
    if (quantity > source.quantity) throw new InventoryError('insufficientItems');
    if (quantity === source.quantity) {
      delete work.assets.stacks[id];
      return deepClone(source);
    }
    const [moved, retained] = splitProvenance(source.provenance, quantity);
    work.assets.stacks[id] = { ...source, quantity: source.quantity - quantity, provenance: retained };
    return { ...deepClone(source), id: allocate(work), quantity, provenance: moved };
  }
  function put(work: AssetDraft, stack: ItemStack, inventoryId: InventoryId, merge: boolean): EntityId {
    const target = merge ? stacksIn(work.assets, inventoryId).find((s) => compatibleStacks(s, stack)) : undefined;
    if (target !== undefined) {
      work.assets.stacks[target.id] = { ...target, quantity: safeCount(target.quantity + stack.quantity),
        provenance: mergeProvenance(target.provenance, stack.provenance) };
      return target.id;
    }
    work.assets.stacks[stack.id] = deepClone({ ...stack, inventoryId });
    return stack.id;
  }
  function move(work: AssetDraft, stackId: string, destination: string, quantity: number): EntityId {
    const stack = requireStack(work.assets, stackId);
    const to = requireInventory(work.assets, destination);
    if (stack.inventoryId === to.id) throw new InventoryError('sameInventory');
    positiveQuantity(quantity);
    if (quantity > stack.quantity) throw new InventoryError('insufficientItems');
    const shared = capacityRoot(work.assets, stack.inventoryId).id === capacityRoot(work.assets, to.id).id;
    if (!shared && quantity > maximumThatFits(work.assets, content, to.id, stack.definitionId)) {
      throw new InventoryError('insufficientCapacity');
    }
    return put(work, take(work, stackId, quantity), to.id, true);
  }
  return {
    create(location: InventoryLocation, capacity: CapacityPolicy): InventoryId {
      return atomic((work) => makeInventory(work, location, capacity));
    },
    setCapacity(inventoryId: string, volumeCubicDecimetres: number): void {
      atomic((work) => {
        const inventory = requireInventory(work.assets, inventoryId);
        if (inventory.location.kind !== 'cargo') throw new InventoryError('inventoryUnavailable');
        safeCount(volumeCubicDecimetres);
        if (usedVolume(work.assets, content, inventoryId) > volumeCubicDecimetres) {
          throw new InventoryError('insufficientCapacity');
        }
        work.assets.inventories[inventoryId] = { ...inventory,
          capacity: { kind: 'limited', volumeCubicDecimetres } };
      });
    },
    add(inventoryId: string, definitionId: DefinitionId, quantity: number, provenance: Provenance): EntityId {
      return atomic((work) => {
        const inventory = requireInventory(work.assets, inventoryId);
        positiveQuantity(quantity);
        for (const value of Object.values(provenance)) safeCount(value);
        if (safeCount(provenance.grantedQuantity + provenance.purchasedQuantity) !== quantity ||
            (provenance.purchasedQuantity === 0 && provenance.purchaseCostCredits !== 0)) {
          throw new InventoryError('invalidQuantity');
        }
        if (quantity > maximumThatFits(work.assets, content, inventoryId, definitionId)) {
          throw new InventoryError('insufficientCapacity');
        }
        return put(work, { id: allocate(work), inventoryId: inventory.id, definitionId,
          quantity, state: 'plain', provenance }, inventory.id, true);
      });
    },
    split(stackId: string, quantity: number): EntityId {
      return atomic((work) => {
        const source = requireStack(work.assets, stackId);
        if (quantity >= source.quantity) throw new InventoryError('invalidQuantity');
        return put(work, take(work, stackId, quantity), source.inventoryId, false);
      });
    },
    merge(sourceId: string, targetId: string): EntityId {
      return atomic((work) => {
        const source = requireStack(work.assets, sourceId);
        const target = requireStack(work.assets, targetId);
        if (sourceId === targetId || source.inventoryId !== target.inventoryId || !compatibleStacks(source, target)) {
          throw new InventoryError('incompatibleStacks');
        }
        work.assets.stacks[targetId] = { ...target, quantity: safeCount(source.quantity + target.quantity),
          provenance: mergeProvenance(source.provenance, target.provenance) };
        delete work.assets.stacks[sourceId];
        return target.id;
      });
    },
    transfer(stackId: string, destination: string, quantity: number): EntityId {
      return atomic((work) => move(work, stackId, destination, quantity));
    },
    reserve(stackId: string, quantity: number, ownerId: EntityId): InventoryId {
      return atomic((work) => {
        const stack = requireStack(work.assets, stackId);
        const source = requireInventory(work.assets, stack.inventoryId);
        if (source.location.kind === 'reserve' || work.assets.ships[ownerId] === undefined) {
          throw new InventoryError('invalidReservation');
        }
        const id = makeInventory(work, { kind: 'reserve', sourceInventoryId: source.id, ownerId },
          { kind: 'shared', inventoryId: source.id });
        move(work, stackId, id, quantity);
        return id;
      });
    },
    release(inventoryId: string, ownerId: EntityId): void {
      atomic((work) => {
        const reserve = requireInventory(work.assets, inventoryId);
        if (reserve.location.kind !== 'reserve' || reserve.location.ownerId !== ownerId) {
          throw new InventoryError('invalidReservation');
        }
        for (const stack of stacksIn(work.assets, inventoryId)) {
          move(work, stack.id, reserve.location.sourceInventoryId, stack.quantity);
        }
        delete work.assets.inventories[inventoryId];
      });
    },
  };
}

export function requireInventory(assets: AssetState, id: string): Inventory {
  const inventory = Object.hasOwn(assets.inventories, id) ? assets.inventories[id] : undefined;
  if (inventory === undefined) throw new InventoryError('inventoryNotFound');
  return inventory;
}
export function requireStack(assets: AssetState, id: string): ItemStack {
  const stack = Object.hasOwn(assets.stacks, id) ? assets.stacks[id] : undefined;
  if (stack === undefined) throw new InventoryError('itemNotFound');
  return stack;
}
export function stacksIn(assets: AssetState, id: string): readonly ItemStack[] {
  return Object.keys(assets.stacks).sort().map((key) => assets.stacks[key]!)
    .filter((stack) => stack.inventoryId === id);
}
export function capacityRoot(assets: AssetState, id: string): Inventory {
  const inventory = requireInventory(assets, id);
  return inventory.capacity.kind === 'shared'
    ? requireInventory(assets, inventory.capacity.inventoryId) : inventory;
}
export function usedVolume(assets: AssetState, content: ContentRepository, id: string): number {
  const root = capacityRoot(assets, id);
  let used = 0;
  for (const key of Object.keys(assets.stacks).sort()) {
    const stack = assets.stacks[key]!;
    if (capacityRoot(assets, stack.inventoryId).id === root.id) {
      const definition = content.tradeable(stack.definitionId);
      if (definition === undefined) throw new InventoryError('itemNotFound');
      used = safeCount(used + safeCount(stack.quantity * definition.volumeCubicDecimetres));
    }
  }
  return used;
}
export function maximumThatFits(assets: AssetState, content: ContentRepository, id: string, definitionId: string): number {
  const root = capacityRoot(assets, id);
  const definition = content.tradeable(definitionId);
  if (definition === undefined) throw new InventoryError('itemNotFound');
  const used = usedVolume(assets, content, id);
  const available = root.capacity.kind === 'limited' ? root.capacity.volumeCubicDecimetres - used
    : Number.MAX_SAFE_INTEGER - used;
  return definition.volumeCubicDecimetres === 0 ? Number.MAX_SAFE_INTEGER
    : Math.max(0, Math.floor(available / definition.volumeCubicDecimetres));
}
