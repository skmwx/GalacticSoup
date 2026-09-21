import type { AssetState, Inventory } from './types';

/** Ownership is not permission to remotely move goods. @implements FUNC-6.1 */
export function isLocalInventory(assets: AssetState, inventory: Inventory): boolean {
  const location = inventory.location;
  if (location.kind === 'hangar') {
    return assets.location.kind === 'station' && location.stationId === assets.location.stationId;
  }
  if (location.kind === 'cargo') {
    const ship = assets.ships[location.shipId];
    if (ship === undefined) return false;
    if (ship.id === assets.activeShipId) return true;
    return assets.location.kind === 'station' &&
      ship.location.kind === 'station' &&
      ship.location.stationId === assets.location.stationId;
  }
  // A fitting store is reached through fitting commands and a reserve is
  // private to the engine operation that owns it. Neither is a place the
  // player moves goods to or from directly (Functional Specification 8.4).
  return false;
}
