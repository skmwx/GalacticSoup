import {
  activateRefusal,
  activeCombatant,
  attributeValue,
  capacitorPerCycle,
  changeAmmunitionRefusal,
  compatibleCargoAmmunition,
  deactivateRefusal,
  listedDamage,
  lockRefusal,
  lockTime,
  relativeMotion,
  reloadRefusal,
  targetSignatureMetres,
  totalDamage,
  turretAccuracy,
  unlockRefusal,
  weaponContext,
  weaponState,
  type CampaignState,
  type CombatantContext,
  type CombatCommandRefusal,
  type CombatRuleInput,
  type LockState,
  type WeaponContext,
} from '@engine/domain';
import { DAMAGE_TYPES, type ContentRepository, type DamageProfile } from '@engine/ports';
import type {
  CombatData,
  CommandAvailabilityData,
  FormulaTraceData,
  LockData,
  ObjectLockAvailabilityData,
  TargetMotionData,
  WeaponEffectData,
  WeaponRuntimeData,
} from '@protocol';
import { ruleViolationMessageKey } from '@protocol';
import { deepFreeze } from '@shared';

/**
 * The tactical view (Functional Specification 9.2-9.5, 19.3).
 *
 * Range, closing speed, transverse velocity, angular velocity, lock progress
 * and per-weapon hit chance are all derived here and travel with the trace
 * that produced them, so the interface explains a number rather than
 * recomputing one. Availability comes from the same predicates the command
 * handlers ask (Technical Specification 12.3).
 *
 * @implements TECH-7.3, TECH-10.3, TECH-12.3, FUNC-9.2, FUNC-9.3, FUNC-9.4, FUNC-9.5, FUNC-19.3, MVP-AC-04
 */
export function combatProjection(state: CampaignState, content: ContentRepository): CombatData {
  const rules: CombatRuleInput = { state, content };
  const combatant = activeCombatant(state, content);

  if (combatant === null) {
    return deepFreeze({
      revision: state.revision,
      simulationTimeMs: state.time.simulationTimeMs,
      shipId: null,
      maxLockedTargets: 0,
      maxLockRangeKm: 0,
      scanResolution: 0,
      signatureRadiusMetres: 0,
      capacitorCharge: 0,
      capacitorCapacity: 0,
      locks: [],
      motion: [],
      weapons: [],
      lockCommands: [],
    });
  }

  const site = state.navigation.currentSite;
  const maxLockRangeKm = attributeValue(combatant.derived, 'maxLockRangeKm');
  const locks = [...combatant.combat.locks].sort((a, b) => a.targetId.localeCompare(b.targetId));
  const weapons = weaponSlots(rules, combatant);

  return deepFreeze({
    revision: state.revision,
    simulationTimeMs: state.time.simulationTimeMs,
    shipId: combatant.shipId,
    maxLockedTargets: attributeValue(combatant.derived, 'maxLockedTargets'),
    maxLockRangeKm,
    scanResolution: attributeValue(combatant.derived, 'scanResolution'),
    signatureRadiusMetres: attributeValue(combatant.derived, 'signatureRadiusMetres'),
    capacitorCharge: combatant.ship.condition.capacitorCharge,
    capacitorCapacity: attributeValue(combatant.derived, 'capacitorCapacity'),
    locks: locks.map((lock) => lockData(rules, combatant, lock)),
    motion: Object.values(site?.objects ?? {})
      .filter((object) => object.id !== combatant.shipId && object.kind === 'ship')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((object): TargetMotionData => {
        const motion = relativeMotion(combatant.object, object);
        return {
          targetId: object.id,
          rangeKm: motion.rangeKm,
          closingSpeedKmPerSecond: motion.closingSpeedKmPerSecond,
          transverseVelocityKmPerSecond: motion.transverseVelocityKmPerSecond,
          angularVelocityRadiansPerSecond: motion.angularVelocityRadiansPerSecond,
          signatureRadiusMetres: targetSignatureMetres(state, content, object),
          withinLockRange: motion.rangeKm <= maxLockRangeKm,
        };
      }),
    weapons: weapons.map((weapon) => weaponData(rules, combatant, weapon, locks)),
    lockCommands: Object.values(site?.objects ?? {})
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (object): ObjectLockAvailabilityData => ({
          objectId: object.id,
          commands: [
            availability('targeting.lock', lockRefusal(rules, object.id)),
            availability('targeting.unlock', unlockRefusal(rules, object.id)),
          ],
        }),
      ),
  });
}

/** Every weapon slot the hull offers, whether or not it holds a turret. */
function weaponSlots(
  rules: CombatRuleInput,
  combatant: CombatantContext,
): readonly WeaponContext[] {
  const slots: WeaponContext[] = [];
  for (let index = 0; index < combatant.hull.slots.weapon; index += 1) {
    const weapon = weaponContext(rules, combatant, { kind: 'weapon', index });
    if (weapon !== null) slots.push(weapon);
  }
  return slots;
}

function lockData(
  rules: CombatRuleInput,
  combatant: CombatantContext,
  lock: LockState,
): LockData {
  const target = rules.state.navigation.currentSite?.objects[lock.targetId];
  const computed = lockTime(
    {
      scanResolution: attributeValue(combatant.derived, 'scanResolution'),
      targetSignatureMetres:
        target === undefined ? 0 : targetSignatureMetres(rules.state, rules.content, target),
    },
    rules.content.rules.combat,
  );

  return {
    targetId: lock.targetId,
    status: lock.status,
    startedAtMs: lock.startedAtMs,
    completesAtMs: lock.completesAtMs,
    remainingSeconds:
      lock.completesAtMs === null
        ? null
        : Math.max(0, lock.completesAtMs - rules.state.time.simulationTimeMs) / 1000,
    lockTimeSeconds: computed.seconds,
    trace: traceData(computed.trace),
    outOfRangeSinceMs: lock.outOfRangeSinceMs,
    commands: [availability('targeting.unlock', unlockRefusal(rules, lock.targetId))],
  };
}

function weaponData(
  rules: CombatRuleInput,
  combatant: CombatantContext,
  weapon: WeaponContext,
  locks: readonly LockState[],
): WeaponRuntimeData {
  const runtime = weaponState(combatant.combat, weapon.key);
  const turret = weapon.module.turret;
  const charge =
    weapon.ammunitionId === null ? undefined : rules.content.ammunition(weapon.ammunitionId);
  const optimalRangeKm = turret.optimalRangeKm * (charge?.optimalRangeMultiplier ?? 1);
  const falloffKm = turret.falloffKm * (charge?.falloffMultiplier ?? 1);
  const listed = listedDamage(charge?.damagePerShot, turret.damageMultiplier);
  const now = rules.state.time.simulationTimeMs;

  return {
    slot: { kind: weapon.slot.kind, index: weapon.slot.index },
    moduleId: weapon.module.id,
    nameKey: weapon.module.nameKey,
    online: weapon.fitted.online,
    ammunitionId: weapon.ammunitionId,
    loadedRounds: weapon.loadedRounds,
    magazineSize: turret.magazineSize,
    cycleSeconds: weapon.module.activation?.cycleSeconds ?? 0,
    capacitorPerCycle: capacitorPerCycle(weapon),
    optimalRangeKm,
    falloffKm,
    absoluteRangeKm:
      optimalRangeKm + rules.content.rules.combat.absoluteRangeFalloffMultiples * falloffKm,
    trackingRadiansPerSecond: turret.trackingRadiansPerSecond * (charge?.trackingMultiplier ?? 1),
    repeating: runtime.repeating,
    targetId: runtime.targetId,
    cycle:
      runtime.cycle === null
        ? null
        : {
            startedAtMs: runtime.cycle.startedAtMs,
            completesAtMs: runtime.cycle.completesAtMs,
            remainingSeconds: Math.max(0, runtime.cycle.completesAtMs - now) / 1000,
            targetId: runtime.cycle.targetId,
            ammunitionId: runtime.cycle.ammunitionId,
            reservedRounds: runtime.cycle.reservedRounds,
            committedCapacitor: runtime.cycle.committedCapacitor,
          },
    reload:
      runtime.reload === null
        ? null
        : {
            ammunitionId: runtime.reload.ammunitionId,
            completesAtMs: runtime.reload.completesAtMs,
            remainingSeconds: Math.max(0, runtime.reload.completesAtMs - now) / 1000,
            changing: runtime.reload.changing,
          },
    stopReason: runtime.stopReason,
    compatibleAmmunition: compatibleCargoAmmunition(rules, combatant, weapon),
    effects: locks.map((lock) => weaponEffect(rules, combatant, weapon, lock, listed)),
    commands: [
      availability('weapon.activate', activateRefusal(rules, weapon.slot, null)),
      availability('weapon.deactivate', deactivateRefusal(rules, weapon.slot)),
      availability('weapon.reload', reloadRefusal(rules, weapon.slot)),
      availability('weapon.changeAmmunition', changeAmmunitionRefusal(rules, weapon.slot, null)),
    ],
  };
}

function weaponEffect(
  rules: CombatRuleInput,
  combatant: CombatantContext,
  weapon: WeaponContext,
  lock: LockState,
  listed: DamageProfile,
): WeaponEffectData {
  const target = rules.state.navigation.currentSite?.objects[lock.targetId];
  const turret = weapon.module.turret;
  const charge =
    weapon.ammunitionId === null ? undefined : rules.content.ammunition(weapon.ammunitionId);
  const motion =
    target === undefined
      ? { rangeKm: 0, angularVelocityRadiansPerSecond: 0 }
      : relativeMotion(combatant.object, target);
  const accuracy = turretAccuracy(
    {
      optimalRangeKm: turret.optimalRangeKm * (charge?.optimalRangeMultiplier ?? 1),
      falloffKm: turret.falloffKm * (charge?.falloffMultiplier ?? 1),
      trackingRadiansPerSecond: turret.trackingRadiansPerSecond * (charge?.trackingMultiplier ?? 1),
      signatureResolutionMetres: turret.signatureResolutionMetres,
      targetSignatureMetres:
        target === undefined ? 0 : targetSignatureMetres(rules.state, rules.content, target),
      rangeKm: motion.rangeKm,
      angularVelocityRadiansPerSecond: motion.angularVelocityRadiansPerSecond,
    },
    rules.content.rules.combat,
  );

  return {
    targetId: lock.targetId,
    hitChance: accuracy.hitChance,
    trackingStrain: Number.isFinite(accuracy.trackingStrain) ? accuracy.trackingStrain : 0,
    rangeStrain: accuracy.rangeStrain,
    withinAbsoluteRange: accuracy.withinAbsoluteRange,
    listedDamage: Object.fromEntries(DAMAGE_TYPES.map((type) => [type, listed[type]])),
    expectedDamagePerShot: accuracy.hitChance * totalDamage(listed),
    trace: traceData(accuracy.trace),
  };
}

/** The lock availability one site object offers, for the site projection. */
export function objectLockCommands(
  state: CampaignState,
  content: ContentRepository,
  objectId: string,
): readonly CommandAvailabilityData[] {
  const rules: CombatRuleInput = { state, content };
  return [
    availability('targeting.lock', lockRefusal(rules, objectId)),
    availability('targeting.unlock', unlockRefusal(rules, objectId)),
  ];
}

function availability(command: string, refusal: CombatCommandRefusal): CommandAvailabilityData {
  return {
    command,
    available: refusal === null,
    unavailableReason: refusal === null ? null : ruleViolationMessageKey(refusal),
  };
}

function traceData(trace: {
  readonly formulaKey: string;
  readonly operands: readonly { readonly key: string; readonly value: number }[];
  readonly unroundedResult: number;
  readonly displayResult: number;
}): FormulaTraceData {
  return {
    formulaKey: trace.formulaKey,
    operands: trace.operands.map((operand) => ({ key: operand.key, value: operand.value })),
    unroundedResult: trace.unroundedResult,
    displayResult: trace.displayResult,
  };
}
