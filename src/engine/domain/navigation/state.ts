import type { ContentRepository } from '@engine/ports';
import type { SiteId, StationId } from '@shared';
import { allocateEntityId } from '../campaign/allocation';
import type { EntityId } from '../campaign/identity';
import type { CampaignDraft } from '../campaign/state';
import type { ShipIdentity } from '../assets';
import type { SiteObjectState, SiteRuntime, Vector2 } from './types';

export function instantiateSite(
  draft: CampaignDraft,
  content: ContentRepository,
  siteId: SiteId,
  ship: ShipIdentity,
  shipPosition: Vector2,
  facingRadians: number,
): SiteRuntime {
  const system = content.requireSystem(ship.location.systemId);
  const site = system.sites.find((candidate) => candidate.id === siteId);
  if (site === undefined) throw new TypeError(`Site "${siteId}" is not in "${system.id}".`);

  const objects: Record<string, SiteObjectState> = {};
  const station = content.stations().find((candidate) => candidate.siteId === siteId);
  if (station !== undefined) {
    objects[station.id] = {
      id: station.id,
      kind: 'station',
      definitionId: station.id,
      nameKey: station.nameKey,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      facingRadians: 0,
      radiusKm: content.rules.navigation.stationRadiusKm,
      movable: false,
    };
  }
  const hull = content.requireHull(ship.hullId);
  objects[ship.id] = {
    id: ship.id,
    kind: 'ship',
    definitionId: ship.hullId,
    nameKey: hull.nameKey,
    position: { ...shipPosition },
    velocity: { x: 0, y: 0 },
    facingRadians,
    radiusKm: hull.signatureRadiusMetres / 2000,
    movable: true,
  };
  return {
    instanceId: allocateEntityId(draft),
    systemId: system.id,
    siteId,
    objects,
  };
}

export function siteDefinitionPosition(
  content: ContentRepository,
  systemId: string,
  siteId: string,
): Vector2 | null {
  const site = content.system(systemId)?.sites.find((candidate) => candidate.id === siteId);
  return site === undefined ? null : { x: site.position.xKm, y: site.position.yKm };
}

export function stationAtSite(content: ContentRepository, siteId: string): StationId | null {
  return content.stations().find((station) => station.siteId === siteId)?.id ?? null;
}

export function activeSiteObject(draft: CampaignDraft): SiteObjectState | null {
  return draft.navigation.currentSite?.objects[draft.assets.activeShipId] ?? null;
}

export function replaceSiteObject(
  draft: CampaignDraft,
  object: SiteObjectState,
): void {
  const site = draft.navigation.currentSite;
  if (site === null) return;
  site.objects[object.id] = object;
}

export function schedulerOwnerOfSite(site: SiteRuntime): EntityId {
  return site.instanceId;
}
