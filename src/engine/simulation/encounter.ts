import {
  activeModuleState,
  drawUnitInterval,
  addSiteObject,
  allocateEntityId,
  attributeValue,
  bountyGrantId,
  combatantOf,
  completionGrantId,
  creditWallet,
  deriveShipAttributes,
  distance,
  encounterChanged,
  hasCompletedLock,
  inventoryService,
  isGranted,
  lockOn,
  mutableEncounter,
  objectiveComplete,
  removeSiteObject,
  rollLoot,
  selectNpcIntent,
  shipCombat,
  shipFit,
  slotKey,
  stacksIn,
  syncShipDerived,
  weaponState,
  type CampaignDraft,
  type EncounterInstanceState,
  type EncounterNpcState,
  type EntityId,
  type MovementOrder,
  type MutableRandomStreams,
  type NpcSituation,
  type SchedulerEntry,
  type SlotRef,
  type WreckState,
} from '@engine/domain';
import type { ContentRepository, HullDefinition, NpcProfileDefinition } from '@engine/ports';
import type { AmmunitionId, DefinitionId, ModuleId, SiteId } from '@shared';

import {
  activateModule,
  activateWeapon,
  beginLock,
  clearCombat,
  deactivateModule,
} from './combat';
import { orderMovement } from './orders';
import type { SimulationContext } from './context';
import { cancelBoundariesOwnedBy, cancelBoundary, scheduleBoundary } from './scheduler';

/**
 * The encounter lifecycle, its opponents and its rewards
 * (Functional Specification 5.4, 9.10-9.11; Technical Specification 9.2, 10.3,
 * 10.6).
 *
 * Arriving at an authored combat site instantiates the encounter; leaving it
 * abandons it; destroying everything it spawned completes it. Each outcome is
 * one transaction, so credits, wrecks, ships and objective state can never be
 * partially committed.
 *
 * The opponents are not a separate combat path. Each one is an ordinary ship
 * with an ordinary fit, and the adapter below turns its intent into exactly
 * the movement, targeting and module operations the player commands with. An
 * opponent therefore cannot out-range, out-track or out-tank the rules
 * (Technical Specification 10.3).
 *
 * @implements FUNC-5.4, FUNC-9.10, FUNC-9.11, FUNC-18, FUNC-22.7, TECH-9.2, TECH-10.3, TECH-10.6, MVP-AC-05, MVP-AC-06, MVP-AC-09
 */

export const NPC_DECISION_BOUNDARY = 'encounter.npcDecision';
export const WRECK_EXPIRE_BOUNDARY = 'encounter.wreckExpire';

/** Opponents decide after movement and before the cycles they may start. */
const DECISION_PRIORITY = 20;
const EXPIRY_PRIORITY = 90;

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Instantiates the encounter authored at the site the player just entered.
 *
 * A fresh instance is created on every arrival, so a completed or abandoned
 * site can always be attempted again and the loop cannot be exhausted
 * (MVP Scope 4.2; Functional Specification 18).
 */
export function instantiateEncounter(context: SimulationContext, siteId: SiteId): boolean {
  const draft = context.draft;
  const site = draft.navigation.currentSite;
  if (site === null || site.siteId !== siteId) return false;

  const definition = context.content
    .encounters()
    .find((candidate) => candidate.siteId === siteId && candidate.systemId === site.systemId);
  if (definition === undefined) return false;

  const instanceId = allocateEntityId(draft);
  // One angular offset per instance, so two visits to the same site do not
  // present an identical formation (Technical Specification 9.4).
  const offset = drawUnitInterval(streams(context), 'encounter').outcome * Math.PI * 2;
  const total = definition.spawns.reduce((sum, spawn) => sum + spawn.count, 0);

  const npcs: EncounterNpcState[] = [];
  let ordinal = 0;
  for (const spawn of definition.spawns) {
    const profile = context.content.requireNpcProfile(spawn.npcProfileId);
    for (let index = 0; index < spawn.count; index += 1) {
      const angle = offset + (Math.PI * 2 * ordinal) / Math.max(1, total);
      const shipId = createNpcShip(context, profile, {
        x: Math.cos(angle) * spawn.spawnDistanceKm,
        y: Math.sin(angle) * spawn.spawnDistanceKm,
      }, angle + Math.PI);
      npcs.push({
        shipId,
        profileId: profile.id,
        spawnOrdinal: ordinal,
        bountyCredits: profile.bountyCredits,
        lootTableId: profile.lootTableId,
        destroyedAtMs: null,
        decisionBoundaryEntryId: null,
      });
      ordinal += 1;
    }
  }

  const instance: EncounterInstanceState = {
    instanceId,
    encounterId: definition.id,
    systemId: definition.systemId,
    siteId: definition.siteId,
    status: 'active',
    startedAtMs: draft.time.simulationTimeMs,
    resolvedAtMs: null,
    npcs,
    objective: { kind: 'destroyGroup', destroyed: 0, required: npcs.length },
    grantedRewardIds: [],
    bountyCreditsPaid: 0,
  };
  mutableEncounter(draft).active = instance as never;
  for (const npc of npcs) scheduleDecision(context, npc.shipId, 0);

  encounterChanged(draft);
  context.publish('encounter.started', {
    encounterId: definition.id,
    siteId: definition.siteId,
    opponents: npcs.length,
  });
  invalidate(context);
  return true;
}

/**
 * Ends the instance the player is leaving behind
 * (Functional Specification 9.11).
 *
 * Retreat is a legal outcome, so an unfinished instance is abandoned rather
 * than failed, and its opponents leave with it: hostile ships do not follow
 * through warp. Wrecks are deliberately not removed - they are the site's, not
 * the instance's, and Functional Specification 5.4 gives them their own life.
 */
export function abandonEncounter(context: SimulationContext): void {
  const draft = context.draft;
  const active = draft.encounter.active;
  if (active === null) return;

  for (const npc of active.npcs) {
    if (npc.destroyedAtMs === null) despawnNpc(context, npc.shipId);
  }

  const resolved = active.status === 'active' ? 'abandoned' : active.status;
  const encounter = mutableEncounter(draft);
  encounter.lastOutcome = {
    encounterId: active.encounterId,
    status: resolved === 'completed' ? 'completed' : 'abandoned',
    resolvedAtMs: active.resolvedAtMs ?? draft.time.simulationTimeMs,
    bountyCreditsPaid: active.bountyCreditsPaid,
    npcsDestroyed: active.objective.destroyed,
    npcsTotal: active.objective.required,
  };
  encounter.active = null;
  encounterChanged(draft);
  if (resolved === 'abandoned') {
    context.publish('encounter.abandoned', {
      encounterId: active.encounterId,
      destroyed: active.objective.destroyed,
      required: active.objective.required,
    });
  }
  invalidate(context);
}

/**
 * Settles what the last completion batch produced
 * (Technical Specification 9.2, steps 6 and 9).
 *
 * It runs after combat has finalized destruction, so an opponent that died in
 * the same instant as it fired still contributed its shot before it became a
 * wreck.
 */
export function advanceEncounter(context: SimulationContext, _fromMs: number, _toMs: number): void {
  void _fromMs;
  void _toMs;
  const draft = context.draft;
  const active = draft.encounter.active;
  if (active === null || active.status !== 'active') return;

  for (const npc of active.npcs) {
    if (npc.destroyedAtMs !== null) continue;
    if (shipCombat(draft, npc.shipId).destroyedAtMs === null) continue;
    resolveDestroyedNpc(context, npc.shipId);
  }

  const current = draft.encounter.active;
  if (current !== null && current.status === 'active' && objectiveComplete(current)) {
    completeEncounter(context);
  }
}

/** Marks the objective met, records the completion and asks for a snapshot. */
function completeEncounter(context: SimulationContext): void {
  const draft = context.draft;
  const active = draft.encounter.active;
  if (active === null || active.status !== 'active') return;

  const grantId = completionGrantId(active.instanceId);
  if (isGranted(active, grantId)) return;

  const encounter = mutableEncounter(draft);
  const instance = encounter.active;
  if (instance === null) return;
  instance.status = 'completed';
  instance.resolvedAtMs = draft.time.simulationTimeMs;
  instance.grantedRewardIds = [...instance.grantedRewardIds, grantId];
  encounter.completions[active.encounterId] = (encounter.completions[active.encounterId] ?? 0) + 1;
  encounter.lastOutcome = {
    encounterId: active.encounterId,
    status: 'completed',
    resolvedAtMs: draft.time.simulationTimeMs,
    bountyCreditsPaid: instance.bountyCreditsPaid,
    npcsDestroyed: instance.objective.destroyed,
    npcsTotal: instance.objective.required,
  };
  encounterChanged(draft);
  context.publish('encounter.completed', {
    encounterId: active.encounterId,
    bountyCreditsPaid: instance.bountyCreditsPaid,
    completions: encounter.completions[active.encounterId] ?? 1,
  });
  invalidate(context);
  // A completed site is a point the campaign must be durable at
  // (Functional Specification 3.4).
  context.requestAutosave();
}

/* -------------------------------------------------------------------------- */
/* Rewards and wrecks                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Pays one opponent's bounty, leaves its wreck and removes its ship
 * (Functional Specification 9.11).
 *
 * The bounty is settled against a grant id, so a replayed completion at the
 * same timestamp cannot pay it twice (Technical Specification 10.6).
 */
function resolveDestroyedNpc(context: SimulationContext, shipId: string): void {
  const draft = context.draft;
  const encounter = mutableEncounter(draft);
  const instance = encounter.active;
  if (instance === null) return;
  const npc = instance.npcs.find((candidate) => candidate.shipId === shipId);
  if (npc === undefined || npc.destroyedAtMs !== null) return;

  const grantId = bountyGrantId(shipId);
  const wreck = createWreck(context, shipId, npc.lootTableId);

  if (!isGranted(instance, grantId) && npc.bountyCredits > 0) {
    creditWallet(draft, npc.bountyCredits);
    instance.bountyCreditsPaid += npc.bountyCredits;
    instance.grantedRewardIds = [...instance.grantedRewardIds, grantId];
    context.publish('encounter.bountyPaid', {
      encounterId: instance.encounterId,
      profileId: npc.profileId,
      credits: npc.bountyCredits,
    });
    context.invalidate('wallet');
    context.invalidate('assets');
  }

  const mutableNpc = instance.npcs.find((candidate) => candidate.shipId === shipId);
  if (mutableNpc !== undefined) {
    (mutableNpc as { destroyedAtMs: number | null }).destroyedAtMs = draft.time.simulationTimeMs;
  }
  instance.objective.destroyed += 1;
  despawnNpc(context, shipId);

  encounterChanged(draft);
  context.publish('encounter.opponentDestroyed', {
    encounterId: instance.encounterId,
    profileId: npc.profileId,
    ...(wreck === null ? {} : { wreckId: wreck.id }),
    remaining: instance.objective.required - instance.objective.destroyed,
  });
  invalidate(context);
}

/**
 * Turns a destroyed ship into a wreck holding its rolled loot
 * (Functional Specification 5.4, 9.11).
 *
 * The wreck outlives the encounter instance and expires on its own scheduled
 * boundary, so it survives the player warping out and back.
 */
function createWreck(
  context: SimulationContext,
  shipId: string,
  lootTableId: DefinitionId,
): WreckState | null {
  const draft = context.draft;
  const site = draft.navigation.currentSite;
  const ship = draft.assets.ships[shipId];
  const object = site?.objects[shipId];
  if (site === null || ship === undefined || object === undefined) return null;

  const hull = context.content.requireHull(ship.hullId);
  const wreckId = allocateEntityId(draft);
  const service = inventoryService(draft, context.content);
  const inventoryId = service.create({ kind: 'wreck', wreckId }, { kind: 'unlimited' });

  const table = context.content.lootTable(lootTableId);
  if (table !== undefined) {
    for (const entry of rollLoot(table, streams(context))) {
      service.add(inventoryId, entry.definitionId as DefinitionId, entry.quantity, {
        grantedQuantity: entry.quantity,
        purchasedQuantity: 0,
        purchaseCostCredits: 0,
      });
    }
  }

  const lifetimeMs = Math.round(context.content.rules.combat.npcWreckLifetimeSeconds * 1000);
  const expiresAtMs = draft.time.simulationTimeMs + Math.max(1, lifetimeMs);
  const boundary = scheduleBoundary(draft, {
    kind: WRECK_EXPIRE_BOUNDARY,
    dueAtMs: expiresAtMs,
    priority: EXPIRY_PRIORITY,
    ownerId: wreckId,
  });

  const wreck: WreckState = {
    id: wreckId,
    systemId: site.systemId,
    siteId: site.siteId,
    inventoryId,
    hullId: hull.id,
    nameKey: hull.nameKey,
    position: { ...object.position },
    radiusKm: object.radiusKm,
    createdAtMs: draft.time.simulationTimeMs,
    expiresAtMs,
    boundaryEntryId: boundary.entryId,
  };
  mutableEncounter(draft).wrecks[wreckId] = wreck as never;
  addSiteObject(draft, wreckWorldObject(wreck));
  context.publish('encounter.wreckCreated', { wreckId, hullId: hull.id, expiresAtMs });
  return wreck;
}

/** The site object a wreck is present as. */
function wreckWorldObject(wreck: WreckState) {
  return {
    id: wreck.id,
    kind: 'wreck' as const,
    definitionId: wreck.hullId as string,
    nameKey: wreck.nameKey as string,
    position: { ...wreck.position },
    velocity: { x: 0, y: 0 },
    facingRadians: 0,
    radiusKm: wreck.radiusKm,
    movable: false,
  };
}

/**
 * Puts the wrecks of a site back into its object table when it loads
 * (Technical Specification 10.1).
 */
export function materializeWrecks(context: SimulationContext): void {
  const draft = context.draft;
  const site = draft.navigation.currentSite;
  if (site === null) return;
  for (const id of Object.keys(draft.encounter.wrecks).sort()) {
    const wreck = draft.encounter.wrecks[id];
    if (wreck === undefined || wreck.siteId !== site.siteId) continue;
    addSiteObject(draft, wreckWorldObject(wreck));
  }
}

/**
 * Discards an expired wreck and everything still in it
 * (Functional Specification 5.4, 9.11).
 */
export function resolveWreckExpiry(context: SimulationContext, entry: SchedulerEntry): void {
  const draft = context.draft;
  const wreck = Object.values(draft.encounter.wrecks).find(
    (candidate) => candidate.boundaryEntryId === entry.entryId,
  );
  if (wreck === undefined) return;
  removeWreck(context, wreck.id, false);
  context.publish('encounter.wreckExpired', { wreckId: wreck.id });
}

/** Removes a wreck, its store and its contents. */
function removeWreck(context: SimulationContext, wreckId: string, cancelBoundaryEntry: boolean): void {
  const draft = context.draft;
  const wreck = draft.encounter.wrecks[wreckId];
  if (wreck === undefined) return;
  if (cancelBoundaryEntry) cancelBoundary(draft, wreck.boundaryEntryId);

  for (const stack of stacksIn(draft.assets, wreck.inventoryId)) {
    delete (draft.assets.stacks as Record<string, unknown>)[stack.id];
  }
  delete (draft.assets.inventories as Record<string, unknown>)[wreck.inventoryId];
  draft.assets.version += 1;
  delete (mutableEncounter(draft).wrecks as Record<string, unknown>)[wreckId];
  removeSiteObject(draft, wreckId);
  encounterChanged(draft);
  invalidate(context);
  context.invalidate('inventory');
  context.invalidate('assets');
}

/**
 * Moves loot out of a wreck and into the active ship's hold
 * (Functional Specification 9.11, 22.2).
 *
 * The move is the ordinary inventory one, so capacity is checked before
 * anything leaves the wreck and a hold that is too small keeps the goods where
 * they are rather than destroying them.
 */
export function takeLoot(
  context: SimulationContext,
  wreckId: string,
  stackId: string,
  quantity: number,
): boolean {
  const draft = context.draft;
  const wreck = draft.encounter.wrecks[wreckId];
  const ship = draft.assets.ships[draft.assets.activeShipId];
  if (wreck === undefined || ship === undefined) return false;
  const stack = draft.assets.stacks[stackId];
  if (stack === undefined || stack.inventoryId !== wreck.inventoryId) return false;

  const definitionId = stack.definitionId;
  inventoryService(draft, context.content).transfer(stackId, ship.cargoInventoryId, quantity);
  encounterChanged(draft);
  context.publish('encounter.lootTaken', { wreckId, definitionId, quantity });
  context.invalidate('inventory');
  context.invalidate('assets');
  context.invalidate('ship');
  invalidate(context);
  return true;
}

/* -------------------------------------------------------------------------- */
/* The opponent command adapter                                                */
/* -------------------------------------------------------------------------- */

/**
 * One opponent reconsiders its orders (Technical Specification 10.3).
 *
 * The adapter reads only what the opponent is defined to know, asks the pure
 * behaviour selector what it wants, and then issues the ordinary commands. It
 * never writes ship state itself.
 */
export function resolveNpcDecision(context: SimulationContext, entry: SchedulerEntry): void {
  const draft = context.draft;
  const shipId = entry.ownerId;
  const instance = draft.encounter.active;
  if (shipId === null || instance === null || instance.status !== 'active') return;
  const npc = instance.npcs.find((candidate) => candidate.shipId === shipId);
  if (npc === undefined || npc.destroyedAtMs !== null) return;

  clearDecision(draft, shipId);
  if (shipCombat(draft, shipId).destroyedAtMs !== null) return;

  const situation = readSituation(context, shipId);
  if (situation !== null) {
    const intent = selectNpcIntent(situation, context.content.rules.combat);
    apply(context, shipId, intent.movement, intent);
  }
  scheduleDecision(context, shipId, decisionIntervalMs(context));
}

/** What the opponent knows about itself and its target right now. */
function readSituation(context: SimulationContext, shipId: string): NpcSituation | null {
  const draft = context.draft;
  const combatant = combatantOf(draft, context.content, shipId);
  const targetId = draft.assets.activeShipId;
  const target = draft.navigation.currentSite?.objects[targetId];
  if (combatant === null || target === undefined) return null;
  // A destroyed player is no longer a target (Functional Specification 22.5).
  if (shipCombat(draft, targetId).destroyedAtMs !== null) return null;

  let bestOptimalRangeKm: number | null = null;
  let hasPropulsion = false;
  let repairLayerFraction: number | null = null;
  for (const fitted of combatant.fit) {
    const module = context.content.module(fitted.moduleId);
    if (module === undefined || !fitted.online) continue;
    if (module.category === 'turret') {
      const ammunition =
        fitted.charge === null ? undefined : context.content.ammunition(fitted.charge.ammunitionId);
      const optimal = module.turret.optimalRangeKm * (ammunition?.optimalRangeMultiplier ?? 1);
      bestOptimalRangeKm = Math.max(bestOptimalRangeKm ?? 0, optimal);
    }
    if (module.category === 'propulsion') hasPropulsion = true;
    if (module.category === 'armorRepairer' || module.category === 'shieldBooster') {
      const layer = module.repair.layer;
      const maximum = attributeValue(combatant.derived, `${layer}HitPoints`);
      repairLayerFraction =
        maximum <= 0 ? 0 : Math.max(0, (maximum - combatant.ship.condition.damage[layer]) / maximum);
    }
  }

  return {
    role: context.content.requireNpcProfile(npcProfileOf(draft, shipId)).role,
    targetId,
    rangeKm: distance(combatant.object.position, target.position),
    maxLockRangeKm: attributeValue(combatant.derived, 'maxLockRangeKm'),
    bestOptimalRangeKm,
    hasLock: hasCompletedLock(combatant.combat, targetId),
    repairLayerFraction,
    hasPropulsion,
  };
}

/** Issues the intent as the ordinary commands a player would use. */
function apply(
  context: SimulationContext,
  shipId: string,
  movement: MovementOrder,
  intent: { readonly lock: boolean; readonly fire: boolean; readonly propulsion: boolean; readonly repair: boolean },
): void {
  const draft = context.draft;
  orderMovement(context, shipId, movement);

  const targetId = draft.assets.activeShipId;
  if (intent.lock && lockOn(shipCombat(draft, shipId), targetId) === null) {
    beginLock(context, shipId, targetId);
  }

  for (const fitted of shipFit(draft.assets, shipId)) {
    const module = context.content.module(fitted.moduleId);
    if (module === undefined || !fitted.online) continue;
    const key = slotKey(fitted.slot);
    const slot: SlotRef = fitted.slot;

    if (module.category === 'turret') {
      const weapon = weaponState(shipCombat(draft, shipId), key);
      if (intent.fire && !weapon.repeating) activateWeapon(context, shipId, slot, targetId);
      continue;
    }
    if (module.category === 'propulsion') {
      operate(context, shipId, slot, key, intent.propulsion);
      continue;
    }
    if (module.category === 'armorRepairer' || module.category === 'shieldBooster') {
      operate(context, shipId, slot, key, intent.repair);
    }
  }
}

function operate(
  context: SimulationContext,
  shipId: string,
  slot: SlotRef,
  key: string,
  wanted: boolean,
): void {
  const running = activeModuleState(shipCombat(context.draft, shipId), key).repeating;
  if (wanted && !running) activateModule(context, shipId, slot);
  if (!wanted && running) deactivateModule(context, shipId, slot);
}

function decisionIntervalMs(context: SimulationContext): number {
  return Math.max(
    context.content.rules.time.simulationQuantumMs,
    Math.round(context.content.rules.combat.npcDecisionIntervalSeconds * 1000),
  );
}

function scheduleDecision(context: SimulationContext, shipId: string, delayMs: number): void {
  const draft = context.draft;
  const instance = mutableEncounter(draft).active;
  if (instance === null) return;
  const npc = instance.npcs.find((candidate) => candidate.shipId === shipId);
  if (npc === undefined || npc.destroyedAtMs !== null) return;

  const boundary = scheduleBoundary(draft, {
    kind: NPC_DECISION_BOUNDARY,
    dueAtMs: draft.time.simulationTimeMs + Math.max(0, delayMs),
    priority: DECISION_PRIORITY,
    ownerId: shipId as EntityId,
  });
  (npc as { decisionBoundaryEntryId: EntityId | null }).decisionBoundaryEntryId = boundary.entryId;
}

function clearDecision(draft: CampaignDraft, shipId: string): void {
  const instance = mutableEncounter(draft).active;
  const npc = instance?.npcs.find((candidate) => candidate.shipId === shipId);
  if (npc === undefined) return;
  (npc as { decisionBoundaryEntryId: EntityId | null }).decisionBoundaryEntryId = null;
}

/* -------------------------------------------------------------------------- */
/* Spawning and despawning                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Creates one opponent ship with its authored fit.
 *
 * Its equipment is granted rather than bought, exactly as the player's
 * starting fit is, and it is assembled through the inventory service so the
 * modules and charges are real physical units in a real fitting store.
 */
function createNpcShip(
  context: SimulationContext,
  profile: NpcProfileDefinition,
  position: { readonly x: number; readonly y: number },
  facingRadians: number,
): EntityId {
  const draft = context.draft;
  const site = draft.navigation.currentSite;
  if (site === null) throw new TypeError('An opponent needs a loaded site.');
  const hull = context.content.requireHull(profile.hullId);

  const shipId = allocateEntityId(draft);
  const service = inventoryService(draft, context.content);
  const cargo = service.create(
    { kind: 'cargo', shipId },
    { kind: 'limited', volumeCubicDecimetres: hull.cargoCapacityCubicDecimetres },
  );
  const fitting = service.create({ kind: 'fitting', shipId }, { kind: 'unlimited' });
  const location = { kind: 'site' as const, systemId: site.systemId, siteId: site.siteId };

  draft.assets.ships[shipId] = {
    id: shipId,
    owner: 'npc',
    hullId: hull.id,
    cargoInventoryId: cargo,
    fittingInventoryId: fitting,
    location,
    condition: { damage: { shield: 0, armor: 0, hull: 0 }, capacitorCharge: 0 },
    insurance: { coverage: 'basic', premiumPaidCredits: 0 },
  };

  for (const entry of planNpcFit(context.content, hull, profile)) {
    service.addAs(fitting, entry.moduleId as DefinitionId, 1, granted(1), {
      kind: 'fitted',
      slot: entry.slot,
      online: true,
    });
    if (entry.ammunitionId !== null && entry.magazineSize > 0) {
      service.addAs(
        fitting,
        entry.ammunitionId as DefinitionId,
        entry.magazineSize,
        granted(entry.magazineSize),
        { kind: 'charge', slot: entry.slot },
      );
    }
  }

  syncShipDerived(draft, context.content, shipId);
  const ship = draft.assets.ships[shipId];
  if (ship !== undefined) {
    const derived = deriveShipAttributes({
      hull,
      fit: shipFit(draft.assets, shipId),
      content: context.content,
    });
    draft.assets.ships[shipId] = {
      ...ship,
      condition: {
        ...ship.condition,
        capacitorCharge: attributeValue(derived, 'capacitorCapacity'),
      },
    };
  }
  draft.assets.version += 1;

  addSiteObject(draft, {
    id: shipId,
    kind: 'ship',
    definitionId: hull.id,
    nameKey: hull.nameKey,
    position: { ...position },
    velocity: { x: 0, y: 0 },
    facingRadians,
    radiusKm: hull.signatureRadiusMetres / 2000,
    movable: true,
  });
  return shipId;
}

interface PlannedNpcSlot {
  readonly slot: SlotRef;
  readonly moduleId: ModuleId;
  readonly ammunitionId: AmmunitionId | null;
  readonly magazineSize: number;
}

/**
 * Assigns an authored loadout to slots.
 *
 * A turret takes the next weapon slot and every other module takes the next
 * slot of the kind it declares, so an authored loadout never has to name slot
 * indices that a hull change would invalidate. Content validation has already
 * proved the loadout fits the hull.
 */
export function planNpcFit(
  content: ContentRepository,
  hull: HullDefinition,
  profile: NpcProfileDefinition,
): readonly PlannedNpcSlot[] {
  const next: Record<string, number> = {};
  const planned: PlannedNpcSlot[] = [];
  for (const moduleId of profile.loadout.modules) {
    const module = content.module(moduleId);
    if (module === undefined) continue;
    const index = next[module.slot] ?? 0;
    next[module.slot] = index + 1;
    if (index >= (hull.slots[module.slot] ?? 0)) continue;
    const slot: SlotRef = { kind: module.slot, index };
    const ammunitionId = profile.loadout.ammunitionId ?? null;
    const magazineSize = module.category === 'turret' ? module.turret.magazineSize : 0;
    planned.push({
      slot,
      moduleId,
      ammunitionId: module.category === 'turret' ? ammunitionId : null,
      magazineSize,
    });
  }
  return planned;
}

/** Removes an opponent's ship, stores and pending work from the campaign. */
function despawnNpc(context: SimulationContext, shipId: string): void {
  const draft = context.draft;
  clearCombat(context, shipId);
  clearDecision(draft, shipId);
  cancelBoundariesOwnedBy(draft, shipId as EntityId);

  const ship = draft.assets.ships[shipId];
  if (ship !== undefined) {
    for (const inventoryId of [ship.cargoInventoryId, ship.fittingInventoryId]) {
      for (const stack of stacksIn(draft.assets, inventoryId)) {
        delete (draft.assets.stacks as Record<string, unknown>)[stack.id];
      }
      delete (draft.assets.inventories as Record<string, unknown>)[inventoryId];
    }
    delete (draft.assets.ships as Record<string, unknown>)[shipId];
    draft.assets.version += 1;
  }

  // Its own standing order goes with it, and every order still aimed at it
  // stops safely (Functional Specification 22.5).
  orderMovement(context, shipId, null);
  for (const otherId of Object.keys(draft.assets.ships).sort()) {
    const order = draft.navigation.movementOrders[otherId];
    if (order !== undefined && 'targetId' in order && order.targetId === shipId) {
      orderMovement(context, otherId, { kind: 'stop' });
    }
  }
  removeSiteObject(draft, shipId);
  context.invalidate('assets');
  context.invalidate('inventory');
  context.invalidate('site');
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function npcProfileOf(draft: CampaignDraft, shipId: string) {
  const npc = draft.encounter.active?.npcs.find((candidate) => candidate.shipId === shipId);
  if (npc === undefined) throw new TypeError(`Ship "${shipId}" is not an opponent.`);
  return npc.profileId;
}

function granted(quantity: number) {
  return { grantedQuantity: quantity, purchasedQuantity: 0, purchaseCostCredits: 0 };
}

function streams(context: SimulationContext): MutableRandomStreams {
  return context.draft.random as MutableRandomStreams;
}

function invalidate(context: SimulationContext): void {
  context.invalidate('encounter');
  context.invalidate('site');
  context.invalidate('destinations');
  context.invalidate('frame');
}
