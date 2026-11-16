import {
  DAMAGE_TYPES,
  DEFENSE_LAYERS,
  type ContentRepository,
  type HullDefinition,
  type ModuleDefinition,
} from '@engine/ports';

import type { MessageKey } from '@shared';

import type { FitDescription } from '../fitting/types';

import { operatorModifiers, WEAPON_MODIFIER_ATTRIBUTES } from './operators';
import {
  resistanceAttribute,
  SHIP_ATTRIBUTES,
  type AttributeModifier,
  type ShipAttribute,
} from './modifiers';
import { evaluateAttributes, type AttributeRequest, type DerivedAttribute } from './pipeline';

/**
 * Ship statistics derived from a hull and a fit
 * (Functional Specification 8.2, 8.4; Technical Specification 10.2).
 *
 * The hull supplies every base value, and each online module contributes the
 * modifiers its category declares. An offline module contributes nothing: it
 * keeps its slot, draws no power or processing and provides no modifier
 * (Functional Specification 8.4).
 *
 * Nothing here decides whether a fit is legal. It derives what the fit would
 * do; `../fitting/validity` decides whether it may be undocked with.
 *
 * @implements FUNC-8.2, FUNC-4.4, TECH-10.2
 */

/** Assumption name for "the fitted propulsion module is running". */
export const PROPULSION_ACTIVE = 'propulsion.active';

export interface DerivedShipAttributes {
  readonly hull: HullDefinition;
  readonly attributes: Readonly<Record<string, DerivedAttribute>>;
  /** Every modifier the fit contributed, for diagnostics and explanations. */
  readonly modifiers: readonly AttributeModifier[];
}

export interface ShipAttributeInput {
  readonly hull: HullDefinition;
  readonly fit: FitDescription;
  readonly content: ContentRepository;
  /** Activation assumptions the preview is taken under. */
  readonly conditions?: ReadonlySet<string>;
  /** Temporary speed reductions on the ship (Functional Specification 9.9). */
  readonly speedEffects?: readonly SpeedEffectInput[];
}

/**
 * One temporary speed reduction as the pipeline applies it: a hostile effect,
 * not a fitted modifier, so it is undiminished and effects of different
 * sources multiply (Functional Specification 9.9).
 */
export interface SpeedEffectInput {
  /** Definition id of the module that applied it, for the trace. */
  readonly sourceId: string;
  readonly sourceKey: MessageKey;
  /** The factor maximum speed is multiplied by, above 0 and below 1. */
  readonly speedFactor: number;
}

export function deriveShipAttributes(input: ShipAttributeInput): DerivedShipAttributes {
  const { hull, content } = input;
  const modifiers: AttributeModifier[] = [];

  for (const fitted of input.fit) {
    if (!fitted.online) {
      continue;
    }
    const module = content.module(fitted.moduleId);
    if (module !== undefined) {
      modifiers.push(...moduleModifiers(module));
    }
  }

  const resistanceMaximum = content.rules.combat.resistanceMaximum;
  const requests: AttributeRequest[] = [];
  const effects = input.speedEffects ?? [];

  for (const attribute of SHIP_ATTRIBUTES) {
    const slowed = attribute === 'maxSpeedKmPerSecond' && effects.length > 0;
    requests.push({
      attribute,
      base: baseAttribute(hull, attribute),
      modifiers: slowed ? [...modifiers, ...speedEffectModifiers(effects)] : modifiers,
      // A speed reduction never takes a ship below its floor: a share of the
      // hull's unmodified maximum (Functional Specification 9.9). The floor
      // only exists while something is slowing the ship.
      minimum: slowed
        ? hull.movement.maxSpeedKmPerSecond * content.rules.combat.speedReductionFloorFraction
        : 0,
      ...(WHOLE_ATTRIBUTES.has(attribute) ? { whole: true } : {}),
      ...(input.conditions === undefined ? {} : { conditions: input.conditions }),
    });
  }

  for (const layer of DEFENSE_LAYERS) {
    for (const damageType of DAMAGE_TYPES) {
      requests.push({
        attribute: resistanceAttribute(layer, damageType),
        base: hull.defenses[layer].resistances[damageType],
        modifiers,
        minimum: 0,
        maximum: resistanceMaximum,
        ...(input.conditions === undefined ? {} : { conditions: input.conditions }),
      });
    }
  }

  // Weapon-scoped multipliers start at 1: the hull contributes nothing, so a
  // weapon performs as itself on any hull (Functional Specification 8.4).
  for (const attribute of WEAPON_MODIFIER_ATTRIBUTES) {
    requests.push({
      attribute,
      base: 1,
      modifiers,
      minimum: 0,
      ...(input.conditions === undefined ? {} : { conditions: input.conditions }),
    });
  }

  return { hull, attributes: evaluateAttributes(requests), modifiers };
}

/**
 * Speed effects as intrinsic multipliers: applied after every fitted
 * modifier, undiminished, one step per source so the trace names each.
 */
function speedEffectModifiers(effects: readonly SpeedEffectInput[]): readonly AttributeModifier[] {
  return effects.map((effect) => ({
    attribute: 'maxSpeedKmPerSecond',
    operation: 'percent' as const,
    value: effect.speedFactor - 1,
    stage: 'intrinsic' as const,
    sourceId: effect.sourceId,
    sourceKey: effect.sourceKey,
  }));
}

/** The derived value of one attribute, or the fallback when it is absent. */
export function attributeValue(
  derived: DerivedShipAttributes,
  attribute: string,
  fallback = 0,
): number {
  return derived.attributes[attribute]?.value ?? fallback;
}

/** Attributes that count whole units and are floored at the final step. */
const WHOLE_ATTRIBUTES = new Set<string>(['cargoCapacityCubicDecimetres', 'maxLockedTargets']);

function baseAttribute(hull: HullDefinition, attribute: ShipAttribute): number {
  switch (attribute) {
    case 'accelerationKmPerSecondSquared':
      return hull.movement.accelerationKmPerSecondSquared;
    case 'armorHitPoints':
      return hull.defenses.armor.hitPoints;
    case 'brakingKmPerSecondSquared':
      return hull.movement.brakingKmPerSecondSquared;
    case 'capacitorCapacity':
      return hull.capacitor.capacity;
    case 'capacitorRechargeSeconds':
      return hull.capacitor.rechargeSeconds;
    case 'cargoCapacityCubicDecimetres':
      return hull.cargoCapacityCubicDecimetres;
    case 'hullHitPoints':
      return hull.defenses.hull.hitPoints;
    case 'maxLockRangeKm':
      return hull.targeting.maxLockRangeKm;
    case 'maxLockedTargets':
      return hull.targeting.maxLockedTargets;
    case 'maxSpeedKmPerSecond':
      return hull.movement.maxSpeedKmPerSecond;
    case 'powerOutput':
      return hull.fitting.powerOutput;
    case 'processingOutput':
      return hull.fitting.processingOutput;
    case 'scanResolution':
      return hull.targeting.scanResolution;
    case 'shieldHitPoints':
      return hull.defenses.shield.hitPoints;
    case 'shieldRechargeSeconds':
      return hull.shieldRechargeSeconds;
    case 'signatureRadiusMetres':
      return hull.signatureRadiusMetres;
    case 'turnRateRadiansPerSecond':
      return hull.movement.turnRateRadiansPerSecond;
    default:
      return unreachable(attribute);
  }
}

/**
 * The modifiers one online module contributes.
 *
 * A module category is a closed engine enumeration and the values it carries
 * are content, so adding a tuning value never touches this function while
 * adding a category is a deliberate engine change.
 */
function moduleModifiers(module: ModuleDefinition): readonly AttributeModifier[] {
  const source = { sourceId: module.id, sourceKey: module.nameKey };

  switch (module.category) {
    case 'propulsion':
      return [
        {
          ...source,
          attribute: 'maxSpeedKmPerSecond',
          operation: 'percent',
          value: module.propulsion.speedBonusFraction,
          stage: 'fitted',
          condition: PROPULSION_ACTIVE,
        },
        {
          ...source,
          attribute: 'signatureRadiusMetres',
          operation: 'percent',
          value: module.propulsion.signatureRadiusPenaltyFraction,
          stage: 'fitted',
          condition: PROPULSION_ACTIVE,
        },
      ];

    case 'capacitorBattery':
      return [
        {
          ...source,
          attribute: 'capacitorCapacity',
          operation: 'add',
          value: module.capacitorSupport.capacityBonus,
          stage: 'flat',
        },
        {
          // A recharge bonus shortens the recharge time, so it is a negative
          // percentage of the attribute it modifies.
          ...source,
          attribute: 'capacitorRechargeSeconds',
          operation: 'percent',
          value: -module.capacitorSupport.rechargeBonusFraction,
          stage: 'fitted',
        },
      ];

    case 'resistancePlating':
    case 'resistanceAmplifier':
      return DAMAGE_TYPES.map((damageType) => ({
        ...source,
        attribute: resistanceAttribute(module.resistance.layer, damageType),
        operation: 'resistance' as const,
        value: module.resistance.bonuses[damageType],
        stage: 'fitted' as const,
      }));

    case 'shieldExtender':
    case 'shieldRecharger':
    case 'capacitorRecharger':
    case 'weaponUpgrade':
      return operatorModifiers(module);

    case 'turret':
    case 'launcher':
    case 'shieldBooster':
    case 'armorRepairer':
    case 'web':
      // These act through their own operation rather than by changing a ship
      // attribute; the fitting summary derives what they do.
      return [];

    default:
      return unreachableModule(module);
  }
}

function unreachable(attribute: never): never {
  throw new TypeError(`Unknown ship attribute: ${String(attribute)}.`);
}

function unreachableModule(module: never): never {
  throw new TypeError(`Unknown module category: ${JSON.stringify(module)}.`);
}
