import {
  activateRefusal,
  activateModuleRefusal,
  activeCombatant,
  changeAmmunitionRefusal,
  deactivateRefusal,
  deactivateModuleRefusal,
  lockRefusal,
  reloadRefusal,
  unlockRefusal,
  weaponContext,
  weaponState,
  type CombatCommandRefusal,
  type CombatRuleInput,
  type SlotRef,
} from '@engine/domain';
import {
  activateModule,
  activateWeapon,
  beginLock,
  deactivateModule,
  deactivateWeapon,
  releaseLock,
  requestReload,
} from '@engine/simulation';
import type {
  ActivateWeaponPayload,
  ChangeAmmunitionPayload,
  TargetPayloadData,
  WeaponSlotPayload,
} from '@protocol';
import type { AmmunitionId } from '@shared';

import { APPLIED, reject, type CommandOutcome, type Transaction } from './transaction';

/**
 * Targeting and weapon commands (Functional Specification 9.2, 9.4).
 *
 * Each handler asks the shared predicate that the combat projection asks, so
 * the interface can never offer an order the engine would refuse. What the
 * order then does happens in simulation time: the handler starts a scheduled
 * action and returns, and the boundary that resolves it is the same one a
 * resumed campaign finds waiting.
 *
 * @implements FUNC-9.2, FUNC-9.4, FUNC-22.10, TECH-7.2, TECH-10.3, MVP-AC-03, MVP-AC-04
 */
export function handleCombatCommand(
  transaction: Transaction,
  type:
    | 'targeting.lock'
    | 'targeting.unlock'
    | 'weapon.activate'
    | 'weapon.deactivate'
    | 'weapon.reload'
    | 'weapon.changeAmmunition'
    | 'module.activate'
    | 'module.deactivate',
  payload: unknown,
): CommandOutcome {
  const rules: CombatRuleInput = { state: transaction.requireDraft(), content: transaction.content };

  switch (type) {
    case 'targeting.lock':
      return lock(transaction, rules, (payload as TargetPayloadData).targetId);
    case 'targeting.unlock':
      return unlock(transaction, rules, (payload as TargetPayloadData).targetId);
    case 'weapon.activate':
      return activate(transaction, rules, payload as ActivateWeaponPayload);
    case 'weapon.deactivate':
      return deactivate(transaction, rules, payload as WeaponSlotPayload);
    case 'weapon.reload':
      return reload(transaction, rules, payload as WeaponSlotPayload);
    case 'weapon.changeAmmunition':
      return changeAmmunition(transaction, rules, payload as ChangeAmmunitionPayload);
    case 'module.activate':
      return operateModule(transaction, rules, payload as WeaponSlotPayload, true);
    case 'module.deactivate':
      return operateModule(transaction, rules, payload as WeaponSlotPayload, false);
    default:
      return assertUnreachable(type);
  }
}

function refuse(refusal: CombatCommandRefusal): CommandOutcome | null {
  return refusal === null ? null : reject(refusal);
}

function slotOf(payload: WeaponSlotPayload): SlotRef {
  return { kind: 'weapon', index: payload.slotIndex };
}

/**
 * A command always acts on the ship the player is flying. The simulation
 * operations name their ship, because an opponent issues the same ones.
 */
function shipOf(rules: CombatRuleInput): string {
  return rules.state.assets.activeShipId;
}

function lock(
  transaction: Transaction,
  rules: CombatRuleInput,
  targetId: string,
): CommandOutcome {
  const refused = refuse(lockRefusal(rules, targetId));
  if (refused !== null) return refused;
  return beginLock(transaction.simulation(), shipOf(rules), targetId) ? APPLIED : reject('lockTargetUnavailable');
}

function unlock(
  transaction: Transaction,
  rules: CombatRuleInput,
  targetId: string,
): CommandOutcome {
  const refused = refuse(unlockRefusal(rules, targetId));
  if (refused !== null) return refused;
  return releaseLock(transaction.simulation(), shipOf(rules), targetId) ? APPLIED : reject('lockNotHeld');
}

function activate(
  transaction: Transaction,
  rules: CombatRuleInput,
  payload: ActivateWeaponPayload,
): CommandOutcome {
  const slot = slotOf(payload);
  const refused = refuse(activateRefusal(rules, slot, payload.targetId));
  if (refused !== null) return refused;
  return activateWeapon(transaction.simulation(), shipOf(rules), slot, payload.targetId)
    ? APPLIED
    : reject('weaponSlotUnavailable');
}

function deactivate(
  transaction: Transaction,
  rules: CombatRuleInput,
  payload: WeaponSlotPayload,
): CommandOutcome {
  const slot = slotOf(payload);
  const refused = refuse(deactivateRefusal(rules, slot));
  if (refused !== null) return refused;
  return deactivateWeapon(transaction.simulation(), shipOf(rules), slot)
    ? APPLIED
    : reject('weaponSlotUnavailable');
}

/**
 * Tops a magazine up with the charge it already holds, or with the charge it
 * last held when it has run dry (Functional Specification 9.4).
 */
function reload(
  transaction: Transaction,
  rules: CombatRuleInput,
  payload: WeaponSlotPayload,
): CommandOutcome {
  const slot = slotOf(payload);
  const refused = refuse(reloadRefusal(rules, slot));
  if (refused !== null) return refused;

  const ammunitionId = currentAmmunition(rules, slot);
  if (ammunitionId === null) return reject('weaponNoAmmunition');
  return requestReload(transaction.simulation(), shipOf(rules), slot, ammunitionId, false)
    ? APPLIED
    : reject('weaponSlotUnavailable');
}

function changeAmmunition(
  transaction: Transaction,
  rules: CombatRuleInput,
  payload: ChangeAmmunitionPayload,
): CommandOutcome {
  const slot = slotOf(payload);
  const ammunitionId = payload.ammunitionId as AmmunitionId;
  const refused = refuse(changeAmmunitionRefusal(rules, slot, ammunitionId));
  if (refused !== null) return refused;
  return requestReload(transaction.simulation(), shipOf(rules), slot, ammunitionId, true)
    ? APPLIED
    : reject('weaponSlotUnavailable');
}

function operateModule(
  transaction: Transaction,
  rules: CombatRuleInput,
  payload: WeaponSlotPayload,
  activate: boolean,
): CommandOutcome {
  const slot: SlotRef = { kind: payload.slotKind as SlotRef['kind'], index: payload.slotIndex };
  const refused = refuse(
    activate ? activateModuleRefusal(rules, slot) : deactivateModuleRefusal(rules, slot),
  );
  if (refused !== null) return refused;
  const applied = activate
    ? activateModule(transaction.simulation(), shipOf(rules), slot)
    : deactivateModule(transaction.simulation(), shipOf(rules), slot);
  return applied ? APPLIED : reject('moduleSlotUnavailable');
}

/** The charge a plain reload refills with: the loaded one, or the last one. */
function currentAmmunition(rules: CombatRuleInput, slot: SlotRef): AmmunitionId | null {
  const combatant = activeCombatant(rules.state, rules.content);
  if (combatant === null) return null;
  const weapon = weaponContext(rules, combatant, slot);
  if (weapon === null) return null;
  return weapon.ammunitionId ?? weaponState(combatant.combat, weapon.key).lastAmmunitionId;
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled combat command ${String(value)}.`);
}
