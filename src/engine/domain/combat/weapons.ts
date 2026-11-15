import {
  weaponDamageMultiplierOf,
  weaponFamilyOf,
  type AmmunitionDefinition,
  type CombatRules,
  type DamageProfile,
  type TurretFamily,
  type WeaponModuleDefinition,
} from '@engine/ports';

import { attributeValue, familyDamageAttribute, type DerivedShipAttributes } from '../attributes';

import { listedDamage } from './formulas';

/**
 * What one weapon does with one charge on one ship
 * (Functional Specification 8.5, 9.4-9.6; Technical Specification 10.2).
 *
 * Fitting summaries, the tactical projection, a shot, a launch and the
 * opponent's range choice all read this one profile, so a family damage bonus
 * or a tracking enhancer cannot reach one surface and miss another. The
 * weapon's own statistics come from its definition and its charge; fitted
 * weapon-scoped multipliers (`weapon.*` attributes) are the only thing the
 * ship adds, so a small weapon on a large hull stays a small weapon.
 *
 * A charge the weapon does not accept is treated as no charge: listed damage
 * is zero rather than borrowed from an incompatible round.
 *
 * @implements FUNC-8.5, FUNC-9.5, FUNC-9.6, TECH-10.2, V02-AC-05, V02-AC-06
 */

export interface TurretProfile {
  readonly kind: 'turret';
  readonly family: TurretFamily;
  readonly optimalRangeKm: number;
  readonly falloffKm: number;
  /** optimal + 3 x falloff; beyond it a turret cannot hit at all. */
  readonly absoluteRangeKm: number;
  readonly trackingRadiansPerSecond: number;
  readonly signatureResolutionMetres: number;
  /** Listed damage of one shot, after the weapon and fitted family multipliers. */
  readonly damagePerShot: DamageProfile;
}

export interface GuidedProfile {
  readonly kind: 'guided';
  readonly flightSpeedKmPerSecond: number;
  readonly flightTimeSeconds: number;
  /** Speed x flight time: the reach against a stationary target. */
  readonly maximumFlightDistanceKm: number;
  readonly explosionRadiusMetres: number;
  readonly explosionVelocityKmPerSecond: number;
  readonly damagePerShot: DamageProfile;
}

export type WeaponProfile = TurretProfile | GuidedProfile;

export function weaponProfile(
  module: WeaponModuleDefinition,
  charge: AmmunitionDefinition | undefined,
  derived: DerivedShipAttributes | null,
  rules: CombatRules,
): WeaponProfile {
  const multiplier = (attribute: string): number =>
    derived === null ? 1 : attributeValue(derived, attribute, 1);
  const family = weaponFamilyOf(module);
  const accepted = charge !== undefined && charge.family === family && charge.size === module.size
    ? charge
    : undefined;
  const familyAttribute = familyDamageAttribute(family);
  const damagePerShot = listedDamage(
    accepted?.damagePerShot,
    weaponDamageMultiplierOf(module) * (familyAttribute === null ? 1 : multiplier(familyAttribute)),
  );

  if (module.category === 'turret') {
    const turretCharge = accepted !== undefined && accepted.family !== 'guided' ? accepted : undefined;
    const optimalRangeKm = module.turret.optimalRangeKm * (turretCharge?.optimalRangeMultiplier ?? 1);
    const falloffKm = module.turret.falloffKm * (turretCharge?.falloffMultiplier ?? 1);
    return {
      kind: 'turret',
      family: module.turret.family,
      optimalRangeKm,
      falloffKm,
      absoluteRangeKm: optimalRangeKm + rules.absoluteRangeFalloffMultiples * Math.max(0, falloffKm),
      trackingRadiansPerSecond:
        module.turret.trackingRadiansPerSecond *
        (turretCharge?.trackingMultiplier ?? 1) *
        multiplier('weapon.turret.tracking'),
      signatureResolutionMetres: module.turret.signatureResolutionMetres,
      damagePerShot,
    };
  }

  const guided = accepted !== undefined && accepted.family === 'guided' ? accepted.guided : undefined;
  const flightSpeedKmPerSecond = guided?.flightSpeedKmPerSecond ?? 0;
  const flightTimeSeconds = guided?.flightTimeSeconds ?? 0;
  return {
    kind: 'guided',
    flightSpeedKmPerSecond,
    flightTimeSeconds,
    maximumFlightDistanceKm: flightSpeedKmPerSecond * flightTimeSeconds,
    explosionRadiusMetres:
      (guided?.explosionRadiusMetres ?? 0) * multiplier('weapon.guided.explosionRadius'),
    explosionVelocityKmPerSecond:
      (guided?.explosionVelocityKmPerSecond ?? 0) * multiplier('weapon.guided.explosionVelocity'),
    damagePerShot,
  };
}

/**
 * The distance a weapon can usefully engage at: a turret's optimal range, or
 * a guided charge's stationary-target flight distance.
 */
export function engagementRangeKm(profile: WeaponProfile): number {
  return profile.kind === 'turret' ? profile.optimalRangeKm : profile.maximumFlightDistanceKm;
}
