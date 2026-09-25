import type { ContentRepository } from '@engine/ports';
import type { DefinitionId, HullId, StationId } from '@shared';

import { attributeValue, deriveShipAttributes } from '../attributes';
import { inventoryService } from '../assets/inventory';
import type { AssetDraft } from '../assets/types';
import { allocateEntityId } from '../campaign/allocation';
import type { EntityId } from '../campaign/identity';
import type { CampaignDraft } from '../campaign/state';
import { syncShipDerived } from '../fitting/apply';
import { shipFit } from '../fitting/fit';
import type { SlotKind } from '@engine/ports';

import { recoveryGrantDue } from './rules';

/**
 * The independent recovery service's last-resort grant
 * (Functional Specification 9.12, 22.1; Technical Specification 10.9).
 *
 * A pilot who owns no flight-ready ship and cannot afford the starter hull is
 * given a replacement starter ship wearing its original basic fit, with a full
 * magazine in each weapon. Every unit of it - the hull, the modules and the
 * rounds - is marked as a recovery grant, so it can be flown, fitted and
 * refitted but can never become sale or insurance value. Grants may repeat.
 *
 * @implements FUNC-9.12, FUNC-22.1, TECH-8.3, TECH-10.9
 */

/**
 * Creates the granted ship docked at `stationId` and returns its id. The
 * caller decides whether it becomes the active ship.
 */
export function grantRecoveryShip(
  draft: CampaignDraft,
  content: ContentRepository,
  stationId: StationId,
): EntityId {
  const rules = content.rules.economy;
  const station = content.requireStation(stationId);
  const hull = content.requireHull(rules.starterHullId as HullId);
  const shipId = allocateEntityId(draft);
  const work = draft as unknown as AssetDraft;
  const service = inventoryService(work, content);
  const cargoInventoryId = service.create(
    { kind: 'cargo', shipId },
    { kind: 'limited', volumeCubicDecimetres: hull.cargoCapacityCubicDecimetres },
  );
  const fittingInventoryId = service.create({ kind: 'fitting', shipId }, { kind: 'unlimited' });
  const location = { kind: 'station' as const, stationId: station.id, systemId: station.systemId };

  draft.assets.ships[shipId] = {
    id: shipId,
    owner: 'player',
    hullId: hull.id,
    cargoInventoryId,
    fittingInventoryId,
    location,
    condition: { damage: { shield: 0, armor: 0, hull: 0 }, capacitorCharge: 0 },
    insurance: { coverage: 'basic', premiumPaidCredits: 0 },
    recoveryGrant: true,
  };

  const grant = { recoveryGrant: true } as const;
  for (const entry of [...rules.startingFit].sort(bySlot)) {
    const slot = { kind: entry.slot as SlotKind, index: entry.index };
    service.addAs(fittingInventoryId, entry.moduleId as DefinitionId, 1, granted(1), {
      kind: 'fitted',
      slot,
      online: entry.online,
    }, grant);
    const module = content.module(entry.moduleId);
    const magazineSize = module?.category === 'turret' ? module.turret.magazineSize : 0;
    if (entry.ammunitionId !== undefined && magazineSize > 0) {
      service.addAs(
        fittingInventoryId,
        entry.ammunitionId as DefinitionId,
        magazineSize,
        granted(magazineSize),
        { kind: 'charge', slot },
        grant,
      );
    }
  }

  syncShipDerived(work, content, shipId);
  const ship = draft.assets.ships[shipId];
  if (ship !== undefined) {
    // A ship leaves the yard with a full capacitor, as the first one did.
    const derived = deriveShipAttributes({ hull, fit: shipFit(draft.assets, shipId), content });
    draft.assets.ships[shipId] = {
      ...ship,
      condition: { ...ship.condition, capacitorCharge: attributeValue(derived, 'capacitorCapacity') },
    };
  }
  draft.assets.version += 1;
  return shipId;
}

/**
 * Keeps the recovery route open for a docked, shipless pilot
 * (Functional Specification 9.12, 22.1).
 *
 * Losing the only ship with enough credits for another leaves the pilot
 * shipless. Should their credits later fall below the starter's reference
 * value - by buying something other than a hull - they would be stranded, so
 * the grant the destruction did not owe them is owed now. Returns the granted
 * ship, which becomes active, or `null` when nothing was owed.
 */
export function ensureRecoveryRoute(draft: CampaignDraft, content: ContentRepository): EntityId | null {
  const location = draft.assets.location;
  if (draft.assets.activeShipId !== null || location.kind !== 'station') return null;
  if (!recoveryGrantDue(draft, content)) return null;
  const shipId = grantRecoveryShip(draft, content, location.stationId);
  draft.assets.activeShipId = shipId;
  draft.assets.version += 1;
  return shipId;
}

function granted(quantity: number) {
  return { grantedQuantity: quantity, purchasedQuantity: 0, purchaseCostCredits: 0 };
}

function bySlot(
  a: { readonly slot: string; readonly index: number },
  b: { readonly slot: string; readonly index: number },
): number {
  return a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.index - b.index;
}
