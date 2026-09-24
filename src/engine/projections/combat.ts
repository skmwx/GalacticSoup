import {
  activeModuleState,
  activateModuleRefusal,
  activateRefusal,
  activeCombatant,
  attributeValue,
  CAPACITOR_TREND_WINDOW_MS,
  capacitorPerCycle,
  cargoRounds,
  changeAmmunitionRefusal,
  compatibleCargoAmmunition,
  combatantOf,
  deactivateRefusal,
  deactivateModuleRefusal,
  deriveShipAttributes,
  listedDamage,
  lockRefusal,
  lockTime,
  relativeMotion,
  resistanceAttribute,
  reloadRefusal,
  shipCombat,
  slotKey,
  targetSignatureMetres,
  totalDamage,
  turretAccuracy,
  turretLimitingFactor,
  unlockRefusal,
  weaponContext,
  weaponState,
  type CampaignState,
  type CombatantContext,
  type CombatCommandRefusal,
  type CombatRuleInput,
  type LockState,
  type FittedSlotDescription,
  type WeaponContext,
} from '@engine/domain';
import {
  DAMAGE_TYPES,
  DEFENSE_LAYERS,
  type ContentRepository,
  type DamageProfile,
  type ModuleDefinition,
} from '@engine/ports';
import type {
  ActiveEffectData,
  AmmunitionOptionData,
  CombatData,
  CapacitorStateData,
  CommandAvailabilityData,
  DefenseStateData,
  FormulaTraceData,
  HostileLockData,
  LockData,
  ModuleEffectData,
  ModuleRuntimeData,
  ObjectLockAvailabilityData,
  TargetMotionData,
  WeaponEffectData,
  WeaponRuntimeData,
} from '@protocol';
import { ruleViolationMessageKey } from '@protocol';
import { deepFreeze, type AmmunitionId } from '@shared';

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
      defenses: null,
      capacitor: null,
      modules: [],
      targetDefenses: [],
      hostileLocks: [],
      events: state.combat.events.map((event) => ({ ...event })),
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
  const modules = fittedModules(rules, combatant);
  const targetCombatants = Object.values(site?.objects ?? {})
    .filter((object) => object.id !== combatant.shipId && object.kind === 'ship')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((object) => combatantOf(state, content, object.id))
    .filter((target): target is CombatantContext => target !== null);

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
    defenses: defenseData(rules, combatant),
    capacitor: capacitorData(rules, combatant, modules),
    modules: modules.map((module) => moduleData(rules, combatant, module)),
    targetDefenses: targetCombatants.map((target) => defenseData(rules, target)),
    hostileLocks: hostileLocks(rules, combatant, targetCombatants),
    events: state.combat.events.map((event) => ({ ...event })),
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

interface ProjectedModule {
  readonly fitted: FittedSlotDescription;
  readonly module: Exclude<ModuleDefinition, { readonly category: 'turret' }>;
}

function fittedModules(
  rules: CombatRuleInput,
  combatant: CombatantContext,
): readonly ProjectedModule[] {
  return combatant.fit
    .map((fitted) => {
      const module = rules.content.module(fitted.moduleId);
      return module === undefined || module.category === 'turret' ? null : { fitted, module };
    })
    .filter((entry): entry is ProjectedModule => entry !== null)
    .sort((a, b) =>
      a.fitted.slot.kind.localeCompare(b.fitted.slot.kind) ||
      a.fitted.slot.index - b.fitted.slot.index);
}

/**
 * Who in the site is locking or has locked the player's ship
 * (Functional Specification 19.1, 19.7).
 */
function hostileLocks(
  rules: CombatRuleInput,
  combatant: CombatantContext,
  others: readonly CombatantContext[],
): readonly HostileLockData[] {
  return others.flatMap((other): HostileLockData[] => {
    const lock = shipCombat(rules.state, other.shipId).locks.find(
      (candidate) => candidate.targetId === combatant.shipId,
    );
    return lock === undefined || other.combat.destroyedAtMs !== null
      ? []
      : [{ shipId: other.shipId, status: lock.status }];
  });
}

/**
 * The modules one ship has in a paid cycle, which is when their effect
 * applies (Functional Specification 9.7-9.8, 19.3).
 */
function activeEffects(
  rules: CombatRuleInput,
  combatant: CombatantContext,
): readonly ActiveEffectData[] {
  return combatant.fit
    .filter((fitted) => activeModuleState(combatant.combat, slotKey(fitted.slot)).cycle !== null)
    .sort((a, b) => a.slot.kind.localeCompare(b.slot.kind) || a.slot.index - b.slot.index)
    .flatMap((fitted): ActiveEffectData[] => {
      const module = rules.content.module(fitted.moduleId);
      return module === undefined
        ? []
        : [{
            slot: { ...fitted.slot },
            moduleId: module.id,
            nameKey: module.nameKey,
            category: module.category,
          }];
    });
}

function defenseData(rules: CombatRuleInput, combatant: CombatantContext): DefenseStateData {
  return {
    shipId: combatant.shipId,
    destroyed: combatant.combat.destroyedAtMs !== null,
    destroyedAtMs: combatant.combat.destroyedAtMs,
    layers: DEFENSE_LAYERS.map((layer) => {
      const hitPoints = combatant.derived.attributes[`${layer}HitPoints`];
      const maximumHitPoints = hitPoints?.value ?? 0;
      const damageTaken = Math.min(maximumHitPoints, combatant.ship.condition.damage[layer]);
      const currentHitPoints = Math.max(0, maximumHitPoints - damageTaken);
      return {
        layer,
        currentHitPoints,
        maximumHitPoints,
        damageTaken,
        fractionRemaining: maximumHitPoints > 0 ? currentHitPoints / maximumHitPoints : 0,
        resistances: Object.fromEntries(
          DAMAGE_TYPES.map((type) => [
            type,
            attributeValue(combatant.derived, resistanceAttribute(layer, type)),
          ]),
        ),
        hitPointsTrace: attributeTrace(
          hitPoints ?? { attribute: `${layer}HitPoints`, base: 0, value: 0, clamped: false, steps: [] },
        ),
        resistanceTraces: Object.fromEntries(
          DAMAGE_TYPES.map((type) => {
            const attribute = resistanceAttribute(layer, type);
            const derived = combatant.derived.attributes[attribute] ?? {
              attribute, base: 0, value: 0, clamped: false, steps: [],
            };
            return [type, attributeTrace(derived)];
          }),
        ),
      };
    }),
    activeEffects: activeEffects(rules, combatant),
  };
}

function capacitorData(
  rules: CombatRuleInput,
  combatant: CombatantContext,
  modules: readonly ProjectedModule[],
): CapacitorStateData {
  const state = rules.state;
  const capacity = attributeValue(combatant.derived, 'capacitorCapacity');
  const rechargeSeconds = attributeValue(combatant.derived, 'capacitorRechargeSeconds');
  const rechargePerSecond = rechargeSeconds > 0 ? capacity / rechargeSeconds : 0;
  const moduleUse = modules.reduce((total, entry) => {
    const runtime = activeModuleState(combatant.combat, slotOf(entry.fitted));
    const activation = entry.module.activation;
    return total + (runtime.repeating && activation !== undefined && activation.cycleSeconds > 0
      ? activation.capacitorPerCycle / activation.cycleSeconds
      : 0);
  }, 0);
  const weaponUse = weaponSlots(rules, combatant).reduce(
    (total, weapon) => {
      const runtime = weaponState(combatant.combat, weapon.key);
      const seconds = weapon.module.activation?.cycleSeconds ?? 0;
      return total + (runtime.repeating && seconds > 0 ? capacitorPerCycle(weapon) / seconds : 0);
    },
    0,
  );
  const projectedUsePerSecond = moduleUse + weaponUse;
  const projectedNetChangePerSecond = rechargePerSecond - projectedUsePerSecond;
  const stable = projectedNetChangePerSecond >= 0;
  const enduranceSeconds = stable
    ? null
    : combatant.ship.condition.capacitorCharge / -projectedNetChangePerSecond;
  const trend = combatant.combat.capacitorTrend;
  const recentNetChangePerSecond =
    trend === null || state.time.simulationTimeMs - trend.lastChangedAtMs > CAPACITOR_TREND_WINDOW_MS
      ? 0
      : trend.netChange /
        Math.max(0.001, (state.time.simulationTimeMs - trend.windowStartedAtMs) / 1000);
  const capacityDerived = combatant.derived.attributes['capacitorCapacity']!;
  const rechargeDerived = combatant.derived.attributes['capacitorRechargeSeconds']!;

  return {
    charge: combatant.ship.condition.capacitorCharge,
    capacity,
    rechargePerSecond,
    recentNetChangePerSecond,
    projectedUsePerSecond,
    projectedNetChangePerSecond,
    enduranceSeconds,
    stable,
    capacityTrace: attributeTrace(capacityDerived),
    rechargeTrace: attributeTrace(rechargeDerived),
    enduranceTrace: {
      formulaKey: 'combat.formula.capacitorEndurance',
      operands: [
        { key: 'charge', value: combatant.ship.condition.capacitorCharge },
        { key: 'rechargePerSecond', value: rechargePerSecond },
        { key: 'usePerSecond', value: projectedUsePerSecond },
        { key: 'netPerSecond', value: projectedNetChangePerSecond },
      ],
      unroundedResult: enduranceSeconds ?? -1,
      displayResult: enduranceSeconds === null ? -1 : Math.round(enduranceSeconds * 10) / 10,
    },
  };
}

function moduleData(
  rules: CombatRuleInput,
  combatant: CombatantContext,
  entry: ProjectedModule,
): ModuleRuntimeData {
  const key = slotOf(entry.fitted);
  const runtime = activeModuleState(combatant.combat, key);
  const cycleSeconds = entry.module.activation?.cycleSeconds ?? 0;
  const passive = entry.module.activation === undefined;
  const status: ModuleRuntimeData['status'] = !entry.fitted.online
    ? 'offline'
    : passive
      ? 'passive'
      : runtime.waitingForCapacitor
        ? 'waiting'
        : runtime.cycle !== null && !runtime.repeating
          ? 'deactivating'
          : runtime.cycle !== null
            ? 'active'
            : 'inactive';

  return {
    slot: { ...entry.fitted.slot },
    moduleId: entry.module.id,
    nameKey: entry.module.nameKey,
    category: entry.module.category,
    online: entry.fitted.online,
    passive,
    repeating: runtime.repeating,
    waitingForCapacitor: runtime.waitingForCapacitor,
    status,
    cycleSeconds,
    capacitorPerCycle: entry.module.activation?.capacitorPerCycle ?? 0,
    cycle: runtime.cycle === null ? null : {
      startedAtMs: runtime.cycle.startedAtMs,
      completesAtMs: runtime.cycle.completesAtMs,
      remainingSeconds: Math.max(0, runtime.cycle.completesAtMs - rules.state.time.simulationTimeMs) / 1000,
      committedCapacitor: runtime.cycle.committedCapacitor,
    },
    stopReason: runtime.stopReason,
    effect: moduleEffect(rules, combatant, entry),
    commands: passive ? [] : [
      availability('module.activate', activateModuleRefusal(rules, entry.fitted.slot)),
      availability('module.deactivate', deactivateModuleRefusal(rules, entry.fitted.slot)),
    ],
  };
}

function moduleEffect(
  rules: CombatRuleInput,
  combatant: CombatantContext,
  entry: ProjectedModule,
): ModuleEffectData {
  const module = entry.module;
  if (module.category === 'propulsion') {
    const base = deriveShipAttributes({
      hull: combatant.hull,
      fit: combatant.fit,
      content: rules.content,
      conditions: new Set<string>(),
    });
    const baseValue = attributeValue(base, 'maxSpeedKmPerSecond');
    const active = deriveShipAttributes({
      hull: combatant.hull,
      fit: combatant.fit,
      content: rules.content,
      conditions: new Set(['propulsion.active']),
    });
    const activeValue = attributeValue(active, 'maxSpeedKmPerSecond');
    return effect('propulsion', null, 0, 0, baseValue, activeValue,
      { speedBonusFraction: module.propulsion.speedBonusFraction },
      attributeTrace(active.attributes['maxSpeedKmPerSecond']!));
  }
  if (module.category === 'shieldBooster' || module.category === 'armorRepairer') {
    const amount = module.repair.amountHitPoints;
    return effect('repair', module.repair.layer, amount,
      cycleRate(amount, module.activation?.cycleSeconds ?? 0), 0, 0, {}, {
        formulaKey: 'combat.formula.repairRate',
        operands: [
          { key: 'amountHitPoints', value: amount },
          { key: 'cycleSeconds', value: module.activation?.cycleSeconds ?? 0 },
        ],
        unroundedResult: cycleRate(amount, module.activation?.cycleSeconds ?? 0),
        displayResult: Math.round(cycleRate(amount, module.activation?.cycleSeconds ?? 0) * 10) / 10,
      });
  }
  if (module.category === 'resistancePlating') {
    const values = Object.fromEntries(DAMAGE_TYPES.map((type) => [type, module.resistance.bonuses[type]]));
    return effect('resistance', module.resistance.layer, 0, 0, 0, 0, values, {
      formulaKey: 'combat.formula.resistanceModifier', operands: [], unroundedResult: 0, displayResult: 0,
    });
  }
  if (module.category === 'capacitorBattery') {
    const values = {
      capacityBonus: module.capacitorSupport.capacityBonus,
      rechargeBonusFraction: module.capacitorSupport.rechargeBonusFraction,
    };
    return effect('capacitorSupport', null, 0, 0,
      combatant.hull.capacitor.capacity,
      attributeValue(combatant.derived, 'capacitorCapacity'), values,
      attributeTrace(combatant.derived.attributes['capacitorCapacity']!));
  }
  throw new TypeError(`Unsupported projected module ${module.id}.`);
}

function effect(
  kind: ModuleEffectData['kind'],
  layer: string | null,
  amountPerCycle: number,
  sustainedPerSecond: number,
  baseValue: number,
  activeValue: number,
  values: Readonly<Record<string, number>>,
  trace: FormulaTraceData,
): ModuleEffectData {
  return { kind, layer, amountPerCycle, sustainedPerSecond, baseValue, activeValue, values, trace };
}

function cycleRate(amount: number, seconds: number): number {
  return seconds > 0 ? amount / seconds : 0;
}

function slotOf(fitted: FittedSlotDescription): string {
  return `${fitted.slot.kind}:${String(fitted.slot.index)}`;
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
    ammunitionNameKey: charge?.nameKey ?? null,
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
    ammunitionOptions: ammunitionOptions(rules, combatant, weapon),
    effects: locks.map((lock) => weaponEffect(rules, combatant, weapon, lock, listed)),
    commands: [
      availability('weapon.activate', activateRefusal(rules, weapon.slot, null)),
      availability('weapon.deactivate', deactivateRefusal(rules, weapon.slot)),
      availability('weapon.reload', reloadRefusal(rules, weapon.slot)),
      availability('weapon.changeAmmunition', changeAmmunitionRefusal(rules, weapon.slot, null)),
    ],
  };
}

/**
 * Every charge one weapon could fire: the loaded one and each accepted one in
 * the hold, with what it would do in this turret
 * (Functional Specification 9.4, 19.6).
 */
function ammunitionOptions(
  rules: CombatRuleInput,
  combatant: CombatantContext,
  weapon: WeaponContext,
): readonly AmmunitionOptionData[] {
  const ids = new Set<AmmunitionId>(compatibleCargoAmmunition(rules, combatant, weapon));
  if (weapon.ammunitionId !== null) ids.add(weapon.ammunitionId);
  const turret = weapon.module.turret;
  return [...ids].sort().flatMap((ammunitionId): AmmunitionOptionData[] => {
    const charge = rules.content.ammunition(ammunitionId);
    if (charge === undefined) return [];
    const listed = listedDamage(charge.damagePerShot, turret.damageMultiplier);
    return [{
      ammunitionId,
      nameKey: charge.nameKey,
      loaded: ammunitionId === weapon.ammunitionId,
      cargoRounds: cargoRounds(rules, combatant, ammunitionId),
      listedDamage: Object.fromEntries(DAMAGE_TYPES.map((type) => [type, listed[type]])),
      optimalRangeKm: turret.optimalRangeKm * charge.optimalRangeMultiplier,
      falloffKm: turret.falloffKm * charge.falloffMultiplier,
      trackingRadiansPerSecond: turret.trackingRadiansPerSecond * charge.trackingMultiplier,
      commands: [
        availability(
          'weapon.changeAmmunition',
          changeAmmunitionRefusal(rules, weapon.slot, ammunitionId),
        ),
      ],
    }];
  });
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
    limitingFactor: turretLimitingFactor(accuracy),
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

function attributeTrace(derived: {
  readonly attribute: string;
  readonly base: number;
  readonly value: number;
  readonly steps: readonly {
    readonly sourceId: string;
    readonly effectiveValue: number;
    readonly result: number;
  }[];
}): FormulaTraceData {
  return {
    formulaKey: `attribute.${derived.attribute}`,
    operands: [
      { key: 'base', value: derived.base },
      ...derived.steps.flatMap((step, index) => [
        { key: `modifier.${String(index)}.value`, value: step.effectiveValue },
        { key: `modifier.${String(index)}.result`, value: step.result },
      ]),
    ],
    unroundedResult: derived.value,
    displayResult: Math.round(derived.value * 10) / 10,
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
