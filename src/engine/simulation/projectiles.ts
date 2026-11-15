import {
  allocateEntityId,
  distance,
  guidedApplication,
  magnitude,
  mutableProjectiles,
  PROJECTILE_EXPIRY_KIND,
  PROJECTILE_IMPACT_KIND,
  scaleDamage,
  shipCombat,
  subtract,
  targetSignatureMetres,
  totalDamage,
  weaponProfile,
  type CombatantContext,
  type GuidedImpactOutcome,
  type ProjectileState,
  type SchedulerEntry,
  type WeaponContext,
} from '@engine/domain';
import { DAMAGE_TYPES, type AmmunitionDefinition } from '@engine/ports';

import { applyDamageToShip } from './combatDamage';
import type { SimulationContext } from './context';
import { cancelBoundary, scheduleBoundary } from './scheduler';

/**
 * Guided projectiles from launch to impact or expiry
 * (Functional Specification 9.4, 9.6; Technical Specification 9.2, 10.3).
 *
 * A guided weapon's cycle ends in a launch, not in damage: the reserved round
 * is consumed and a projectile record carrying every launch parameter is
 * added to the site. Each quantum the projectile flies toward its target's
 * current position. When movement brings it into contact, a contact boundary
 * is scheduled for that instant, so impacts resolve in the completion batch
 * with every other damage result, in scheduler order. Its expiry was
 * scheduled at launch with a later priority, so a contact and an expiry at
 * the same instant resolve as contact (Functional Specification 4.2).
 *
 * A projectile needs no lock once launched and survives its launcher being
 * deactivated, destroyed or gone: it holds only a retained source
 * attribution. It follows its original target alone; if that target is
 * destroyed or leaves the site the projectile is removed without damage or
 * refund. Nothing about it depends on a live source entity, so saving and
 * loading in flight reproduce the uninterrupted result exactly.
 *
 * @implements FUNC-9.4, FUNC-9.6, TECH-8.2, TECH-9.2, TECH-10.3, V02-AC-06, V02-AC-13
 */

export const PROJECTILE_IMPACT_BOUNDARY = PROJECTILE_IMPACT_KIND;
export const PROJECTILE_EXPIRY_BOUNDARY = PROJECTILE_EXPIRY_KIND;

/** After weapon cycles (40), before lock completion (50), like other damage. */
const IMPACT_PRIORITY = 45;
/** After every completion at the instant, so contact wins a tie. */
const EXPIRY_PRIORITY = 70;

/**
 * Launches one guided round from a weapon that has just completed its cycle.
 * The caller has consumed the round; this creates the projectile with the
 * parameters resolved now and schedules its expiry.
 */
export function launchProjectile(
  context: SimulationContext,
  combatant: CombatantContext,
  weapon: WeaponContext,
  targetId: string,
  charge: AmmunitionDefinition,
): ProjectileState | null {
  const target = context.draft.navigation.currentSite?.objects[targetId];
  if (target === undefined) return null;
  const profile = weaponProfile(weapon.module, charge, combatant.derived, context.content.rules.combat);
  if (profile.kind !== 'guided' || profile.flightSpeedKmPerSecond <= 0) return null;

  const now = context.draft.time.simulationTimeMs;
  const id = allocateEntityId(context.draft);
  const expiresAtMs = now + Math.max(1, Math.round(profile.flightTimeSeconds * 1000));
  const expiry = scheduleBoundary(context.draft, {
    kind: PROJECTILE_EXPIRY_BOUNDARY,
    dueAtMs: expiresAtMs,
    priority: EXPIRY_PRIORITY,
    ownerId: id,
  });
  // Launched at zero distance, a projectile is already in contact
  // (Functional Specification 9.6).
  const touching = distance(combatant.object.position, target.position) <= 0;
  const impact = touching
    ? scheduleBoundary(context.draft, {
        kind: PROJECTILE_IMPACT_BOUNDARY,
        dueAtMs: now,
        priority: IMPACT_PRIORITY,
        ownerId: id,
      })
    : null;

  const projectile: ProjectileState = {
    id,
    sourceShipId: combatant.shipId,
    sourceSlotKey: weapon.key,
    moduleId: weapon.module.id,
    ammunitionId: charge.id,
    targetId,
    launchedAtMs: now,
    position: { ...combatant.object.position },
    flightSpeedKmPerSecond: profile.flightSpeedKmPerSecond,
    expiresAtMs,
    damage: { ...profile.damagePerShot },
    explosionRadiusMetres: profile.explosionRadiusMetres,
    explosionVelocityKmPerSecond: profile.explosionVelocityKmPerSecond,
    expiryBoundaryEntryId: expiry.entryId,
    impactBoundaryEntryId: impact?.entryId ?? null,
  };
  mutableProjectiles(context.draft).push(projectile);
  context.publish('combat.projectileLaunched', {
    projectileId: id,
    sourceId: combatant.shipId,
    targetId,
    slot: weapon.key,
    moduleId: weapon.module.id,
    ammunitionId: charge.id,
    flightSeconds: profile.flightTimeSeconds,
  });
  changed(context);
  return projectile;
}

/**
 * Flies every projectile toward its target over one movement step
 * (Technical Specification 9.2, step 2). Contact found here becomes a
 * contact boundary at the step's end, resolved in the completion batch.
 */
export function advanceProjectiles(context: SimulationContext, fromTimeMs: number, toTimeMs: number): void {
  const elapsedSeconds = (toTimeMs - fromTimeMs) / 1000;
  const projectiles = mutableProjectiles(context.draft);
  if (elapsedSeconds <= 0 || projectiles.length === 0) return;
  const site = context.draft.navigation.currentSite;
  if (site === null) return;

  let moved = false;
  for (let index = 0; index < projectiles.length; index += 1) {
    const projectile = projectiles[index];
    if (projectile === undefined || projectile.impactBoundaryEntryId !== null) continue;
    const target = site.objects[projectile.targetId];
    if (target === undefined) continue;
    const reach = projectile.flightSpeedKmPerSecond * elapsedSeconds;
    const offset = subtract(target.position, projectile.position);
    const gap = magnitude(offset);
    if (gap <= reach) {
      const impact = scheduleBoundary(context.draft, {
        kind: PROJECTILE_IMPACT_BOUNDARY,
        dueAtMs: toTimeMs,
        priority: IMPACT_PRIORITY,
        ownerId: projectile.id,
      });
      projectiles[index] = {
        ...projectile,
        position: { ...target.position },
        impactBoundaryEntryId: impact.entryId,
      };
    } else {
      const fraction = reach / gap;
      projectiles[index] = {
        ...projectile,
        position: {
          x: round(projectile.position.x + offset.x * fraction),
          y: round(projectile.position.y + offset.y * fraction),
        },
      };
    }
    moved = true;
  }
  if (moved) {
    context.invalidate('site');
    context.invalidate('combat');
  }
}

/**
 * Resolves contact (Functional Specification 9.6): the guided multiplier is
 * taken from the target's signature and speed at this instant, applied to the
 * damage fixed at launch, and the result goes through the shared layer
 * damage. The projectile is then gone; it can never hit twice.
 */
export function resolveProjectileImpact(context: SimulationContext, entry: SchedulerEntry): void {
  const projectile = takeProjectile(context, entry, (candidate) => candidate.impactBoundaryEntryId);
  if (projectile === null) return;
  cancelBoundary(context.draft, projectile.expiryBoundaryEntryId);

  const target = context.draft.navigation.currentSite?.objects[projectile.targetId];
  if (target === undefined || shipCombat(context.draft, projectile.targetId).destroyedAtMs !== null) {
    publishRemoved(context, projectile, 'targetMissing');
    changed(context);
    return;
  }

  const application = guidedApplication(
    {
      explosionRadiusMetres: projectile.explosionRadiusMetres,
      explosionVelocityKmPerSecond: projectile.explosionVelocityKmPerSecond,
      targetSignatureMetres: targetSignatureMetres(context.draft, context.content, target),
      targetSpeedKmPerSecond: magnitude(target.velocity),
    },
    context.content.rules.combat,
  );
  const damage = scaleDamage(projectile.damage, application.damageMultiplier);
  const outcome: GuidedImpactOutcome = {
    projectileId: projectile.id,
    sourceShipId: projectile.sourceShipId,
    targetId: projectile.targetId,
    slotKey: projectile.sourceSlotKey,
    moduleId: projectile.moduleId,
    ammunitionId: projectile.ammunitionId,
    signatureFactor: application.signatureFactor,
    speedFactor: application.speedFactor,
    damageMultiplier: application.damageMultiplier,
    damage,
    totalDamage: totalDamage(damage),
  };
  context.publish('combat.projectileImpact', {
    projectileId: outcome.projectileId,
    attackerId: outcome.sourceShipId,
    targetId: outcome.targetId,
    slot: outcome.slotKey,
    moduleId: outcome.moduleId,
    ammunitionId: outcome.ammunitionId,
    signatureFactor: outcome.signatureFactor,
    speedFactor: outcome.speedFactor,
    damageMultiplier: outcome.damageMultiplier,
    totalDamage: outcome.totalDamage,
    ...Object.fromEntries(DAMAGE_TYPES.map((type) => [`damage.${type}`, outcome.damage[type]])),
  });
  applyDamageToShip(context, {
    attackerId: outcome.sourceShipId,
    targetId: outcome.targetId,
    slotKey: outcome.slotKey,
    damage,
  });
  changed(context);
}

/** Flight time ran out before contact: a miss (Functional Specification 9.6). */
export function resolveProjectileExpiry(context: SimulationContext, entry: SchedulerEntry): void {
  const projectile = takeProjectile(context, entry, (candidate) => candidate.expiryBoundaryEntryId);
  if (projectile === null) return;
  if (projectile.impactBoundaryEntryId !== null) cancelBoundary(context.draft, projectile.impactBoundaryEntryId);
  publishRemoved(context, projectile, 'expired');
  changed(context);
}

/**
 * Removes, without damage or refund, every projectile following a ship that
 * was destroyed or left the site (Functional Specification 9.6; Technical
 * Specification 10.1). Projectiles the ship launched are left alone.
 */
export function removeProjectilesTargeting(context: SimulationContext, targetId: string): void {
  const projectiles = mutableProjectiles(context.draft);
  const kept: ProjectileState[] = [];
  let removed = false;
  for (const projectile of projectiles) {
    if (projectile.targetId !== targetId) {
      kept.push(projectile);
      continue;
    }
    cancelProjectileBoundaries(context, projectile);
    publishRemoved(context, projectile, 'targetMissing');
    removed = true;
  }
  if (!removed) return;
  projectiles.length = 0;
  projectiles.push(...kept);
  changed(context);
}

/** Nothing stays in flight once the site it belongs to is unloaded. */
export function clearProjectiles(context: SimulationContext): void {
  const projectiles = mutableProjectiles(context.draft);
  if (projectiles.length === 0) return;
  for (const projectile of projectiles) {
    cancelProjectileBoundaries(context, projectile);
    publishRemoved(context, projectile, 'siteLeft');
  }
  projectiles.length = 0;
  changed(context);
}

function cancelProjectileBoundaries(context: SimulationContext, projectile: ProjectileState): void {
  cancelBoundary(context.draft, projectile.expiryBoundaryEntryId);
  if (projectile.impactBoundaryEntryId !== null) cancelBoundary(context.draft, projectile.impactBoundaryEntryId);
}

function takeProjectile(
  context: SimulationContext,
  entry: SchedulerEntry,
  boundaryOf: (projectile: ProjectileState) => string | null,
): ProjectileState | null {
  const projectiles = mutableProjectiles(context.draft);
  const index = projectiles.findIndex(
    (candidate) => candidate.id === entry.ownerId && boundaryOf(candidate) === entry.entryId,
  );
  if (index < 0) return null;
  const [projectile] = projectiles.splice(index, 1);
  return projectile ?? null;
}

function publishRemoved(
  context: SimulationContext,
  projectile: ProjectileState,
  reason: 'expired' | 'targetMissing' | 'siteLeft',
): void {
  context.publish('combat.projectileRemoved', {
    projectileId: projectile.id,
    sourceId: projectile.sourceShipId,
    targetId: projectile.targetId,
    slot: projectile.sourceSlotKey,
    reason,
  });
}

function changed(context: SimulationContext): void {
  context.draft.combat.version += 1;
  context.invalidate('combat');
  context.invalidate('site');
  context.invalidate('frame');
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
