import {
  DAMAGE_TYPES,
  DEFENSE_LAYERS,
  type ContentRepository,
  type DamageProfile,
  type DamageType,
  type DefenseLayer,
  type HullDefinition,
} from '@engine/ports';
import type { AmmunitionId, ModuleId } from '@shared';

import {
  attributeValue,
  resistanceAttribute,
  type DerivedShipAttributes,
} from '../attributes';

import type { FitDescription, FitWarning, SlotRef } from './types';

/**
 * What a fit would do (Functional Specification 8.5).
 *
 * The fitting screen has to answer more than "is this legal": weapon damage,
 * range, falloff and tracking with the loaded charge; how long the capacitor
 * lasts under the stated assumptions; what the defences repair in a burst and
 * over time; and the warnings that stop short of making the fit invalid.
 *
 * Everything here is derived. Nothing is stored, and every number is produced
 * from the same fit description the attribute pipeline reads.
 *
 * @implements FUNC-8.5, FUNC-19.6, MVP-AC-04
 */

export interface WeaponSummary {
  readonly slot: SlotRef;
  readonly moduleId: ModuleId;
  readonly online: boolean;
  readonly ammunitionId: AmmunitionId | null;
  readonly loadedRounds: number;
  readonly magazineSize: number;
  readonly optimalRangeKm: number;
  readonly falloffKm: number;
  /** Beyond this range a turret cannot hit at all (Functional Specification 9.5). */
  readonly absoluteRangeKm: number;
  readonly trackingRadiansPerSecond: number;
  readonly signatureResolutionMetres: number;
  readonly cycleSeconds: number;
  readonly capacitorPerCycle: number;
  /** Listed damage of one shot, after the turret's own multiplier. */
  readonly damagePerShot: DamageProfile;
  readonly volleyDamage: number;
  readonly damagePerSecond: number;
}

export interface CapacitorSummary {
  readonly capacity: number;
  readonly rechargeSeconds: number;
  readonly rechargePerSecond: number;
  /** Draw of every online module assumed to run continuously. */
  readonly drainPerSecond: number;
  readonly stable: boolean;
  /** How long the assumed activation lasts, or `null` while it is stable. */
  readonly enduranceSeconds: number | null;
}

export interface DefenseSummary {
  /** One cycle of every online repair module, by layer. */
  readonly burstHitPoints: Readonly<Record<DefenseLayer, number>>;
  /** Repair per second while those modules keep cycling. */
  readonly sustainedHitPointsPerSecond: Readonly<Record<DefenseLayer, number>>;
}

export interface FitSummary {
  readonly weapons: readonly WeaponSummary[];
  readonly capacitor: CapacitorSummary;
  readonly defense: DefenseSummary;
  readonly warnings: readonly FitWarning[];
}

export interface FitSummaryInput {
  readonly hull: HullDefinition;
  readonly fit: FitDescription;
  readonly content: ContentRepository;
  readonly derived: DerivedShipAttributes;
}

export function summariseFit(input: FitSummaryInput): FitSummary {
  const { content, fit, derived } = input;
  const warnings: FitWarning[] = [];
  const weapons: WeaponSummary[] = [];
  const burst = zeroLayers();
  const sustained = zeroLayers();
  let drainPerSecond = 0;

  for (const fitted of fit) {
    const module = content.module(fitted.moduleId);
    if (module === undefined) {
      continue;
    }
    if (!fitted.online) {
      warnings.push({ code: 'moduleOffline', slot: fitted.slot, params: { moduleId: module.id } });
    }

    if (fitted.online && module.activation !== undefined && module.activation.cycleSeconds > 0) {
      drainPerSecond += module.activation.capacitorPerCycle / module.activation.cycleSeconds;
    }

    if (module.category === 'shieldBooster' || module.category === 'armorRepairer') {
      const layer = module.repair.layer;
      const cycle = module.activation?.cycleSeconds ?? 0;
      if (fitted.online) {
        burst[layer] += module.repair.amountHitPoints;
        if (cycle > 0) {
          sustained[layer] += module.repair.amountHitPoints / cycle;
        }
      }
      continue;
    }

    if (module.category !== 'turret') {
      continue;
    }

    const charge = fitted.charge === null ? null : content.ammunition(fitted.charge.ammunitionId);
    if (charge === undefined || fitted.charge === null) {
      warnings.push({ code: 'noAmmunition', slot: fitted.slot, params: { moduleId: module.id } });
    }

    const turret = module.turret;
    const optimalRangeKm = turret.optimalRangeKm * (charge?.optimalRangeMultiplier ?? 1);
    const falloffKm = turret.falloffKm * (charge?.falloffMultiplier ?? 1);
    const cycleSeconds = module.activation?.cycleSeconds ?? 0;
    const damagePerShot = scaledDamage(charge?.damagePerShot, turret.damageMultiplier);
    const volleyDamage = DAMAGE_TYPES.reduce((total, type) => total + damagePerShot[type], 0);

    weapons.push({
      slot: fitted.slot,
      moduleId: module.id,
      online: fitted.online,
      ammunitionId: charge?.id ?? null,
      loadedRounds: fitted.charge?.quantity ?? 0,
      magazineSize: turret.magazineSize,
      optimalRangeKm,
      falloffKm,
      absoluteRangeKm:
        optimalRangeKm + content.rules.combat.absoluteRangeFalloffMultiples * falloffKm,
      trackingRadiansPerSecond: turret.trackingRadiansPerSecond * (charge?.trackingMultiplier ?? 1),
      signatureResolutionMetres: turret.signatureResolutionMetres,
      cycleSeconds,
      capacitorPerCycle: module.activation?.capacitorPerCycle ?? 0,
      damagePerShot,
      volleyDamage,
      damagePerSecond: cycleSeconds > 0 ? volleyDamage / cycleSeconds : 0,
    });
  }

  if (!weapons.some((weapon) => weapon.online)) {
    warnings.push({ code: 'noWeapon', slot: null, params: {} });
  }

  const capacitor = summariseCapacitor(derived, drainPerSecond);
  if (!capacitor.stable) {
    warnings.push({
      code: 'capacitorUnstable',
      slot: null,
      params: {
        drainPerSecond: capacitor.drainPerSecond,
        rechargePerSecond: capacitor.rechargePerSecond,
      },
    });
  }

  for (const damageType of uncoveredDamageTypes(derived)) {
    warnings.push({ code: 'uncoveredDamageType', slot: null, params: { damageType } });
  }

  return {
    weapons,
    capacitor,
    defense: { burstHitPoints: burst, sustainedHitPointsPerSecond: sustained },
    warnings,
  };
}

function summariseCapacitor(
  derived: DerivedShipAttributes,
  drainPerSecond: number,
): CapacitorSummary {
  const capacity = attributeValue(derived, 'capacitorCapacity');
  const rechargeSeconds = attributeValue(derived, 'capacitorRechargeSeconds');
  const rechargePerSecond = rechargeSeconds > 0 ? capacity / rechargeSeconds : 0;
  const deficit = drainPerSecond - rechargePerSecond;

  return {
    capacity,
    rechargeSeconds,
    rechargePerSecond,
    drainPerSecond,
    stable: deficit <= 0,
    enduranceSeconds: deficit > 0 ? capacity / deficit : null,
  };
}

/**
 * A damage type neither the shield nor the armour resists at all. The hull
 * layer is excluded: no hull resists anything, so including it would report
 * every damage type on every ship and say nothing.
 */
function uncoveredDamageTypes(derived: DerivedShipAttributes): readonly DamageType[] {
  return DAMAGE_TYPES.filter((damageType) =>
    (['shield', 'armor'] as const).every(
      (layer) => attributeValue(derived, resistanceAttribute(layer, damageType)) === 0,
    ),
  );
}

function scaledDamage(profile: DamageProfile | undefined, multiplier: number): DamageProfile {
  const scaled = {} as Record<DamageType, number>;
  for (const damageType of DAMAGE_TYPES) {
    scaled[damageType] = (profile?.[damageType] ?? 0) * multiplier;
  }
  return scaled;
}

function zeroLayers(): Record<DefenseLayer, number> {
  const layers = {} as Record<DefenseLayer, number>;
  for (const layer of DEFENSE_LAYERS) {
    layers[layer] = 0;
  }
  return layers;
}
