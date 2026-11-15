import { DAMAGE_TYPES } from '@engine/ports';
import { isDefinitionIdIn } from '@shared';

import { isEntityId } from '../campaign/identity';
import type { CampaignDraft, CampaignState } from '../campaign/state';
import { parseSlotKey } from '../fitting/types';

import type { ProjectileState } from './types';

/**
 * Guided projectiles in flight (Functional Specification 9.6; Technical
 * Specification 8.2, 9.2, 15.3).
 *
 * A projectile is a record of the loaded site. Its two boundaries - contact
 * and expiry - are owned by the projectile itself, so neither dangles when its
 * source is destroyed or leaves. The boundary kinds are spelled out here
 * rather than imported because the domain may not reach the simulation
 * package; a unit test holds the lists together.
 *
 * @implements FUNC-9.6, TECH-8.2, TECH-15.3, V02-AC-06, V02-AC-13
 */

export const PROJECTILE_IMPACT_KIND = 'combat.projectileImpact';
export const PROJECTILE_EXPIRY_KIND = 'combat.projectileExpiry';

/** The projectiles of a draft, as a list the simulation may change. */
export function mutableProjectiles(draft: CampaignDraft): ProjectileState[] {
  return draft.combat.projectiles as ProjectileState[];
}

export function projectileById(state: CampaignState, id: string): ProjectileState | null {
  return state.combat.projectiles.find((projectile) => projectile.id === id) ?? null;
}

/** Projectiles following one target, in launch order. */
export function projectilesTargeting(state: CampaignState, targetId: string): readonly ProjectileState[] {
  return state.combat.projectiles.filter((projectile) => projectile.targetId === targetId);
}

const PROJECTILE_KEYS = [
  'id', 'sourceShipId', 'sourceSlotKey', 'moduleId', 'ammunitionId', 'targetId', 'launchedAtMs',
  'position', 'flightSpeedKmPerSecond', 'expiresAtMs', 'damage', 'explosionRadiusMetres',
  'explosionVelocityKmPerSecond', 'expiryBoundaryEntryId', 'impactBoundaryEntryId',
] as const;

export function isProjectileState(value: unknown): value is ProjectileState {
  if (!shape(value, PROJECTILE_KEYS)) return false;
  const position = value['position'];
  const damage = value['damage'];
  return (
    isEntityId(value['id']) &&
    isEntityId(value['sourceShipId']) &&
    typeof value['sourceSlotKey'] === 'string' && parseSlotKey(value['sourceSlotKey']) !== null &&
    isDefinitionIdIn(value['moduleId'], 'module') &&
    isDefinitionIdIn(value['ammunitionId'], 'ammo') &&
    typeof value['targetId'] === 'string' && value['targetId'].length > 0 &&
    count(value['launchedAtMs']) &&
    shape(position, ['x', 'y']) && finite(position['x']) && finite(position['y']) &&
    positive(value['flightSpeedKmPerSecond']) &&
    count(value['expiresAtMs']) && (value['expiresAtMs'] as number) >= (value['launchedAtMs'] as number) &&
    shape(damage, [...DAMAGE_TYPES]) && Object.values(damage).every(nonNegative) &&
    nonNegative(value['explosionRadiusMetres']) &&
    nonNegative(value['explosionVelocityKmPerSecond']) &&
    isEntityId(value['expiryBoundaryEntryId']) &&
    (value['impactBoundaryEntryId'] === null || isEntityId(value['impactBoundaryEntryId']))
  );
}

/**
 * Projectile consistency (Technical Specification 15.3, checks 7 and 8): each
 * one follows a live target in the loaded site, owns its pending boundaries,
 * has not outlived its flight time, and names its source by a retained value.
 * Nothing in flight may survive the site being unloaded.
 */
export function validateProjectiles(
  state: CampaignState,
  fail: (path: string, detail: string) => void,
): void {
  const site = state.navigation.currentSite;
  const ids = new Set<string>();
  state.combat.projectiles.forEach((projectile, index) => {
    const path = `projectiles[${String(index)}]`;
    if (ids.has(projectile.id)) fail(path, 'A projectile id is used twice.');
    ids.add(projectile.id);
    if (site === null) {
      fail(path, 'A projectile cannot remain in flight once its site is unloaded.');
      return;
    }
    const target = site.objects[projectile.targetId];
    if (target === undefined || target.kind !== 'ship') {
      fail(path, 'A projectile must follow a ship present in the loaded site.');
    }
    if (projectile.launchedAtMs > state.time.simulationTimeMs) {
      fail(path, 'A projectile cannot have been launched in the future.');
    }
    if (projectile.expiresAtMs < state.time.simulationTimeMs) {
      fail(path, 'A projectile cannot outlive its flight time.');
    }
    checkOwnedBoundary(state, projectile.expiryBoundaryEntryId, projectile.id, PROJECTILE_EXPIRY_KIND, path, fail);
    if (projectile.impactBoundaryEntryId !== null) {
      checkOwnedBoundary(state, projectile.impactBoundaryEntryId, projectile.id, PROJECTILE_IMPACT_KIND, path, fail);
    }
  });
}

function checkOwnedBoundary(
  state: CampaignState,
  entryId: string,
  ownerId: string,
  kind: string,
  path: string,
  fail: (path: string, detail: string) => void,
): void {
  const entry = state.scheduler.entries.find((candidate) => candidate.entryId === entryId);
  if (entry === undefined || entry.ownerId !== ownerId || entry.kind !== kind) {
    fail(path, `The ${kind} boundary must exist and belong to this projectile.`);
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}
function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
