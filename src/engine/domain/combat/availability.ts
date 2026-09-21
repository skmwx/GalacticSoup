import type {
  ContentRepository,
  PropulsionModuleDefinition,
  RepairModuleDefinition,
  TurretModuleDefinition,
} from '@engine/ports';
import type { AmmunitionId } from '@shared';

import { stacksIn } from '../assets/inventory';
import type { ItemStack } from '../assets/types';
import { attributeValue } from '../attributes';
import type { CampaignState } from '../campaign/state';
import { slotKey, type FittedSlotDescription, type SlotRef } from '../fitting/types';
import { distance } from '../navigation/geometry';

import {
  activeCombatant,
  activeModuleState,
  hasCompletedLock,
  isDestroyed,
  lockOn,
  isLockable,
  turretAt,
  weaponState,
  type CombatantContext,
} from './state';

/**
 * Whether each targeting and weapon command may be issued right now, and why
 * not (Technical Specification 12.3; Functional Specification 22.10).
 *
 * The same predicates answer the command handler and the projection, exactly
 * as the navigation ones do, so a combat control cannot offer an order the
 * engine would refuse or hide one it would accept.
 *
 * @implements TECH-12.3, FUNC-9.2, FUNC-9.4, FUNC-22.10
 */

export const COMBAT_COMMANDS = [
  'targeting.lock',
  'targeting.unlock',
  'weapon.activate',
  'weapon.deactivate',
  'weapon.reload',
  'weapon.changeAmmunition',
  'module.activate',
  'module.deactivate',
] as const;

export type CombatCommand = (typeof COMBAT_COMMANDS)[number];

/**
 * Why a combat command would be refused. As with navigation, the vocabulary is
 * declared in the domain and turned into a protocol error or a message key by
 * the layers above, which may not be imported from here.
 */
export const COMBAT_REFUSALS = [
  'combatUnavailable',
  'lockAlreadyHeld',
  'lockLimitReached',
  'lockNotHeld',
  'lockOutOfRange',
  'lockTargetUnavailable',
  'weaponAlreadyActive',
  'weaponAmmunitionIncompatible',
  'weaponInsufficientCapacitor',
  'weaponMagazineFull',
  'weaponNoAmmunition',
  'weaponNotActive',
  'weaponReloading',
  'weaponSlotUnavailable',
  'weaponUnloadNoSpace',
  'moduleAlreadyActive',
  'moduleNotActive',
  'moduleSlotUnavailable',
  'shipDestroyed',
] as const;

export type CombatRefusal = (typeof COMBAT_REFUSALS)[number];

/** `null` means the command may be issued. */
export type CombatCommandRefusal = CombatRefusal | null;

export interface CombatRuleInput {
  readonly state: CampaignState;
  readonly content: ContentRepository;
}

/** The turret a slot holds, together with everything a rule asks about it. */
export interface WeaponContext {
  readonly slot: SlotRef;
  readonly key: string;
  readonly fitted: FittedSlotDescription;
  readonly module: TurretModuleDefinition;
  readonly ammunitionId: AmmunitionId | null;
  /** Rounds in the magazine, including any a running cycle has reserved. */
  readonly loadedRounds: number;
  /** Rounds a new cycle may draw on. */
  readonly availableRounds: number;
}

export type OperatedModuleDefinition = PropulsionModuleDefinition | RepairModuleDefinition;

export interface ActiveModuleContext {
  readonly slot: SlotRef;
  readonly key: string;
  readonly fitted: FittedSlotDescription;
  readonly module: OperatedModuleDefinition;
}

/** The online, player-operated non-weapon module in one slot. */
export function activeModuleContext(
  input: CombatRuleInput,
  combatant: CombatantContext,
  slot: SlotRef,
): ActiveModuleContext | null {
  const key = slotKey(slot);
  const fitted = combatant.fit.find((entry) => slotKey(entry.slot) === key);
  if (fitted === undefined || !fitted.online) return null;
  const module = input.content.module(fitted.moduleId);
  if (
    module === undefined ||
    (module.category !== 'propulsion' &&
      module.category !== 'shieldBooster' &&
      module.category !== 'armorRepairer') ||
    module.activation === undefined
  ) {
    return null;
  }
  return { slot, key, fitted, module };
}

export function weaponContext(
  input: CombatRuleInput,
  combatant: CombatantContext,
  slot: SlotRef,
): WeaponContext | null {
  const fitted = turretAt(combatant.fit, input.content, slot);
  if (fitted === null || !fitted.online) {
    return null;
  }
  const module = input.content.module(fitted.moduleId);
  if (module === undefined || module.category !== 'turret') {
    return null;
  }
  const key = slotKey(slot);
  const reserved = weaponState(combatant.combat, key).cycle?.reservedRounds ?? 0;
  const loadedRounds = fitted.charge?.quantity ?? 0;
  return {
    slot,
    key,
    fitted,
    module,
    ammunitionId: fitted.charge?.ammunitionId ?? null,
    loadedRounds,
    availableRounds: Math.max(0, loadedRounds - reserved),
  };
}

/** Compatible, unfitted ammunition of one kind the ship carries in cargo. */
export function cargoRounds(
  input: CombatRuleInput,
  combatant: CombatantContext,
  ammunitionId: AmmunitionId,
): number {
  return cargoStacks(input, combatant, ammunitionId).reduce(
    (total, stack) => total + stack.quantity,
    0,
  );
}

export function cargoStacks(
  input: CombatRuleInput,
  combatant: CombatantContext,
  ammunitionId: AmmunitionId | null,
): readonly ItemStack[] {
  return stacksIn(input.state.assets, combatant.ship.cargoInventoryId).filter(
    (stack) =>
      stack.state.kind === 'plain' &&
      (ammunitionId === null || stack.definitionId === ammunitionId) &&
      input.content.ammunition(stack.definitionId) !== undefined,
  );
}

/** Ammunition kinds in cargo that one turret accepts, in stable order. */
export function compatibleCargoAmmunition(
  input: CombatRuleInput,
  combatant: CombatantContext,
  weapon: WeaponContext,
): readonly AmmunitionId[] {
  const accepted = new Set<AmmunitionId>();
  for (const stack of cargoStacks(input, combatant, null)) {
    const ammunition = input.content.ammunition(stack.definitionId);
    if (ammunition !== undefined && ammunition.group === weapon.module.turret.ammunitionGroup) {
      accepted.add(ammunition.id);
    }
  }
  return [...accepted].sort();
}

/** Refuses everything that needs the ship to be present in a loaded site. */
export function combatRefusal(input: CombatRuleInput): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) return 'combatUnavailable';
  return combatant.combat.destroyedAtMs === null ? null : 'shipDestroyed';
}

/** Refuses starting a lock on one object (Functional Specification 9.2). */
export function lockRefusal(input: CombatRuleInput, targetId: string): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) {
    return 'combatUnavailable';
  }
  if (combatant.combat.destroyedAtMs !== null) return 'shipDestroyed';
  const target = input.state.navigation.currentSite?.objects[targetId];
  if (
    target === undefined ||
    target.id === combatant.shipId ||
    !isLockable(target) ||
    isDestroyed(input.state, target.id)
  ) {
    return 'lockTargetUnavailable';
  }
  if (lockOn(combatant.combat, targetId) !== null) {
    return 'lockAlreadyHeld';
  }
  if (combatant.combat.locks.length >= attributeValue(combatant.derived, 'maxLockedTargets')) {
    return 'lockLimitReached';
  }
  return distance(combatant.object.position, target.position) >
    attributeValue(combatant.derived, 'maxLockRangeKm')
    ? 'lockOutOfRange'
    : null;
}

/** Refuses dropping a lock the ship does not hold. */
export function unlockRefusal(input: CombatRuleInput, targetId: string): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) {
    return 'combatUnavailable';
  }
  if (combatant.combat.destroyedAtMs !== null) return 'shipDestroyed';
  return lockOn(combatant.combat, targetId) === null ? 'lockNotHeld' : null;
}

/**
 * Refuses activating one weapon (Functional Specification 9.4).
 *
 * `targetId` is `null` when the caller is asking whether the weapon could be
 * activated at all, which is what a command bar needs before the player has
 * chosen which locked target to fire at.
 */
export function activateRefusal(
  input: CombatRuleInput,
  slot: SlotRef,
  targetId: string | null,
): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) {
    return 'combatUnavailable';
  }
  if (combatant.combat.destroyedAtMs !== null) return 'shipDestroyed';
  const weapon = weaponContext(input, combatant, slot);
  if (weapon === null) {
    return 'weaponSlotUnavailable';
  }
  const held =
    targetId === null
      ? combatant.combat.locks.some((lock) => lock.status === 'locked')
      : hasCompletedLock(combatant.combat, targetId);
  if (!held) {
    return 'lockNotHeld';
  }
  const runtime = weaponState(combatant.combat, weapon.key);
  if (runtime.repeating && (targetId === null || runtime.targetId === targetId)) {
    return 'weaponAlreadyActive';
  }
  if (runtime.reload !== null || runtime.pendingReload !== null) {
    return 'weaponReloading';
  }
  if (weapon.availableRounds <= 0) {
    return 'weaponNoAmmunition';
  }
  return combatant.ship.condition.capacitorCharge < capacitorPerCycle(weapon)
    ? 'weaponInsufficientCapacitor'
    : null;
}

/** Refuses stopping a weapon that is not repeating. */
export function deactivateRefusal(input: CombatRuleInput, slot: SlotRef): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) {
    return 'combatUnavailable';
  }
  if (combatant.combat.destroyedAtMs !== null) return 'shipDestroyed';
  const weapon = weaponContext(input, combatant, slot);
  if (weapon === null) {
    return 'weaponSlotUnavailable';
  }
  return weaponState(combatant.combat, weapon.key).repeating ? null : 'weaponNotActive';
}

/** Refuses topping one magazine up from cargo (Functional Specification 9.4). */
export function reloadRefusal(input: CombatRuleInput, slot: SlotRef): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) {
    return 'combatUnavailable';
  }
  if (combatant.combat.destroyedAtMs !== null) return 'shipDestroyed';
  const weapon = weaponContext(input, combatant, slot);
  if (weapon === null) {
    return 'weaponSlotUnavailable';
  }
  const runtime = weaponState(combatant.combat, weapon.key);
  if (runtime.reload !== null || runtime.pendingReload !== null) {
    return 'weaponReloading';
  }
  if (weapon.loadedRounds >= weapon.module.turret.magazineSize) {
    return 'weaponMagazineFull';
  }
  const ammunitionId = weapon.ammunitionId ?? runtime.lastAmmunitionId;
  if (ammunitionId === null) {
    return 'weaponNoAmmunition';
  }
  return cargoRounds(input, combatant, ammunitionId) > 0 ? null : 'weaponNoAmmunition';
}

/**
 * Refuses changing one weapon's charge (Functional Specification 9.4).
 *
 * `ammunitionId` is `null` when the caller is asking whether any change is
 * possible, which is what a projection needs before the player has chosen one.
 */
export function changeAmmunitionRefusal(
  input: CombatRuleInput,
  slot: SlotRef,
  ammunitionId: AmmunitionId | null,
): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) {
    return 'combatUnavailable';
  }
  if (combatant.combat.destroyedAtMs !== null) return 'shipDestroyed';
  const weapon = weaponContext(input, combatant, slot);
  if (weapon === null) {
    return 'weaponSlotUnavailable';
  }
  const runtime = weaponState(combatant.combat, weapon.key);
  if (runtime.reload !== null || runtime.pendingReload !== null) {
    return 'weaponReloading';
  }
  const options = compatibleCargoAmmunition(input, combatant, weapon);
  if (ammunitionId === null) {
    return options.some((option) => option !== weapon.ammunitionId) ? null : 'weaponNoAmmunition';
  }
  const ammunition = input.content.ammunition(ammunitionId);
  if (ammunition === undefined || ammunition.group !== weapon.module.turret.ammunitionGroup) {
    return 'weaponAmmunitionIncompatible';
  }
  if (!options.includes(ammunitionId)) {
    return 'weaponNoAmmunition';
  }
  return unloadFits(input, combatant, weapon) ? null : 'weaponUnloadNoSpace';
}

/** Refuses starting an operated module, using the same predicate as the UI. */
export function activateModuleRefusal(
  input: CombatRuleInput,
  slot: SlotRef,
): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) return 'combatUnavailable';
  if (combatant.combat.destroyedAtMs !== null) return 'shipDestroyed';
  const module = activeModuleContext(input, combatant, slot);
  if (module === null) return 'moduleSlotUnavailable';
  return activeModuleState(combatant.combat, module.key).repeating
    ? 'moduleAlreadyActive'
    : null;
}

/** Refuses stopping an operated module which is not repeating. */
export function deactivateModuleRefusal(
  input: CombatRuleInput,
  slot: SlotRef,
): CombatCommandRefusal {
  const combatant = activeCombatant(input.state, input.content);
  if (combatant === null) return 'combatUnavailable';
  const module = activeModuleContext(input, combatant, slot);
  if (module === null) return 'moduleSlotUnavailable';
  return activeModuleState(combatant.combat, module.key).repeating ? null : 'moduleNotActive';
}

/**
 * Whether the magazine this change would empty can go back into cargo. The
 * unloaded rounds occupy the same volume they occupied in the magazine, so the
 * hold has to have room for them (Functional Specification 9.4, 22.2).
 */
function unloadFits(
  input: CombatRuleInput,
  combatant: CombatantContext,
  weapon: WeaponContext,
): boolean {
  if (weapon.ammunitionId === null || weapon.loadedRounds === 0) {
    return true;
  }
  const definition = input.content.ammunition(weapon.ammunitionId);
  if (definition === undefined) {
    return true;
  }
  const cargo = input.state.assets.inventories[combatant.ship.cargoInventoryId];
  if (cargo === undefined || cargo.capacity.kind !== 'limited') {
    return true;
  }
  const used = stacksIn(input.state.assets, cargo.id).reduce((total, stack) => {
    const tradeable = input.content.tradeable(stack.definitionId);
    return total + stack.quantity * (tradeable?.volumeCubicDecimetres ?? 0);
  }, 0);
  return (
    used + weapon.loadedRounds * definition.volumeCubicDecimetres <=
    cargo.capacity.volumeCubicDecimetres
  );
}

export function capacitorPerCycle(weapon: WeaponContext): number {
  return weapon.module.activation?.capacitorPerCycle ?? 0;
}

export function cycleMilliseconds(weapon: WeaponContext): number {
  return Math.max(1, Math.round((weapon.module.activation?.cycleSeconds ?? 0) * 1000));
}

export function activeModuleCapacitorPerCycle(module: ActiveModuleContext): number {
  return module.module.activation?.capacitorPerCycle ?? 0;
}

export function activeModuleCycleMilliseconds(module: ActiveModuleContext): number {
  return Math.max(1, Math.round((module.module.activation?.cycleSeconds ?? 0) * 1000));
}
