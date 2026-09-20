import type { AssetState, Inventory } from './types';

/** Ownership is not permission to remotely move goods. @implements FUNC-6.1 */
export function isLocalInventory(assets: AssetState, inventory: Inventory): boolean {
  const location = inventory.location;
  if (location.kind === 'hangar') return location.stationId === assets.location.stationId;
  if (location.kind === 'cargo') {
    const ship = assets.ships[location.shipId];
    return ship !== undefined && ship.location.stationId === assets.location.stationId;
  }
  // A reserve is private to the engine operation that owns it.
  return false;
}
