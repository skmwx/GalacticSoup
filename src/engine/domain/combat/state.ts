import type { ContentRepository, HullDefinition } from '@engine/ports';
import type { AmmunitionId } from '@shared';

import { attributeValue, deriveShipAttributes, type DerivedShipAttributes } from '../attributes';
import { shipFit } from '../fitting/fit';
import { slotKey, type FitDescription, type FittedSlotDescription, type SlotRef } from '../fitting/types';
import type { ShipIdentity } from '../assets/types';
import type { EntityId } from '../campaign/identity';
import type { CampaignDraft, CampaignState } from '../campaign/state';
import type { SiteObjectState } from '../navigation/types';

import type { LockState, ShipCombatState, WeaponState } from './types';

/**
 * Reading and changing combat runtime (Technical Specification 8.2, 10.3).
 *
 * Combat runtime hangs off the ship that owns it rather than off the site, so
 * the ship aggregate keeps its locks and its module cycles and the tactical
 * site keeps positions. It is kept minimal on purpose: a ship with no locks
 * and no weapon runtime holds no entry at all, so a docked campaign hashes the
 * same whether or not it has ever fired.
 *
 * @implements TECH-8.2, TECH-10.3, FUNC-9.2, FUNC-9.4
 */

export const IDLE_WEAPON: WeaponState = {
  repeating: false,
  targetId: null,
  cycle: null,
  reload: null,
  pendingReload: null,
  lastAmmunitionId: null,
  stopReason: null,
};

const NO_COMBAT: ShipCombatState = { locks: [], weapons: {} };

/** The runtime of one ship, or an empty one when it holds none. */
export function shipCombat(state: CampaignState, shipId: string): ShipCombatState {
  return state.combat.ships[shipId] ?? NO_COMBAT;
}

export function weaponState(combat: ShipCombatState, key: string): WeaponState {
  return combat.weapons[key] ?? IDLE_WEAPON;
}

export function lockOn(combat: ShipCombatState, targetId: string): LockState | null {
  return combat.locks.find((lock) => lock.targetId === targetId) ?? null;
}

export function hasCompletedLock(combat: ShipCombatState, targetId: string): boolean {
  return lockOn(combat, targetId)?.status === 'locked';
}

export function completedLocks(combat: ShipCombatState): readonly LockState[] {
  return combat.locks.filter((lock) => lock.status === 'locked');
}

/** The runtime of one ship as a transaction draft may change it. */
export interface MutableShipCombat {
  locks: LockState[];
  weapons: Record<string, WeaponState>;
}

/** The runtime of one ship in a draft, created on demand. */
export function mutableCombat(draft: CampaignDraft, shipId: string): MutableShipCombat {
  const ships = draft.combat.ships as unknown as Record<string, MutableShipCombat>;
  const existing = ships[shipId];
  if (existing !== undefined) {
    return existing;
  }
  const created: MutableShipCombat = { locks: [], weapons: {} };
  ships[shipId] = created;
  return created;
}

export function setLocks(draft: CampaignDraft, shipId: string, locks: readonly LockState[]): void {
  mutableCombat(draft, shipId).locks = locks.map((lock) => ({ ...lock }));
}

export function setWeapon(
  draft: CampaignDraft,
  shipId: string,
  key: string,
  weapon: WeaponState,
): void {
  mutableCombat(draft, shipId).weapons[key] = { ...weapon };
}

/** Marks the runtime changed, so bound projections refresh. */
export function combatChanged(draft: CampaignDraft): void {
  draft.combat.version += 1;
}

/**
 * Drops runtime that says nothing, so a campaign that has stopped fighting
 * stores no combat state and hashes like one that never started.
 */
export function pruneCombat(draft: CampaignDraft, shipId: string): void {
  const combat = (draft.combat.ships as unknown as Record<string, MutableShipCombat>)[shipId];
  if (combat === undefined) {
    return;
  }
  for (const key of Object.keys(combat.weapons)) {
    if (isIdle(combat.weapons[key] ?? IDLE_WEAPON)) {
      delete combat.weapons[key];
    }
  }
  if (combat.locks.length === 0 && Object.keys(combat.weapons).length === 0) {
    delete (draft.combat.ships as unknown as Record<string, MutableShipCombat>)[shipId];
  }
}

export function isIdle(weapon: WeaponState): boolean {
  return (
    !weapon.repeating &&
    weapon.targetId === null &&
    weapon.cycle === null &&
    weapon.reload === null &&
    weapon.pendingReload === null &&
    weapon.lastAmmunitionId === null &&
    weapon.stopReason === null
  );
}

/** Every ship that currently holds combat runtime, in stable order. */
export function combatantIds(state: CampaignState): readonly string[] {
  return Object.keys(state.combat.ships).sort();
}

/** A ship that is present in the loaded site and can operate modules. */
export interface CombatantContext {
  readonly shipId: EntityId;
  readonly ship: ShipIdentity;
  readonly object: SiteObjectState;
  readonly hull: HullDefinition;
  readonly fit: FitDescription;
  readonly derived: DerivedShipAttributes;
  readonly combat: ShipCombatState;
}

/**
 * One ship as a combatant, or `null` when it is not present in the loaded
 * site and therefore cannot lock or operate a module.
 *
 * Every combat rule is written against this shape rather than against the
 * player, because Technical Specification 10.3 requires an opponent to issue
 * the same module commands the player does.
 */
export function combatantOf(
  state: CampaignState,
  content: ContentRepository,
  shipId: string,
): CombatantContext | null {
  const ship = state.assets.ships[shipId];
  const object = state.navigation.currentSite?.objects[shipId];
  if (
    ship === undefined ||
    object === undefined ||
    object.kind !== 'ship' ||
    ship.location.kind !== 'site'
  ) {
    return null;
  }
  const hull = content.hull(ship.hullId);
  if (hull === undefined) {
    return null;
  }
  const fit = shipFit(state.assets, shipId);
  return {
    shipId: shipId as EntityId,
    ship,
    object,
    hull,
    fit,
    derived: deriveShipAttributes({ hull, fit, content }),
    combat: shipCombat(state, shipId),
  };
}

/**
 * The player's ship as a combatant, or `null` while it is docked, in warp or
 * otherwise not present in a loaded site. Only the player's ship takes
 * commands; an opponent is driven by the engine.
 */
export function activeCombatant(
  state: CampaignState,
  content: ContentRepository,
): CombatantContext | null {
  return state.assets.location.kind === 'site'
    ? combatantOf(state, content, state.assets.activeShipId)
    : null;
}

/** The fitted turret in one slot, or `null` when the slot holds none. */
export function turretAt(
  fit: FitDescription,
  content: ContentRepository,
  slot: SlotRef,
): FittedSlotDescription | null {
  const key = slotKey(slot);
  const fitted = fit.find((entry) => slotKey(entry.slot) === key);
  if (fitted === undefined) {
    return null;
  }
  return content.module(fitted.moduleId)?.category === 'turret' ? fitted : null;
}

/**
 * The signature radius a shot or a lock measures the target by
 * (Functional Specification 9.2, 9.5).
 *
 * The player's own ship is measured by its derived value, because a fitted
 * module can change it. Any other ship is measured by its hull until it has a
 * fit of its own.
 */
export function targetSignatureMetres(
  state: CampaignState,
  content: ContentRepository,
  object: SiteObjectState,
): number {
  if (object.id === state.assets.activeShipId) {
    const ship = state.assets.ships[object.id];
    const hull = ship === undefined ? undefined : content.hull(ship.hullId);
    if (ship !== undefined && hull !== undefined) {
      return attributeValue(
        deriveShipAttributes({ hull, fit: shipFit(state.assets, object.id), content }),
        'signatureRadiusMetres',
      );
    }
  }
  return content.hull(object.definitionId)?.signatureRadiusMetres ?? 0;
}

/** Only a ship can be locked and shot at; station infrastructure cannot. */
export function isLockable(object: SiteObjectState): boolean {
  return object.kind === 'ship';
}

/** The charge loaded in one slot, with the physical stack behind it. */
export function loadedCharge(fitted: FittedSlotDescription): {
  readonly ammunitionId: AmmunitionId;
  readonly quantity: number;
  readonly stackId: EntityId | null;
} | null {
  return fitted.charge === null
    ? null
    : {
        ammunitionId: fitted.charge.ammunitionId,
        quantity: fitted.charge.quantity,
        stackId: fitted.charge.stackId,
      };
}
