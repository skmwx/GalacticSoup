import type { CombatRules, NpcRole } from '@engine/ports';

import { clamp } from '@shared';

import type { MovementOrder } from '../navigation/types';

/**
 * The behaviour selector (Functional Specification 9.10; Technical
 * Specification 10.3).
 *
 * It is a pure function of what the opponent is defined to know: its role, its
 * own condition, the range to its target and what its own guns reach. It
 * returns intent - a movement order, whether to lock, whether to fire, whether
 * to burn and whether to repair - and never touches ship state. The adapter
 * that runs it turns the intent into the same commands the player issues.
 *
 * An opponent gains nothing from the player's condition here, so it cannot
 * receive a hidden bonus for losing (Functional Specification 9.10).
 *
 * @implements FUNC-9.10, TECH-10.3
 */

export interface NpcSituation {
  readonly role: NpcRole;
  readonly targetId: string;
  readonly rangeKm: number;
  readonly maxLockRangeKm: number;
  /** The longest optimal range among its online turrets, or `null` when unarmed. */
  readonly bestOptimalRangeKm: number | null;
  readonly hasLock: boolean;
  /** Remaining share of the layer its repair module restores, or `null`. */
  readonly repairLayerFraction: number | null;
  readonly hasPropulsion: boolean;
}

export interface NpcIntent {
  readonly movement: MovementOrder;
  readonly desiredRangeKm: number;
  /** Attempt a lock when it does not hold one and the target is reachable. */
  readonly lock: boolean;
  /** Keep the turrets cycling; only meaningful once the lock completes. */
  readonly fire: boolean;
  readonly propulsion: boolean;
  readonly repair: boolean;
}

/**
 * The range this role wants to hold.
 *
 * It is derived from the opponent's own guns rather than authored per profile,
 * so a sniper that is refitted with a short-range turret closes instead of
 * sitting uselessly outside its own falloff.
 */
export function preferredRangeKm(situation: NpcSituation, rules: CombatRules): number {
  const role = rules.npcRoles[situation.role];
  const reach = situation.bestOptimalRangeKm ?? situation.maxLockRangeKm;
  const wanted = reach * role.preferredRangeFraction;
  // It can never plan to sit outside its own lock range: a lock it cannot
  // hold is a lock it cannot shoot through (Functional Specification 9.2).
  const ceiling = Math.max(role.minimumRangeKm, situation.maxLockRangeKm * 0.9);
  return clamp(role.minimumRangeKm, ceiling, wanted);
}

export function selectNpcIntent(situation: NpcSituation, rules: CombatRules): NpcIntent {
  const role = rules.npcRoles[situation.role];
  const desiredRangeKm = preferredRangeKm(situation, rules);
  const tolerance = Math.max(desiredRangeKm * rules.npcRangeToleranceFraction, 0);
  const outsideBand = situation.rangeKm > desiredRangeKm + tolerance;

  const movement: MovementOrder =
    role.movement === 'approach'
      ? { kind: 'approach', targetId: situation.targetId, distanceKm: desiredRangeKm }
      : role.movement === 'orbit'
        ? { kind: 'orbit', targetId: situation.targetId, distanceKm: desiredRangeKm }
        : { kind: 'keepRange', targetId: situation.targetId, distanceKm: desiredRangeKm };

  return {
    movement,
    desiredRangeKm,
    lock: !situation.hasLock && situation.rangeKm <= situation.maxLockRangeKm,
    fire: situation.hasLock,
    // Burning costs capacitor, so it runs only while the opponent is out of
    // the band it wants to fight in.
    propulsion: situation.hasPropulsion && outsideBand,
    repair:
      situation.repairLayerFraction !== null &&
      situation.repairLayerFraction < rules.npcRepairThresholdFraction,
  };
}
