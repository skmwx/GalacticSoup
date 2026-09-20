import type { ContentRepository } from '@engine/ports';
import type { DefinitionId, StationId, HullId } from '@shared';
import { entityIdOf, type CampaignId } from '../campaign/identity';
import { inventoryService } from './inventory';
import type { AssetDraft } from './types';

/** Unfitted starting assets; Phase 6 assembles their fit. @implements FUNC-3.1, TECH-8.2 */
export function startingAssets(campaignId: CampaignId, content: ContentRepository): AssetDraft {
  const rules = content.rules.economy;
  const station = content.requireStation(rules.startingStationId as StationId);
  const hull = content.requireHull(rules.starterHullId as HullId);
  const shipId = entityIdOf(campaignId, 1);
  const location = { kind: 'station' as const, stationId: station.id, systemId: station.systemId };
  const draft: AssetDraft = { campaignId, nextEntityOrdinal: 2, assets: {
    credits: rules.startingCredits, location, activeShipId: shipId,
    ships: {}, inventories: {}, stacks: {},
  } };
  const service = inventoryService(draft, content);
  const hangar = service.create({ kind: 'hangar', stationId: station.id }, { kind: 'unlimited' });
  const cargo = service.create({ kind: 'cargo', shipId },
    { kind: 'limited', volumeCubicDecimetres: hull.cargoCapacityCubicDecimetres });
  draft.assets.ships[shipId] = { id: shipId, hullId: hull.id, location, cargoInventoryId: cargo };
  for (const item of [...rules.startingItems].sort((a, b) => a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0)) {
    service.add(hangar, item.definitionId as DefinitionId, item.quantity,
      { grantedQuantity: item.quantity, purchasedQuantity: 0, purchaseCostCredits: 0 });
  }
  return draft;
}
