import {
  activeModuleCapacitorPerCycle,
  activeModuleContext,
  activeModuleCycleMilliseconds,
  activeModuleState,
  activeAttributeConditions,
  applyLayeredDamage,
  applyRepair,
  attributeValue,
  capacitorPerCycle,
  cargoStacks,
  combatChanged,
  combatantIds,
  combatantOf,
  compatibleCargoAmmunition,
  cycleMilliseconds,
  distance,
  drawChance,
  drawUnitInterval,
  deriveShipAttributes,
  inventoryService,
  listedDamage,
  lockTime,
  mutableCombat,
  parseSlotKey,
  payCapacitor,
  PLAIN_STATE,
  pruneCombat,
  recordCapacitorChange,
  recordDamageEvent,
  recordDestructionEvent,
  recordRepairEvent,
  regeneratePool,
  resistanceAttribute,
  relativeMotion,
  scaleDamage,
  setActiveModule,
  setDestroyedAt,
  setLocks,
  setWeapon,
  shotDamageMultiplier,
  shipFit,
  targetSignatureMetres,
  totalDamage,
  turretAccuracy,
  weaponContext,
  weaponState,
  type CampaignDraft,
  type CombatantContext,
  type LockState,
  type MutableRandomStreams,
  type SchedulerEntry,
  type ShipCombatState,
  type ShotOutcome,
  type SlotRef,
  type WeaponState,
  type WeaponStopReason,
} from '@engine/domain';
import { DAMAGE_TYPES, DEFENSE_LAYERS } from '@engine/ports';
import type { AmmunitionId } from '@shared';

import type { SimulationContext } from './context';
import { cancelBoundary, scheduleBoundary } from './scheduler';

/**
 * Locking, turret cycles and reloads in simulation time
 * (Functional Specification 9.2, 9.4-9.5; Technical Specification 9.2, 10.3).
 *
 * Every long-running combat action is a scheduled boundary rather than a
 * timer, and every cost it commits is recorded on the action, so cancelling it
 * returns exactly what the rules say it returns: the reserved round goes back
 * to the magazine and the capacitor already spent does not
 * (Functional Specification 9.4, 22.11).
 *
 * Nothing here is written for the player in particular. Every operation names
 * the ship it acts on, because Technical Specification 10.3 requires an
 * opponent to issue the same module commands through an AI adapter rather than
 * through a second implementation of the rules.
 *
 * A shot is resolved here and applied to the target's defensive layers. Hull
 * depletion is finalized after the full boundary batch at that timestamp.
 *
 * @implements FUNC-9.2, FUNC-9.3, FUNC-9.4, FUNC-9.5, FUNC-22.5, FUNC-22.11, TECH-9.2, TECH-9.4, TECH-10.3, MVP-AC-03, MVP-AC-04
 */

export const LOCK_COMPLETE_BOUNDARY = 'combat.lockComplete';
export const WEAPON_CYCLE_BOUNDARY = 'combat.weaponCycle';
export const RELOAD_COMPLETE_BOUNDARY = 'combat.reloadComplete';
export const MODULE_CYCLE_BOUNDARY = 'combat.moduleCycle';

/**
 * Boundary priorities. A cycle that is due at the same instant as a lock
 * completing resolves first, so a shot is never credited to a lock that did
 * not exist when the cycle started; a reload resolves last, after anything
 * that could still consume a round.
 */
const CYCLE_PRIORITY = 40;
const LOCK_PRIORITY = 50;
const RELOAD_PRIORITY = 60;
/** Repair resolves before the damage completion batch at the same instant. */
const MODULE_PRIORITY = 30;

/**
 * Evaluates lock range and target presence after movement has been integrated
 * (Technical Specification 9.2, step 3).
 */
export function advanceCombat(
  context: SimulationContext,
  fromTimeMs: number,
  toTimeMs: number,
): void {
  if (toTimeMs > fromTimeMs) {
    regenerateShips(context, toTimeMs - fromTimeMs);
    if (context.draft.navigation.currentSite !== null) {
      for (const shipId of combatantIds(context.draft)) {
        evaluateLocks(context, shipId, toTimeMs);
      }
      retryWaitingModules(context, toTimeMs);
    }
  }

  // The clock also calls continuous systems with a zero-length interval after
  // the last completion at one timestamp. Destruction is therefore detected
  // after the whole committed batch, never between two simultaneous shots.
  finalizeDestruction(context);
  if (toTimeMs === fromTimeMs) startEligibleRepeatingActions(context);
}

/** Shield and capacitor regenerate continuously, including in warp. */
function regenerateShips(context: SimulationContext, elapsedMs: number): void {
  for (const shipId of Object.keys(context.draft.assets.ships).sort()) {
    const ship = context.draft.assets.ships[shipId];
    if (ship === undefined || shipCombatOf(context.draft, shipId).destroyedAtMs !== null) continue;
    const hull = context.content.hull(ship.hullId);
    if (hull === undefined) continue;
    const fit = shipFit(context.draft.assets, shipId);
    const combat = shipCombatOf(context.draft, shipId);
    const conditions = activeAttributeConditions(fit, context.content, combat);
    const derived = deriveShipAttributes({ hull, fit, content: context.content, conditions });

    const capacitor = regeneratePool(
      ship.condition.capacitorCharge,
      attributeValue(derived, 'capacitorCapacity'),
      attributeValue(derived, 'capacitorRechargeSeconds'),
      elapsedMs,
    );
    const shieldMaximum = attributeValue(derived, 'shieldHitPoints');
    const shieldCurrent = Math.max(0, shieldMaximum - ship.condition.damage.shield);
    const shield = regeneratePool(
      shieldCurrent,
      shieldMaximum,
      attributeValue(derived, 'shieldRechargeSeconds'),
      elapsedMs,
    );

    if (capacitor.regenerated > 0 || shield.regenerated > 0) {
      ship.condition.capacitorCharge = capacitor.after;
      ship.condition.damage.shield = round(Math.max(0, shieldMaximum - shield.after));
      context.draft.assets.version += 1;
      recordCapacitorChange(
        context.draft,
        shipId,
        capacitor.regenerated,
        context.draft.time.simulationTimeMs + elapsedMs,
      );
      context.invalidate('ship');
      context.invalidate('combat');
      context.invalidate('frame');
    }
  }
}

function evaluateLocks(context: SimulationContext, shipId: string, toTimeMs: number): void {
  const combatant = combatantOf(context.draft, context.content, shipId);
  const site = context.draft.navigation.currentSite;
  if (combatant === null || site === null || combatant.combat.locks.length === 0) return;

  const maxRangeKm = attributeValue(combatant.derived, 'maxLockRangeKm');
  const graceMs = Math.round(context.content.rules.combat.lockRangeGraceSeconds * 1000);
  const before = combatant.combat.locks;
  const kept: LockState[] = [];
  const dropped: { readonly targetId: string; readonly reason: 'targetMissing' | 'outOfRange' }[] = [];

  for (const lock of before) {
    const target = site.objects[lock.targetId];
    if (target === undefined) {
      dropped.push({ targetId: lock.targetId, reason: 'targetMissing' });
      continue;
    }
    if (distance(combatant.object.position, target.position) <= maxRangeKm) {
      kept.push(lock.outOfRangeSinceMs === null ? lock : { ...lock, outOfRangeSinceMs: null });
      continue;
    }
    const since = lock.outOfRangeSinceMs ?? toTimeMs;
    if (toTimeMs - since >= graceMs) {
      dropped.push({ targetId: lock.targetId, reason: 'outOfRange' });
      continue;
    }
    kept.push({ ...lock, outOfRangeSinceMs: since });
  }

  if (dropped.length === 0 && !changedLocks(before, kept)) return;

  for (const loss of dropped) {
    const lock = before.find((candidate) => candidate.targetId === loss.targetId);
    if (lock?.boundaryEntryId != null) cancelBoundary(context.draft, lock.boundaryEntryId);
    stopWeaponsTargeting(
      context,
      shipId,
      loss.targetId,
      loss.reason === 'targetMissing' ? 'targetMissing' : 'lockLost',
    );
    context.publish('combat.lockLost', {
      shipId,
      targetId: loss.targetId,
      reason: loss.reason,
    });
  }

  setLocks(context.draft, shipId, kept);
  touch(context, shipId);
}

/**
 * Completes a lock attempt (Functional Specification 9.2).
 *
 * The lock time is recomputed from current values before the attempt
 * completes, so a scan resolution or a target signature that changed while the
 * attempt was running lengthens or shortens it rather than being ignored.
 */
export function resolveLockComplete(context: SimulationContext, entry: SchedulerEntry): void {
  const found = lockFor(context, entry);
  if (found === null) return;
  const { combatant, lock } = found;
  const shipId = combatant.shipId;
  const target = context.draft.navigation.currentSite?.objects[lock.targetId];

  if (target === undefined) {
    setLocks(
      context.draft,
      shipId,
      combatant.combat.locks.filter((candidate) => candidate.targetId !== lock.targetId),
    );
    stopWeaponsTargeting(context, shipId, lock.targetId, 'targetMissing');
    context.publish('combat.lockLost', {
      shipId,
      targetId: lock.targetId,
      reason: 'targetMissing',
    });
    touch(context, shipId);
    return;
  }

  const requiredMs = lockMilliseconds(context, combatant, lock.targetId);
  const elapsedMs = context.draft.time.simulationTimeMs - lock.startedAtMs;
  const next =
    elapsedMs >= requiredMs
      ? { ...lock, status: 'locked' as const, completesAtMs: null, boundaryEntryId: null }
      : rescheduleLock(context, shipId, lock, requiredMs - elapsedMs);

  setLocks(
    context.draft,
    shipId,
    combatant.combat.locks.map((candidate) =>
      candidate.targetId === lock.targetId ? next : candidate,
    ),
  );
  if (next.status === 'locked') {
    context.publish('combat.lockCompleted', { shipId, targetId: lock.targetId });
  }
  touch(context, shipId);
}

/**
 * Applies one turret shot and decides what the weapon does next
 * (Functional Specification 9.4-9.5).
 */
export function resolveWeaponCycle(context: SimulationContext, entry: SchedulerEntry): void {
  const found = weaponFor(context, entry, (weapon) => weapon.cycle?.boundaryEntryId ?? null);
  if (found === null) return;
  const { combatant, key, slot, weapon } = found;
  const shipId = combatant.shipId;
  const cycle = weapon.cycle;
  if (cycle === null) return;

  // The boundary has fired, so the cycle is over whatever its outcome.
  setWeapon(context.draft, shipId, key, { ...weapon, cycle: null });

  const target = context.draft.navigation.currentSite?.objects[cycle.targetId];
  const locked = combatant.combat.locks.some(
    (lock) => lock.targetId === cycle.targetId && lock.status === 'locked',
  );

  if (target === undefined || !locked) {
    // The reserved round stays loaded and the committed capacitor is not
    // refunded (Functional Specification 9.4, 22.11).
    stopWeapon(context, shipId, key, target === undefined ? 'targetMissing' : 'lockLost');
    touch(context, shipId);
    return;
  }

  const outcome = resolveShot(context, combatant, slot, cycle.targetId, cycle.ammunitionId);
  if (outcome !== null) {
    consumeRound(context, combatant, slot);
    publishShot(context, outcome);
    applyShotDamage(context, outcome);
  }

  touch(context, shipId);
}

/** Finishes a reload and resumes firing when the weapon was left repeating. */
export function resolveReloadComplete(context: SimulationContext, entry: SchedulerEntry): void {
  const found = weaponFor(context, entry, (weapon) => weapon.reload?.boundaryEntryId ?? null);
  if (found === null) return;
  const { combatant, key, slot, weapon } = found;
  const shipId = combatant.shipId;
  const reload = weapon.reload;
  if (reload === null) return;

  const loaded = loadMagazine(context, combatant, slot, reload.ammunitionId);
  setWeapon(context.draft, shipId, key, {
    ...weaponState(shipCombatOf(context.draft, shipId), key),
    reload: null,
    lastAmmunitionId: reload.ammunitionId,
  });
  context.publish('combat.reloadCompleted', {
    shipId,
    slot: key,
    ammunitionId: reload.ammunitionId,
    rounds: loaded,
  });

  if (loaded === 0) {
    stopWeapon(context, shipId, key, 'ammunitionExhausted');
  }
  touch(context, shipId);
}

/** Completes one paid propulsion or repair cycle. */
export function resolveModuleCycle(context: SimulationContext, entry: SchedulerEntry): void {
  const ownerId = entry.ownerId;
  if (ownerId === null) return;
  const combatant = combatantOf(context.draft, context.content, ownerId);
  if (combatant === null) return;

  for (const key of Object.keys(combatant.combat.modules).sort()) {
    const runtime = combatant.combat.modules[key];
    const slot = parseSlotKey(key);
    if (runtime?.cycle?.boundaryEntryId !== entry.entryId || slot === null) continue;
    const operated = activeModuleContext(
      { state: context.draft, content: context.content },
      combatant,
      slot,
    );
    if (operated === null) return;

    setActiveModule(context.draft, ownerId, key, { ...runtime, cycle: null });
    if (
      operated.module.category === 'shieldBooster' ||
      operated.module.category === 'armorRepairer'
    ) {
      applyModuleRepair(context, ownerId, key, operated.module.repair.layer,
        operated.module.repair.amountHitPoints);
    }
    context.publish('combat.moduleCycleCompleted', {
      shipId: ownerId,
      slot: key,
      moduleId: operated.module.id,
    });
    touch(context, ownerId);
    return;
  }
}

/* -------------------------------------------------------------------------- */
/* Operations the command handlers and a future AI adapter share               */
/* -------------------------------------------------------------------------- */

/** Starts a lock attempt. The caller has already checked it is permitted. */
export function beginLock(
  context: SimulationContext,
  shipId: string,
  targetId: string,
): boolean {
  const combatant = combatantOf(context.draft, context.content, shipId);
  const target = context.draft.navigation.currentSite?.objects[targetId];
  if (combatant === null || target === undefined) return false;

  const requiredMs = lockMilliseconds(context, combatant, targetId);
  const dueAtMs = context.draft.time.simulationTimeMs + requiredMs;
  const boundary = scheduleBoundary(context.draft, {
    kind: LOCK_COMPLETE_BOUNDARY,
    dueAtMs,
    priority: LOCK_PRIORITY,
    ownerId: combatant.shipId,
  });

  setLocks(context.draft, shipId, [
    ...combatant.combat.locks,
    {
      targetId,
      status: 'locking',
      startedAtMs: context.draft.time.simulationTimeMs,
      completesAtMs: dueAtMs,
      boundaryEntryId: boundary.entryId,
      outOfRangeSinceMs: null,
    },
  ]);
  context.publish('combat.lockStarted', { shipId, targetId, lockTimeMs: requiredMs });
  touch(context, shipId);
  return true;
}

/** Drops a lock or a lock attempt the owner no longer wants. */
export function releaseLock(
  context: SimulationContext,
  shipId: string,
  targetId: string,
): boolean {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null) return false;
  const lock = combatant.combat.locks.find((candidate) => candidate.targetId === targetId);
  if (lock === undefined) return false;

  if (lock.boundaryEntryId !== null) cancelBoundary(context.draft, lock.boundaryEntryId);
  stopWeaponsTargeting(context, shipId, targetId, 'lockLost');
  setLocks(
    context.draft,
    shipId,
    combatant.combat.locks.filter((candidate) => candidate.targetId !== targetId),
  );
  context.publish('combat.lockReleased', { shipId, targetId });
  touch(context, shipId);
  return true;
}

/** Begins repeated fire at a locked target (Functional Specification 9.4). */
export function activateWeapon(
  context: SimulationContext,
  shipId: string,
  slot: SlotRef,
  targetId: string,
): boolean {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null) return false;
  const weapon = weaponContext({ state: context.draft, content: context.content }, combatant, slot);
  if (weapon === null) return false;

  const runtime = weaponState(combatant.combat, weapon.key);
  if (runtime.cycle !== null && runtime.cycle.targetId !== targetId) {
    // Re-aiming abandons the cycle in flight. The reserved round stays loaded;
    // the capacitor it already spent is not refunded
    // (Functional Specification 22.11).
    cancelBoundary(context.draft, runtime.cycle.boundaryEntryId);
    setWeapon(context.draft, shipId, weapon.key, { ...runtime, cycle: null });
  }

  setWeapon(context.draft, shipId, weapon.key, {
    ...weaponState(shipCombatOf(context.draft, shipId), weapon.key),
    repeating: true,
    targetId,
    stopReason: null,
  });
  context.publish('combat.weaponActivated', {
    shipId,
    slot: weapon.key,
    moduleId: weapon.module.id,
    targetId,
  });
  startNextCycle(context, shipId, slot);
  touch(context, shipId);
  return true;
}

/**
 * Stops the repetition but lets the running cycle finish
 * (Functional Specification 9.4).
 */
export function deactivateWeapon(
  context: SimulationContext,
  shipId: string,
  slot: SlotRef,
): boolean {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null) return false;
  const weapon = weaponContext({ state: context.draft, content: context.content }, combatant, slot);
  if (weapon === null) return false;

  setWeapon(context.draft, shipId, weapon.key, {
    ...weaponState(combatant.combat, weapon.key),
    repeating: false,
    stopReason: 'deactivated',
  });
  context.publish('combat.weaponStopped', { shipId, slot: weapon.key, reason: 'deactivated' });
  touch(context, shipId);
  return true;
}

/**
 * Asks a weapon to reload, or to change its charge
 * (Functional Specification 9.4).
 *
 * A reload begins only once the running cycle has completed, so an activated
 * weapon records what it was asked for and starts when the cycle resolves.
 */
export function requestReload(
  context: SimulationContext,
  shipId: string,
  slot: SlotRef,
  ammunitionId: AmmunitionId,
  changing: boolean,
): boolean {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null) return false;
  const weapon = weaponContext({ state: context.draft, content: context.content }, combatant, slot);
  if (weapon === null) return false;

  const runtime = weaponState(combatant.combat, weapon.key);
  if (runtime.cycle !== null) {
    setWeapon(context.draft, shipId, weapon.key, {
      ...runtime,
      pendingReload: { ammunitionId, changing },
    });
    touch(context, shipId);
    return true;
  }

  beginReload(context, shipId, slot, ammunitionId, changing);
  touch(context, shipId);
  return true;
}

/** Starts a repeating non-weapon module operator. */
export function activateModule(
  context: SimulationContext,
  shipId: string,
  slot: SlotRef,
): boolean {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null) return false;
  const operated = activeModuleContext(
    { state: context.draft, content: context.content },
    combatant,
    slot,
  );
  if (operated === null) return false;

  setActiveModule(context.draft, shipId, operated.key, {
    ...activeModuleState(combatant.combat, operated.key),
    repeating: true,
    waitingForCapacitor: false,
    stopReason: null,
  });
  context.publish('combat.moduleActivated', {
    shipId,
    slot: operated.key,
    moduleId: operated.module.id,
  });
  startNextModuleCycle(context, shipId, slot);
  touch(context, shipId);
  return true;
}

/** Stops repetition; a cycle already paid for still completes. */
export function deactivateModule(
  context: SimulationContext,
  shipId: string,
  slot: SlotRef,
): boolean {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null) return false;
  const operated = activeModuleContext(
    { state: context.draft, content: context.content },
    combatant,
    slot,
  );
  if (operated === null) return false;
  const runtime = activeModuleState(combatant.combat, operated.key);
  setActiveModule(context.draft, shipId, operated.key, {
    ...runtime,
    repeating: false,
    waitingForCapacitor: false,
    stopReason: 'deactivated',
  });
  context.publish('combat.moduleStopped', {
    shipId,
    slot: operated.key,
    moduleId: operated.module.id,
    reason: 'deactivated',
  });
  touch(context, shipId);
  return true;
}

/**
 * Drops every lock, cycle and reload one ship holds, because it left the site
 * (Functional Specification 9.2; Technical Specification 10.1).
 */
export function clearCombat(context: SimulationContext, shipId: string): void {
  const combat = context.draft.combat.ships[shipId];
  if (combat === undefined) return;

  for (const lock of combat.locks) {
    if (lock.boundaryEntryId !== null) cancelBoundary(context.draft, lock.boundaryEntryId);
  }
  for (const weapon of Object.values(combat.weapons)) {
    if (weapon.cycle !== null) cancelBoundary(context.draft, weapon.cycle.boundaryEntryId);
    if (weapon.reload !== null) cancelBoundary(context.draft, weapon.reload.boundaryEntryId);
  }
  for (const module of Object.values(combat.modules)) {
    if (module.cycle !== null) cancelBoundary(context.draft, module.cycle.boundaryEntryId);
  }
  delete (context.draft.combat.ships as Record<string, unknown>)[shipId];
  combatChanged(context.draft);
  context.invalidate('combat');
  context.invalidate('frame');
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Starts the next cycle when the weapon is still repeating and can pay for it,
 * and says why it stopped when it cannot (Functional Specification 9.4).
 */
function startNextCycle(context: SimulationContext, shipId: string, slot: SlotRef): void {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null) return;
  const weapon = weaponContext({ state: context.draft, content: context.content }, combatant, slot);
  if (weapon === null) return;
  const runtime = weaponState(combatant.combat, weapon.key);

  if (runtime.pendingReload !== null) {
    const pending = runtime.pendingReload;
    setWeapon(context.draft, shipId, weapon.key, { ...runtime, pendingReload: null });
    beginReload(context, shipId, slot, pending.ammunitionId, pending.changing);
    return;
  }
  if (!runtime.repeating || runtime.reload !== null || runtime.cycle !== null) return;

  const targetId = runtime.targetId;
  const locked =
    targetId !== null &&
    combatant.combat.locks.some((lock) => lock.targetId === targetId && lock.status === 'locked');
  if (targetId === null || !locked) {
    stopWeapon(context, shipId, weapon.key, 'lockLost');
    return;
  }

  if (weapon.availableRounds <= 0) {
    // An empty magazine reloads automatically while ammunition remains in
    // cargo, and only reports exhaustion when none does
    // (Functional Specification 9.4).
    const options = compatibleCargoAmmunition(
      { state: context.draft, content: context.content },
      combatant,
      weapon,
    );
    const preferred = weapon.ammunitionId ?? runtime.lastAmmunitionId;
    const chosen =
      preferred !== null && options.includes(preferred) ? preferred : options[0] ?? null;
    if (chosen === null) {
      stopWeapon(context, shipId, weapon.key, 'ammunitionExhausted');
      return;
    }
    beginReload(context, shipId, slot, chosen, false);
    return;
  }

  const cost = capacitorPerCycle(weapon);
  const ship = context.draft.assets.ships[shipId];
  if (ship === undefined) return;
  const payment = payCapacitor(ship.condition.capacitorCharge, cost);
  if (!payment.paid) {
    stopWeapon(context, shipId, weapon.key, 'insufficientCapacitor');
    return;
  }

  const dueAtMs = context.draft.time.simulationTimeMs + cycleMilliseconds(weapon);
  const boundary = scheduleBoundary(context.draft, {
    kind: WEAPON_CYCLE_BOUNDARY,
    dueAtMs,
    priority: CYCLE_PRIORITY,
    ownerId: combatant.shipId,
  });

  ship.condition.capacitorCharge = payment.after;
  context.draft.assets.version += 1;
  recordCapacitorChange(
    context.draft,
    shipId,
    -payment.committed,
    context.draft.time.simulationTimeMs,
  );
  setWeapon(context.draft, shipId, weapon.key, {
    ...weaponState(combatant.combat, weapon.key),
    cycle: {
      startedAtMs: context.draft.time.simulationTimeMs,
      completesAtMs: dueAtMs,
      boundaryEntryId: boundary.entryId,
      targetId,
      ammunitionId: weapon.ammunitionId,
      reservedRounds: 1,
      committedCapacitor: payment.committed,
    },
    lastAmmunitionId: weapon.ammunitionId ?? runtime.lastAmmunitionId,
  });
  context.invalidate('ship');
}

/** Starts the next paid active-module cycle or leaves it waiting for charge. */
function startNextModuleCycle(
  context: SimulationContext,
  shipId: string,
  slot: SlotRef,
  startedAtMs: number = context.draft.time.simulationTimeMs,
): void {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null || combatant.combat.destroyedAtMs !== null) return;
  const operated = activeModuleContext(
    { state: context.draft, content: context.content },
    combatant,
    slot,
  );
  if (operated === null) return;
  const runtime = activeModuleState(combatant.combat, operated.key);
  if (!runtime.repeating || runtime.cycle !== null) return;

  const ship = context.draft.assets.ships[shipId];
  if (ship === undefined) return;
  const payment = payCapacitor(
    ship.condition.capacitorCharge,
    activeModuleCapacitorPerCycle(operated),
  );
  if (!payment.paid) {
    if (!runtime.waitingForCapacitor) {
      context.publish('combat.moduleWaiting', {
        shipId,
        slot: operated.key,
        moduleId: operated.module.id,
        reason: 'insufficientCapacitor',
      });
    }
    setActiveModule(context.draft, shipId, operated.key, {
      ...runtime,
      waitingForCapacitor: true,
      stopReason: 'insufficientCapacitor',
    });
    return;
  }

  const dueAtMs = startedAtMs + activeModuleCycleMilliseconds(operated);
  const boundary = scheduleBoundary(context.draft, {
    kind: MODULE_CYCLE_BOUNDARY,
    dueAtMs,
    priority: MODULE_PRIORITY,
    ownerId: combatant.shipId,
  });
  ship.condition.capacitorCharge = payment.after;
  context.draft.assets.version += 1;
  recordCapacitorChange(
    context.draft,
    shipId,
    -payment.committed,
    startedAtMs,
  );
  setActiveModule(context.draft, shipId, operated.key, {
    ...activeModuleState(shipCombatOf(context.draft, shipId), operated.key),
    cycle: {
      startedAtMs,
      completesAtMs: dueAtMs,
      boundaryEntryId: boundary.entryId,
      committedCapacitor: payment.committed,
    },
    waitingForCapacitor: false,
    stopReason: null,
  });
  context.publish('combat.moduleCycleStarted', {
    shipId,
    slot: operated.key,
    moduleId: operated.module.id,
    committedCapacitor: payment.committed,
  });
  context.invalidate('ship');
  context.invalidate('navigation');
  context.invalidate('site');
}

/** Capacitor recharge wakes repeating modules without a host timer. */
function retryWaitingModules(context: SimulationContext, atMs: number): void {
  for (const shipId of Object.keys(context.draft.combat.ships).sort()) {
    const combat = shipCombatOf(context.draft, shipId);
    for (const key of Object.keys(combat.modules).sort()) {
      const runtime = combat.modules[key];
      const slot = parseSlotKey(key);
      if (runtime?.waitingForCapacitor === true && slot !== null) {
        startNextModuleCycle(context, shipId, slot, atMs);
      }
    }
  }
}

/** Starts next cycles only after destruction for the completion batch. */
function startEligibleRepeatingActions(context: SimulationContext): void {
  for (const shipId of Object.keys(context.draft.combat.ships).sort()) {
    const combat = shipCombatOf(context.draft, shipId);
    if (combat.destroyedAtMs !== null) continue;
    for (const key of Object.keys(combat.weapons).sort()) {
      const slot = parseSlotKey(key);
      if (slot !== null) startNextCycle(context, shipId, slot);
    }
    const current = shipCombatOf(context.draft, shipId);
    for (const key of Object.keys(current.modules).sort()) {
      const slot = parseSlotKey(key);
      if (slot !== null) startNextModuleCycle(context, shipId, slot);
    }
  }
}

function applyModuleRepair(
  context: SimulationContext,
  shipId: string,
  slotKey: string,
  layer: (typeof DEFENSE_LAYERS)[number],
  amount: number,
): void {
  const ship = context.draft.assets.ships[shipId];
  if (ship === undefined) return;
  const result = applyRepair(ship.condition.damage[layer], amount);
  ship.condition.damage[layer] = result.afterDamage;
  if (result.repairedHitPoints <= 0) return;
  context.draft.assets.version += 1;
  recordRepairEvent(context.draft, {
    shipId,
    slotKey,
    layer,
    repairedHitPoints: result.repairedHitPoints,
  });
  context.publish('combat.repairApplied', {
    shipId,
    slot: slotKey,
    layer,
    repairedHitPoints: result.repairedHitPoints,
  });
  context.invalidate('ship');
}

/** Unloads first when the charge is changing, then schedules the reload. */
function beginReload(
  context: SimulationContext,
  shipId: string,
  slot: SlotRef,
  ammunitionId: AmmunitionId,
  changing: boolean,
): void {
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (combatant === null) return;
  const weapon = weaponContext({ state: context.draft, content: context.content }, combatant, slot);
  if (weapon === null) return;

  if (changing && weapon.fitted.charge?.stackId != null && weapon.ammunitionId !== ammunitionId) {
    inventoryService(context.draft, context.content).transferAs(
      weapon.fitted.charge.stackId,
      combatant.ship.cargoInventoryId,
      weapon.fitted.charge.quantity,
      PLAIN_STATE,
    );
    context.invalidate('inventory');
  }

  const dueAtMs =
    context.draft.time.simulationTimeMs +
    Math.max(1, Math.round(context.content.rules.combat.reloadSeconds * 1000));
  const boundary = scheduleBoundary(context.draft, {
    kind: RELOAD_COMPLETE_BOUNDARY,
    dueAtMs,
    priority: RELOAD_PRIORITY,
    ownerId: combatant.shipId,
  });

  setWeapon(context.draft, shipId, weapon.key, {
    ...weaponState(shipCombatOf(context.draft, shipId), weapon.key),
    pendingReload: null,
    reload: {
      ammunitionId,
      startedAtMs: context.draft.time.simulationTimeMs,
      completesAtMs: dueAtMs,
      boundaryEntryId: boundary.entryId,
      changing,
    },
  });
  context.publish(changing ? 'combat.ammunitionChanged' : 'combat.reloadStarted', {
    shipId,
    slot: weapon.key,
    ammunitionId,
  });
  context.invalidate('ship');
}

/** Moves rounds from cargo into the magazine, up to the magazine size. */
function loadMagazine(
  context: SimulationContext,
  combatant: CombatantContext,
  slot: SlotRef,
  ammunitionId: AmmunitionId,
): number {
  const current = combatantOf(context.draft, context.content, combatant.shipId);
  if (current === null) return 0;
  const weapon = weaponContext({ state: context.draft, content: context.content }, current, slot);
  if (weapon === null) return 0;
  if (weapon.ammunitionId !== null && weapon.ammunitionId !== ammunitionId) return 0;

  let remaining = weapon.module.turret.magazineSize - weapon.loadedRounds;
  const service = inventoryService(context.draft, context.content);
  let loaded = 0;

  while (remaining > 0) {
    const source = cargoStacks(
      { state: context.draft, content: context.content },
      current,
      ammunitionId,
    )[0];
    if (source === undefined) break;
    const taken = Math.min(remaining, source.quantity);
    service.transferAs(source.id, current.ship.fittingInventoryId, taken, {
      kind: 'charge',
      slot,
    });
    remaining -= taken;
    loaded += taken;
  }

  if (loaded > 0) {
    context.invalidate('inventory');
    context.invalidate('ship');
  }
  return loaded;
}

/** Fires one round from the magazine (Functional Specification 9.4). */
function consumeRound(
  context: SimulationContext,
  combatant: CombatantContext,
  slot: SlotRef,
): void {
  const weapon = weaponContext({ state: context.draft, content: context.content }, combatant, slot);
  const stackId = weapon?.fitted.charge?.stackId ?? null;
  if (stackId === null) return;
  inventoryService(context.draft, context.content).remove(stackId, 1);
  context.invalidate('inventory');
  context.invalidate('ship');
}

/** Rolls one shot (Functional Specification 9.5). */
function resolveShot(
  context: SimulationContext,
  combatant: CombatantContext,
  slot: SlotRef,
  targetId: string,
  ammunitionId: AmmunitionId | null,
): ShotOutcome | null {
  const target = context.draft.navigation.currentSite?.objects[targetId];
  const weapon = weaponContext({ state: context.draft, content: context.content }, combatant, slot);
  if (target === undefined || weapon === null) return null;

  const rules = context.content.rules.combat;
  const charge = ammunitionId === null ? undefined : context.content.ammunition(ammunitionId);
  const turret = weapon.module.turret;
  const motion = relativeMotion(combatant.object, target);
  const accuracy = turretAccuracy(
    {
      optimalRangeKm: turret.optimalRangeKm * (charge?.optimalRangeMultiplier ?? 1),
      falloffKm: turret.falloffKm * (charge?.falloffMultiplier ?? 1),
      trackingRadiansPerSecond: turret.trackingRadiansPerSecond * (charge?.trackingMultiplier ?? 1),
      signatureResolutionMetres: turret.signatureResolutionMetres,
      targetSignatureMetres: targetSignatureMetres(context.draft, context.content, target),
      rangeKm: motion.rangeKm,
      angularVelocityRadiansPerSecond: motion.angularVelocityRadiansPerSecond,
    },
    rules,
  );

  // Draw order is fixed: the hit roll, then the critical roll, then the
  // variation the critical replaces. A miss takes exactly one draw.
  const hit = drawChance(streams(context), 'combat', accuracy.hitChance).outcome === 1;
  const critical =
    hit && drawChance(streams(context), 'combat', rules.criticalHitChance).outcome === 1;
  const variation = hit && !critical ? drawUnitInterval(streams(context), 'combat').outcome : 0;
  const multiplier = hit ? shotDamageMultiplier(variation, critical, rules) : 0;
  const damage = scaleDamage(
    listedDamage(charge?.damagePerShot, turret.damageMultiplier),
    multiplier,
  );

  return {
    attackerId: combatant.shipId,
    targetId,
    slotKey: weapon.key,
    moduleId: weapon.module.id,
    ammunitionId,
    hitChance: accuracy.hitChance,
    hit,
    critical,
    damageMultiplier: multiplier,
    damage,
    totalDamage: totalDamage(damage),
  };
}

function publishShot(context: SimulationContext, outcome: ShotOutcome): void {
  context.publish('combat.shotResolved', {
    attackerId: outcome.attackerId,
    targetId: outcome.targetId,
    slot: outcome.slotKey,
    moduleId: outcome.moduleId,
    ammunitionId: outcome.ammunitionId ?? '',
    hit: outcome.hit,
    critical: outcome.critical,
    hitChance: outcome.hitChance,
    totalDamage: outcome.totalDamage,
    ...Object.fromEntries(
      DAMAGE_TYPES.map((damageType) => [`damage.${damageType}`, outcome.damage[damageType] ?? 0]),
    ),
  });
}

/** Applies one resolved raw vector to shield, armour and hull together. */
function applyShotDamage(context: SimulationContext, outcome: ShotOutcome): void {
  if (!outcome.hit || outcome.totalDamage <= 0) return;
  const target = combatantOf(context.draft, context.content, outcome.targetId);
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
  const result = applyLayeredDamage(outcome.damage, layers);
  const ship = context.draft.assets.ships[outcome.targetId];
  if (ship === undefined) return;
  for (const layer of result.layers) {
    const maximum = attributeValue(target.derived, `${layer.layer}HitPoints`);
    ship.condition.damage[layer.layer] = round(Math.max(0, maximum - layer.afterHitPoints));
  }
  context.draft.assets.version += 1;
  recordDamageEvent(context.draft, {
    sourceId: outcome.attackerId,
    targetId: outcome.targetId,
    slotKey: outcome.slotKey,
    rawDamage: outcome.damage,
    appliedDamage: result.appliedDamage,
    layerDamage: {
      shield: result.layers.find((layer) => layer.layer === 'shield')?.appliedTotal ?? 0,
      armor: result.layers.find((layer) => layer.layer === 'armor')?.appliedTotal ?? 0,
      hull: result.layers.find((layer) => layer.layer === 'hull')?.appliedTotal ?? 0,
    },
  });
  context.publish('combat.damageApplied', {
    attackerId: outcome.attackerId,
    targetId: outcome.targetId,
    slot: outcome.slotKey,
    appliedDamage: result.appliedTotal,
    shieldDamage: result.layers.find((layer) => layer.layer === 'shield')?.appliedTotal ?? 0,
    armorDamage: result.layers.find((layer) => layer.layer === 'armor')?.appliedTotal ?? 0,
    hullDamage: result.layers.find((layer) => layer.layer === 'hull')?.appliedTotal ?? 0,
  });
  context.invalidate('ship');
  context.invalidate('combat');
}

/**
 * Marks zero-hull ships after every completion at this timestamp resolved.
 * This is deliberately separate from applying a shot: a ship destroyed by
 * simultaneous fire still contributes the cycle it had already committed.
 */
function finalizeDestruction(context: SimulationContext): void {
  const site = context.draft.navigation.currentSite;
  if (site === null) return;
  for (const shipId of Object.keys(site.objects).sort()) {
    const combatant = combatantOf(context.draft, context.content, shipId);
    if (combatant === null || combatant.combat.destroyedAtMs !== null) continue;
    const hullMaximum = attributeValue(combatant.derived, 'hullHitPoints');
    if (combatant.ship.condition.damage.hull + 1e-9 < hullMaximum) continue;

    stopAllOperationsForDestruction(context, shipId);
    setDestroyedAt(context.draft, shipId, context.draft.time.simulationTimeMs);
    for (const attackerId of Object.keys(context.draft.combat.ships).sort()) {
      if (attackerId !== shipId) stopLocksTargetingDestroyed(context, attackerId, shipId);
    }
    recordDestructionEvent(context.draft, shipId);
    context.publish('combat.shipDestroyed', { shipId });
    combatChanged(context.draft);
    context.invalidate('ship');
    context.invalidate('combat');
    context.invalidate('site');
    context.invalidate('frame');
  }
}

function stopAllOperationsForDestruction(context: SimulationContext, shipId: string): void {
  const combat = shipCombatOf(context.draft, shipId);
  for (const lock of combat.locks) {
    if (lock.boundaryEntryId !== null) cancelBoundary(context.draft, lock.boundaryEntryId);
  }
  for (const weapon of Object.values(combat.weapons)) {
    if (weapon.cycle !== null) cancelBoundary(context.draft, weapon.cycle.boundaryEntryId);
    if (weapon.reload !== null) cancelBoundary(context.draft, weapon.reload.boundaryEntryId);
  }
  for (const module of Object.values(combat.modules)) {
    if (module.cycle !== null) cancelBoundary(context.draft, module.cycle.boundaryEntryId);
  }
  const mutable = mutableCombat(context.draft, shipId);
  mutable.locks = [];
  for (const key of Object.keys(mutable.weapons)) {
    mutable.weapons[key] = {
      ...mutable.weapons[key]!,
      repeating: false,
      targetId: null,
      cycle: null,
      reload: null,
      pendingReload: null,
      stopReason: 'targetMissing',
    };
  }
  for (const key of Object.keys(mutable.modules)) {
    mutable.modules[key] = {
      ...mutable.modules[key]!,
      repeating: false,
      cycle: null,
      waitingForCapacitor: false,
      stopReason: 'destroyed',
    };
  }
}

function stopLocksTargetingDestroyed(
  context: SimulationContext,
  shipId: string,
  destroyedId: string,
): void {
  const combat = shipCombatOf(context.draft, shipId);
  const lock = combat.locks.find((candidate) => candidate.targetId === destroyedId);
  if (lock === undefined) return;
  if (lock.boundaryEntryId !== null) cancelBoundary(context.draft, lock.boundaryEntryId);
  stopWeaponsTargeting(context, shipId, destroyedId, 'targetMissing');
  setLocks(
    context.draft,
    shipId,
    combat.locks.filter((candidate) => candidate.targetId !== destroyedId),
  );
  context.publish('combat.lockLost', {
    shipId,
    targetId: destroyedId,
    reason: 'targetMissing',
  });
}

function stopWeapon(
  context: SimulationContext,
  shipId: string,
  key: string,
  reason: WeaponStopReason,
): void {
  setWeapon(context.draft, shipId, key, {
    ...weaponState(shipCombatOf(context.draft, shipId), key),
    repeating: false,
    targetId: null,
    stopReason: reason,
  });
  context.publish('combat.weaponStopped', { shipId, slot: key, reason });
  if (reason === 'lockLost' || reason === 'targetMissing') {
    reloadIfEmpty(context, shipId, key);
  }
}

/**
 * Refills an empty magazine when a weapon stops for want of a target
 * (Functional Specification 9.4).
 *
 * The shot that destroys a target can be the magazine's last round. A
 * repeating weapon reloads an empty magazine before its next cycle, but with
 * the target gone there is no next cycle, and an empty magazine holds no
 * charge to remember once the ship docks - so the gun would come home unable
 * to be resupplied. Reload may be automatic when empty, so it is: from the
 * charge it last held when the hold still carries it, otherwise from the first
 * compatible charge there. Nothing is reloaded when the hold has none.
 */
function reloadIfEmpty(context: SimulationContext, shipId: string, key: string): void {
  const slot = parseSlotKey(key);
  const combatant = combatantOf(context.draft, context.content, shipId);
  if (slot === null || combatant === null || combatant.combat.destroyedAtMs !== null) return;
  const rules = { state: context.draft, content: context.content };
  const weapon = weaponContext(rules, combatant, slot);
  if (weapon === null || weapon.loadedRounds > 0) return;
  const runtime = weaponState(combatant.combat, key);
  if (runtime.reload !== null || runtime.pendingReload !== null || runtime.cycle !== null) return;

  const options = compatibleCargoAmmunition(rules, combatant, weapon);
  const preferred = runtime.lastAmmunitionId;
  const chosen = preferred !== null && options.includes(preferred) ? preferred : options[0] ?? null;
  if (chosen !== null) {
    beginReload(context, shipId, slot, chosen, false);
  }
}

function stopWeaponsTargeting(
  context: SimulationContext,
  shipId: string,
  targetId: string,
  reason: WeaponStopReason,
): void {
  const combat = shipCombatOf(context.draft, shipId);
  for (const key of Object.keys(combat.weapons).sort()) {
    const weapon = combat.weapons[key];
    if (weapon === undefined || weapon.targetId !== targetId) continue;
    if (weapon.cycle !== null) cancelBoundary(context.draft, weapon.cycle.boundaryEntryId);
    setWeapon(context.draft, shipId, key, { ...weapon, cycle: null });
    stopWeapon(context, shipId, key, reason);
  }
}

/** Whole milliseconds the current values say a lock attempt takes. */
function lockMilliseconds(
  context: SimulationContext,
  combatant: CombatantContext,
  targetId: string,
): number {
  const target = context.draft.navigation.currentSite?.objects[targetId];
  const seconds = lockTime(
    {
      scanResolution: attributeValue(combatant.derived, 'scanResolution'),
      targetSignatureMetres:
        target === undefined ? 0 : targetSignatureMetres(context.draft, context.content, target),
    },
    context.content.rules.combat,
  ).seconds;
  return Math.max(1, Math.round(seconds * 1000));
}

function rescheduleLock(
  context: SimulationContext,
  shipId: string,
  lock: LockState,
  remainingMs: number,
): LockState {
  const dueAtMs = context.draft.time.simulationTimeMs + Math.max(1, remainingMs);
  const boundary = scheduleBoundary(context.draft, {
    kind: LOCK_COMPLETE_BOUNDARY,
    dueAtMs,
    priority: LOCK_PRIORITY,
    ownerId: shipId as CombatantContext['shipId'],
  });
  return { ...lock, completesAtMs: dueAtMs, boundaryEntryId: boundary.entryId };
}

interface FoundLock {
  readonly combatant: CombatantContext;
  readonly lock: LockState;
}

function lockFor(context: SimulationContext, entry: SchedulerEntry): FoundLock | null {
  const combatant =
    entry.ownerId === null ? null : combatantOf(context.draft, context.content, entry.ownerId);
  if (combatant === null) return null;
  const lock = combatant.combat.locks.find(
    (candidate) => candidate.boundaryEntryId === entry.entryId,
  );
  return lock === undefined ? null : { combatant, lock };
}

interface FoundWeapon {
  readonly combatant: CombatantContext;
  readonly key: string;
  readonly slot: SlotRef;
  readonly weapon: WeaponState;
}

function weaponFor(
  context: SimulationContext,
  entry: SchedulerEntry,
  boundaryOf: (weapon: WeaponState) => string | null,
): FoundWeapon | null {
  const combatant =
    entry.ownerId === null ? null : combatantOf(context.draft, context.content, entry.ownerId);
  if (combatant === null) return null;
  for (const key of Object.keys(combatant.combat.weapons).sort()) {
    const weapon = combatant.combat.weapons[key];
    const slot = parseSlotKey(key);
    if (weapon === undefined || slot === null) continue;
    if (boundaryOf(weapon) === entry.entryId) {
      return { combatant, key, slot, weapon };
    }
  }
  return null;
}

function shipCombatOf(draft: CampaignDraft, shipId: string): ShipCombatState {
  return draft.combat.ships[shipId] ?? EMPTY_COMBAT;
}

const EMPTY_COMBAT: ShipCombatState = {
  locks: [],
  weapons: {},
  modules: {},
  destroyedAtMs: null,
  capacitorTrend: null,
};

function changedLocks(before: readonly LockState[], after: readonly LockState[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((lock, index) => lock.outOfRangeSinceMs !== after[index]?.outOfRangeSinceMs);
}

function touch(context: SimulationContext, shipId: string): void {
  pruneCombat(context.draft, shipId);
  combatChanged(context.draft);
  context.invalidate('combat');
  context.invalidate('frame');
}

/** The draft's streams, which only a domain draw may advance. */
function streams(context: SimulationContext): MutableRandomStreams {
  return context.draft.random as MutableRandomStreams;
}

/** Capacitor is a continuous value; one cycle must not leave a float tail. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
