import { capacityRoot, isLocalInventory, maximumThatFits, requireInventory, requireStack, stacksIn, usedVolume,
  InventoryError, type CampaignState, type ItemStack } from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type { AssetsData, InventoryData, ItemInspectionData, MaximumInventoryData, StackData, WalletData } from '@protocol';
import { deepClone, deepFreeze } from '@shared';

/** Inspection never exposes mutable domain objects or changes authority.
 * @implements TECH-7.3, FUNC-6.1, FUNC-6.2, MVP-AC-02, MVP-AC-06
 */
export function walletProjection(state: CampaignState): WalletData {
  return deepFreeze({ revision: state.revision, credits: state.assets.credits });
}
function stackProjection(stack: ItemStack, content: ContentRepository): StackData {
  const d = content.requireTradeable(stack.definitionId);
  return { id: stack.id, inventoryId: stack.inventoryId, quantity: stack.quantity, state: stack.state,
    provenance: deepClone(stack.provenance), item: { definitionId: d.id, nameKey: d.nameKey,
      descriptionKey: d.descriptionKey, referenceValueCredits: d.referenceValueCredits,
      unitVolumeCubicDecimetres: d.volumeCubicDecimetres,
      kind: content.module(d.id) ? 'module' : content.ammunition(d.id) ? 'ammunition' : 'item' } };
}
export function inventoryProjection(state: CampaignState, content: ContentRepository, id: string): InventoryData {
  const inventory = requireInventory(state.assets, id);
  const root = capacityRoot(state.assets, id);
  const capacity = root.capacity.kind === 'limited' ? root.capacity.volumeCubicDecimetres : null;
  const used = usedVolume(state.assets, content, id);
  const accessible = isLocalInventory(state.assets, inventory);
  return deepFreeze({ revision: state.revision, id: inventory.id, location: deepClone(inventory.location),
    accessible, unavailableReason: accessible ? null : 'error.ruleViolation.inventoryUnavailable',
    capacityCubicDecimetres: capacity, usedCubicDecimetres: used,
    freeCubicDecimetres: capacity === null ? null : capacity - used,
    stacks: stacksIn(state.assets, id).map((stack) => stackProjection(stack, content)) });
}
export function assetsProjection(state: CampaignState, content: ContentRepository): AssetsData {
  return deepFreeze({ ...walletProjection(state), location: deepClone(state.assets.location), activeShipId: state.assets.activeShipId,
    ships: Object.keys(state.assets.ships).sort().map((id) => {
      const ship = state.assets.ships[id]!;
      return { ...deepClone(ship), nameKey: content.requireHull(ship.hullId).nameKey, active: ship.id === state.assets.activeShipId };
    }),
    inventories: Object.keys(state.assets.inventories).sort().map((id) => inventoryProjection(state, content, id)) });
}
export function hangarProjection(state: CampaignState, content: ContentRepository, stationId: string): InventoryData {
  const inventory = Object.values(state.assets.inventories).find((i) => i.location.kind === 'hangar' && i.location.stationId === stationId);
  if (!inventory) throw new InventoryError('inventoryNotFound');
  return inventoryProjection(state, content, inventory.id);
}
export function cargoProjection(state: CampaignState, content: ContentRepository, shipId: string): InventoryData {
  const ship = state.assets.ships[shipId];
  if (!ship) throw new InventoryError('inventoryNotFound');
  return inventoryProjection(state, content, ship.cargoInventoryId);
}
export function itemInspectionProjection(state: CampaignState, content: ContentRepository, id: string): ItemInspectionData {
  const stack = requireStack(state.assets, id);
  return deepFreeze({ revision: state.revision, stack: stackProjection(stack, content),
    inventory: inventoryProjection(state, content, stack.inventoryId) });
}
export function maximumInventoryProjection(state: CampaignState, content: ContentRepository, stackId: string, destinationInventoryId: string): MaximumInventoryData {
  const stack = requireStack(state.assets, stackId);
  const destination = requireInventory(state.assets, destinationInventoryId);
  const accessible = isLocalInventory(state.assets, destination) &&
    isLocalInventory(state.assets, requireInventory(state.assets, stack.inventoryId));
  const reason = !accessible ? 'inventoryUnavailable' : stack.inventoryId === destination.id ? 'sameInventory' : null;
  return deepFreeze({ revision: state.revision, stackId, destinationInventoryId,
    maximumQuantity: reason !== null ? 0 : Math.min(stack.quantity, maximumThatFits(state.assets, content, destinationInventoryId, stack.definitionId)),
    unavailableReason: reason === null ? null : `error.ruleViolation.${reason}` });
}
