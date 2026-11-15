import {
  applyLayeredDamage,
  attributeValue,
  combatantOf,
  recordDamageEvent,
  resistanceAttribute,
  totalDamage,
} from '@engine/domain';
import { DAMAGE_TYPES, DEFENSE_LAYERS, type DamageProfile } from '@engine/ports';

import type { SimulationContext } from './context';

/**
 * Applying one raw damage vector to a ship's layers
 * (Functional Specification 9.7; Technical Specification 10.3).
 *
 * Turret shots and guided impacts both end here, so resistances, layer
 * spill-over, the combat recorder and the published event are identical
 * whichever weapon caused the damage. The attacker is a retained attribution:
 * a guided impact names a source that may already be destroyed or gone, and
 * the damage is still recorded against it (Functional Specification 9.6).
 *
 * Hull depletion is not finalised here. Destruction is decided after every
 * completion at the timestamp has resolved (Technical Specification 9.2).
 *
 * @implements FUNC-9.7, TECH-10.3
 */

export interface DamageApplication {
  readonly attackerId: string;
  readonly targetId: string;
  readonly slotKey: string;
  readonly damage: DamageProfile;
}

export function applyDamageToShip(context: SimulationContext, application: DamageApplication): void {
  if (totalDamage(application.damage) <= 0) return;
  const target = combatantOf(context.draft, context.content, application.targetId);
  if (target === null || target.combat.destroyedAtMs !== null) return;

  const layers = DEFENSE_LAYERS.map((layer) => {
    const maximumHitPoints = attributeValue(target.derived, `${layer}HitPoints`);
    return {
      layer,
      maximumHitPoints,
      currentHitPoints: Math.max(0, maximumHitPoints - target.ship.condition.damage[layer]),
      resistances: Object.fromEntries(
        DAMAGE_TYPES.map((type) => [
          type,
          attributeValue(target.derived, resistanceAttribute(layer, type)),
        ]),
      ) as Record<(typeof DAMAGE_TYPES)[number], number>,
    };
  });
  const result = applyLayeredDamage(application.damage, layers);
  const ship = context.draft.assets.ships[application.targetId];
  if (ship === undefined) return;
  for (const layer of result.layers) {
    const maximum = attributeValue(target.derived, `${layer.layer}HitPoints`);
    ship.condition.damage[layer.layer] = round(Math.max(0, maximum - layer.afterHitPoints));
  }
  context.draft.assets.version += 1;
  const layerTotal = (name: string): number =>
    result.layers.find((layer) => layer.layer === name)?.appliedTotal ?? 0;
  recordDamageEvent(context.draft, {
    sourceId: application.attackerId,
    targetId: application.targetId,
    slotKey: application.slotKey,
    rawDamage: application.damage,
    appliedDamage: result.appliedDamage,
    layerDamage: { shield: layerTotal('shield'), armor: layerTotal('armor'), hull: layerTotal('hull') },
  });
  context.publish('combat.damageApplied', {
    attackerId: application.attackerId,
    targetId: application.targetId,
    slot: application.slotKey,
    appliedDamage: result.appliedTotal,
    shieldDamage: layerTotal('shield'),
    armorDamage: layerTotal('armor'),
    hullDamage: layerTotal('hull'),
  });
  context.invalidate('ship');
  context.invalidate('combat');
}

/** Condition is a continuous value; one hit must not leave a float tail. */
export function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
