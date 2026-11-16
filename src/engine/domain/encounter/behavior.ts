import type { CombatRules, NpcRole } from '@engine/ports';

import { clamp } from '@shared';

import type { MovementOrder } from '../navigation/types';

/**
 * The behaviour selector (Functional Specification 9.10; Technical
 * Specification 10.3).
 *
 * It is a pure function of what the opponent is defined to know: its role, its
 * own condition and capacitor, the range to its target and what its own
 * loadout reaches - turrets, launchers and its control module. It returns
 * intent - a movement order, whether to lock, fire, burn, repair and slow the
 * target - and never touches ship state. The adapter that runs it turns the
 * intent into the same commands the player issues, and asks the same
 * availability predicates before it does.
 *
 * An opponent gains nothing from the player's condition, wallet, fit or recent
 * success here, so it cannot receive a hidden bonus (Functional Specification
 * 9.10; FeatureSpec02 7.1).
 *
 * @implements FUNC-9.10, TECH-10.3, V02-AC-08
 */

export interface NpcSituation {
  readonly role: NpcRole;
  readonly targetId: string;
  readonly rangeKm: number;
  readonly maxLockRangeKm: number;
  /**
   * The longest engagement range among its online weapons, or `null` when
   * unarmed: a turret's optimal range, or a launcher's flight distance scaled
   * by the guided reach fraction (Technical Specification 10.3).
   */
  readonly bestOptimalRangeKm: number | null;
  /** The longest range among its online control modules, or `null` without one. */
  readonly controlRangeKm: number | null;
  readonly hasLock: boolean;
  /** Remaining share of the layer its repair module restores, or `null`. */
  readonly repairLayerFraction: number | null;
  readonly hasPropulsion: boolean;
  /** Its own capacitor as a share of capacity. */
  readonly capacitorFraction: number;
}

export interface NpcIntent {
  readonly movement: MovementOrder;
  readonly desiredRangeKm: number;
  /** Attempt a lock when it does not hold one and the target is reachable. */
  readonly lock: boolean;
  /** Keep the weapons cycling; only meaningful once the lock completes. */
  readonly fire: boolean;
  readonly propulsion: boolean;
  readonly repair: boolean;
  /** Keep its control module cycling on the target. */
  readonly control: boolean;
}

/**
 * The range this role wants to hold.
 *
 * It is derived from the opponent's own loadout rather than authored per
 * profile, so a sniper refitted with a short-range turret closes instead of
 * sitting uselessly outside its own falloff, and a tackler holds inside its
 * own web range.
 */
export function preferredRangeKm(situation: NpcSituation, rules: CombatRules): number {
  const role = rules.npcRoles[situation.role];
  const reach = situation.role === 'tackler' && situation.controlRangeKm !== null
    ? situation.controlRangeKm
    : situation.bestOptimalRangeKm ?? situation.maxLockRangeKm;
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

  // An opponent that carries a control module keeps charge for it rather
  // than spending the last of its capacitor on speed.
  const reserveHeld =
    situation.controlRangeKm === null ||
    situation.capacitorFraction >= rules.npcControlCapacitorReserveFraction;

  return {
    movement,
    desiredRangeKm,
    lock: !situation.hasLock && situation.rangeKm <= situation.maxLockRangeKm,
    fire: situation.hasLock,
    // Burning costs capacitor, so it runs only while the opponent is out of
    // the band it wants to fight in.
    propulsion: situation.hasPropulsion && outsideBand && reserveHeld,
    repair:
      situation.repairLayerFraction !== null &&
      situation.repairLayerFraction < rules.npcRepairThresholdFraction,
    control:
      situation.hasLock &&
      situation.controlRangeKm !== null &&
      situation.rangeKm <= situation.controlRangeKm,
  };
}
