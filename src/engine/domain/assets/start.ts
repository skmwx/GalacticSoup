import type { ContentRepository, StartingFitEntry } from '@engine/ports';
import type { AmmunitionId, DefinitionId, HullId, ModuleId, StationId } from '@shared';

import { attributeValue, deriveShipAttributes } from '../attributes';
import { entityIdOf, type CampaignId, type EntityId } from '../campaign/identity';
import { applyDraftTo } from '../fitting/apply';
import { shipFit } from '../fitting/fit';
import { slotKey, type FittingDraft, type PlannedSlot } from '../fitting/types';

import { inventoryService } from './inventory';
import type { AssetDraft } from './types';

/**
 * The assets a new campaign starts with (Functional Specification 3.1, 8.4).
 *
 * Content decides the wallet, the hull, the granted items and the fit; this
 * assembles them. The fit is assembled through the same planner a player uses,
 * from the same granted items, so a starting fit that could not be built by
 * hand cannot be conjured here either.
 *
 * @implements FUNC-3.1, FUNC-8.4, TECH-8.2
 */
export function startingAssets(campaignId: CampaignId, content: ContentRepository): AssetDraft {
  const rules = content.rules.economy;
  const station = content.requireStation(rules.startingStationId as StationId);
  const hull = content.requireHull(rules.starterHullId as HullId);
  const shipId = entityIdOf(campaignId, 1);
  const location = { kind: 'station' as const, stationId: station.id, systemId: station.systemId };

  const draft: AssetDraft = {
    campaignId,
    nextEntityOrdinal: 2,
    assets: {
      version: 0,
      credits: rules.startingCredits,
      location,
      activeShipId: shipId,
      lastDockedStationId: station.id,
      ships: {},
      inventories: {},
      stacks: {},
    },
  };

  const service = inventoryService(draft, content);
  const hangar = service.create({ kind: 'hangar', stationId: station.id }, { kind: 'unlimited' });
  const cargo = service.create(
    { kind: 'cargo', shipId },
    { kind: 'limited', volumeCubicDecimetres: hull.cargoCapacityCubicDecimetres },
  );
  const fitting = service.create({ kind: 'fitting', shipId }, { kind: 'unlimited' });

  draft.assets.ships[shipId] = {
    id: shipId,
    owner: 'player',
    hullId: hull.id,
    location,
    cargoInventoryId: cargo,
    fittingInventoryId: fitting,
    condition: {
      damage: { shield: 0, armor: 0, hull: 0 },
      capacitorCharge: 0,
    },
    insurance: { coverage: 'basic', premiumPaidCredits: 0 },
    recoveryGrant: false,
  };

  for (const item of [...rules.startingItems].sort(byDefinitionId)) {
    service.add(hangar, item.definitionId as DefinitionId, item.quantity, {
      grantedQuantity: item.quantity,
      purchasedQuantity: 0,
      purchaseCostCredits: 0,
    });
  }

  const missing = applyDraftTo(draft, content, startingDraft(shipId, rules.startingFit));
  if (missing.length > 0) {
    throw new TypeError(
      `The starting fit needs "${missing[0]?.definitionId ?? ''}", which the starting items do not supply.`,
    );
  }

  // A new ship leaves the yard with a full capacitor.
  const ship = draft.assets.ships[shipId];
  if (ship !== undefined) {
    const derived = deriveShipAttributes({
      hull,
      fit: shipFit(draft.assets, shipId),
      content,
    });
    draft.assets.ships[shipId] = {
      ...ship,
      condition: { ...ship.condition, capacitorCharge: attributeValue(derived, 'capacitorCapacity') },
    };
  }

  // Creation uses the ordinary inventory writer several times; consumers need
  // only one initial aggregate version, independent of how the fit was assembled.
  draft.assets.version = 1;

  return draft;
}

function startingDraft(shipId: EntityId, entries: readonly StartingFitEntry[]): FittingDraft {
  const slots: Record<string, PlannedSlot> = {};
  for (const entry of entries) {
    slots[slotKey({ kind: entry.slot, index: entry.index })] = {
      moduleId: entry.moduleId as ModuleId,
      online: entry.online,
      ammunitionId: (entry.ammunitionId as AmmunitionId | undefined) ?? null,
    };
  }
  // Revision 0 is the uncommitted campaign the creating transaction commits.
  return { shipId, baseRevision: 0, slots };
}

function byDefinitionId(
  a: { readonly definitionId: string },
  b: { readonly definitionId: string },
): number {
  return a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0;
}
