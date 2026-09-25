import type { AssetState, Inventory, ShipIdentity } from './types';

/**
 * The ship the player controls, or `null` while they own none here
 * (Functional Specification 9.12). Every caller that needs a ship asks this
 * rather than indexing `ships` with an id that may be absent.
 */
export function activeShip(assets: AssetState): ShipIdentity | null {
  const id = assets.activeShipId;
  return id === null ? null : (assets.ships[id] ?? null);
}

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
