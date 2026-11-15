import type {
  ModifierModuleDefinition,
  ModifierOperator,
  ModuleCategory,
  WeaponFamily,
} from '@engine/ports';

import type { AttributeModifier, ModifierOperation, ModifierStage } from './modifiers';

/**
 * The reviewed passive modifier operators (Technical Specification 10.2;
 * Functional Specification 9.7; FeatureSpec02 5.1).
 *
 * Content names an operator and a positive magnitude. This registry - and
 * nothing in content - decides which attribute the operator reaches, with
 * which arithmetic, at which stage, in which direction, and which module
 * categories may use it. Semantic content validation holds a copy of the
 * category lists (`scripts/lib/content/semantic.mjs`, `OPERATOR_CATEGORIES`)
 * and a unit test keeps the two equal, so a module can never carry an effect
 * the engine does not execute.
 *
 * Every percentage operator is a fitted modifier: it is diminished together
 * with every other fitted modifier of the same attribute and direction
 * (Functional Specification 4.4), whatever operator produced it.
 *
 * @implements TECH-10.2, FUNC-4.4, FUNC-9.7, V02-AC-05
 */

/**
 * Weapon-scoped multipliers. Each is derived through the same pipeline as a
 * ship attribute, from a base of 1, so a family-restricted bonus stacks,
 * diminishes and explains itself exactly as a hull attribute does; the weapon
 * then multiplies its own value by it. A larger hull never changes a module's
 * own statistics: only a fitted modifier reaches these.
 */
export const WEAPON_MODIFIER_ATTRIBUTES = [
  'weapon.projectile.damage',
  'weapon.hybrid.damage',
  'weapon.turret.tracking',
  'weapon.guided.explosionRadius',
  'weapon.guided.explosionVelocity',
] as const;

export type WeaponModifierAttribute = (typeof WEAPON_MODIFIER_ATTRIBUTES)[number];

/** The damage multiplier attribute of one weapon family, if a modifier reaches it. */
export function familyDamageAttribute(family: WeaponFamily): WeaponModifierAttribute | null {
  if (family === 'projectile') return 'weapon.projectile.damage';
  if (family === 'hybrid') return 'weapon.hybrid.damage';
  return null;
}

export interface OperatorSpecification {
  readonly attribute: string;
  readonly operation: Extract<ModifierOperation, 'add' | 'percent'>;
  readonly stage: Extract<ModifierStage, 'flat' | 'fitted'>;
  /**
   * The sign the authored positive magnitude takes. A reduction in a recharge
   * time or an explosion radius is a negative percentage of that attribute.
   */
  readonly sign: 1 | -1;
  readonly categories: readonly ModuleCategory[];
}

export const OPERATOR_REGISTRY: Readonly<Record<ModifierOperator, OperatorSpecification>> = {
  shieldCapacity: {
    attribute: 'shieldHitPoints', operation: 'add', stage: 'flat', sign: 1,
    categories: ['shieldExtender'],
  },
  shieldRechargeTime: {
    attribute: 'shieldRechargeSeconds', operation: 'percent', stage: 'fitted', sign: -1,
    categories: ['shieldRecharger'],
  },
  capacitorRechargeTime: {
    attribute: 'capacitorRechargeSeconds', operation: 'percent', stage: 'fitted', sign: -1,
    categories: ['capacitorRecharger'],
  },
  signatureRadius: {
    attribute: 'signatureRadiusMetres', operation: 'percent', stage: 'fitted', sign: 1,
    categories: ['shieldExtender'],
  },
  projectileDamage: {
    attribute: 'weapon.projectile.damage', operation: 'percent', stage: 'fitted', sign: 1,
    categories: ['weaponUpgrade'],
  },
  hybridDamage: {
    attribute: 'weapon.hybrid.damage', operation: 'percent', stage: 'fitted', sign: 1,
    categories: ['weaponUpgrade'],
  },
  turretTracking: {
    attribute: 'weapon.turret.tracking', operation: 'percent', stage: 'fitted', sign: 1,
    categories: ['weaponUpgrade'],
  },
  guidedExplosionRadius: {
    attribute: 'weapon.guided.explosionRadius', operation: 'percent', stage: 'fitted', sign: -1,
    categories: ['weaponUpgrade'],
  },
  guidedExplosionVelocity: {
    attribute: 'weapon.guided.explosionVelocity', operation: 'percent', stage: 'fitted', sign: 1,
    categories: ['weaponUpgrade'],
  },
};

/** Whether a category may use an operator (Technical Specification 6.2). */
export function operatorAllowed(operator: ModifierOperator, category: ModuleCategory): boolean {
  return OPERATOR_REGISTRY[operator].categories.includes(category);
}

/**
 * The attribute modifiers one passive operator module contributes. An
 * operator its category may not use contributes nothing: content validation
 * refuses it, and the engine never executes an unreviewed combination.
 */
export function operatorModifiers(module: ModifierModuleDefinition): readonly AttributeModifier[] {
  return module.modifiers.flatMap((modifier): AttributeModifier[] => {
    const specification = OPERATOR_REGISTRY[modifier.operator];
    if (!specification.categories.includes(module.category)) return [];
    return [{
      attribute: specification.attribute,
      operation: specification.operation,
      value: specification.sign * modifier.value,
      stage: specification.stage,
      sourceId: module.id,
      sourceKey: module.nameKey,
    }];
  });
}
