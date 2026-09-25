import {
  allocateEntityId,
  compareSlots,
  creditWallet,
  disablingEffects,
  drawChance,
  finalDamage,
  grantRecoveryShip,
  incomingDamage,
  insuranceSettlement,
  inventoryService,
  mutableEncounter,
  npcOf,
  PLAIN_STATE,
  recoveryGrantDue,
  replacementShipAt,
  shipCombat,
  stacksIn,
  starterReferenceValue,
  encounterChanged,
  type CampaignDraft,
  type EntityId,
  type ItemStack,
  type LossItemRecord,
  type LossRecord,
  type LossRecoveryOutcome,
  type MutableRandomStreams,
  type WreckState,
} from '@engine/domain';
import type { MessageKey } from '@shared';

import { clearCombat } from './combat';
import type { SimulationContext } from './context';
import { abandonEncounter, WRECK_EXPIRE_BOUNDARY } from './encounter';
import { cancelBoundariesOwnedBy, scheduleBoundary } from './scheduler';

/**
 * Player ship destruction (Functional Specification 9.12; Technical
 * Specification 9.2 step 6, 10.9).
 *
 * Destruction is one transaction. It materializes the wreck and rolls each
 * cargo stack and fitted module for survival, moves the pilot to the most
 * recently docked accessible station, settles and consumes the insurance,
 * freezes the loss report, checks recovery eligibility, grants the restricted
 * starter ship when it is owed and asks for an autosave. Nothing of it can be
 * half-applied: the transaction that advanced time commits all of it or none.
 *
 * It runs after combat has finalized destruction and after the encounter has
 * settled what the same completion batch did to the opponents, so a pilot who
 * destroys the last opponent in the instant they die still earns its bounty.
 *
 * @implements FUNC-9.12, FUNC-22.1, FUNC-22.3, FUNC-22.7, TECH-9.2, TECH-10.3, TECH-10.9, MVP-AC-08
 */

/** Loot and survival share one stream (Technical Specification 9.4). */
const SURVIVAL_STREAM = 'loot';
/** A wreck expires after the completions at the same instant. */
const EXPIRY_PRIORITY = 90;
/** How far back a loss outside any encounter looks for its causes. */
const LOSS_WINDOW_MS = 300_000;

export function advanceLoss(context: SimulationContext, _fromMs: number, _toMs: number): void {
  void _fromMs;
  void _toMs;
  const draft = context.draft;
  const shipId = draft.assets.activeShipId;
  if (shipId === null || draft.assets.location.kind !== 'site') return;
  if (shipCombat(draft, shipId).destroyedAtMs === null) return;
  resolvePlayerDestruction(context, shipId);
}

function resolvePlayerDestruction(context: SimulationContext, shipId: EntityId): void {
  const draft = context.draft;
  const content = context.content;
  const ship = draft.assets.ships[shipId];
  const site = draft.navigation.currentSite;
  const location = draft.assets.location;
  const object = site?.objects[shipId];
  if (ship === undefined || site === null || object === undefined || location.kind !== 'site') return;

  const hull = content.requireHull(ship.hullId);
  const now = draft.time.simulationTimeMs;
  const destroyedAtMs = shipCombat(draft, shipId).destroyedAtMs ?? now;
  const encounter = draft.encounter.active;
  const sinceMs = encounter?.startedAtMs ?? Math.max(0, destroyedAtMs - LOSS_WINDOW_MS);
  const nameOf = (sourceId: string): MessageKey => sourceName(context, sourceId);

  // What the report needs is read before anything it reads from moves.
  const incoming = incomingDamage(draft, shipId, sinceMs, nameOf);
  const lastBurst = finalDamage(draft, shipId, sinceMs, nameOf);
  const disabled = disablingEffects(draft, content, shipId);
  const lossId = allocateEntityId(draft);

  // The hull becomes a wreck; each module and cargo stack survives into it
  // independently, and loaded ammunition never does.
  const wreckId = allocateEntityId(draft);
  const service = inventoryService(draft, content);
  const wreckInventoryId = service.create({ kind: 'wreck', wreckId }, { kind: 'unlimited' });
  const chance = content.rules.combat.destructionItemSurvivalChance;
  const items: LossItemRecord[] = [];
  const settle = (stack: ItemStack, origin: LossItemRecord['origin']): void => {
    const survived = origin !== 'loaded' &&
      drawChance(draft.random as MutableRandomStreams, SURVIVAL_STREAM, chance).outcome === 1;
    if (survived) service.transferAs(stack.id, wreckInventoryId, stack.quantity, PLAIN_STATE);
    else service.remove(stack.id, stack.quantity);
    items.push({
      definitionId: stack.definitionId,
      quantity: stack.quantity,
      origin,
      survived,
      recoveryGrant: stack.recoveryGrant,
    });
  };
  for (const stack of fittedInSlotOrder(draft, ship.fittingInventoryId)) {
    settle(stack, stack.state.kind === 'fitted' ? 'fitted' : 'loaded');
  }
  const carried = carriedInventories(draft, shipId, ship.cargoInventoryId);
  for (const inventoryId of carried) {
    for (const stack of stacksIn(draft.assets, inventoryId)) settle(stack, 'cargo');
  }

  const lifetimeMs = Math.round(content.rules.combat.playerWreckLifetimeSeconds * 1000);
  const expiresAtMs = now + Math.max(1, lifetimeMs);
  const boundary = scheduleBoundary(draft, {
    kind: WRECK_EXPIRE_BOUNDARY,
    dueAtMs: expiresAtMs,
    priority: EXPIRY_PRIORITY,
    ownerId: wreckId,
  });
  const wreck: WreckState = {
    id: wreckId,
    owner: 'player',
    systemId: location.systemId,
    siteId: location.siteId,
    inventoryId: wreckInventoryId,
    hullId: hull.id,
    nameKey: hull.nameKey,
    position: { ...object.position },
    radiusKm: object.radiusKm,
    createdAtMs: now,
    expiresAtMs,
    boundaryEntryId: boundary.entryId,
  };
  mutableEncounter(draft).wrecks[wreckId] = wreck as never;
  encounterChanged(draft);

  // The opponents stay behind: hostile ships do not follow the pilot home
  // (Functional Specification 9.11).
  const encounterId = encounter?.encounterId ?? null;
  abandonEncounter(context, 'lost');

  // The ship, its stores and everything still scheduled for it leave the
  // campaign, and with it the site the pilot occupied.
  clearCombat(context, shipId);
  cancelBoundariesOwnedBy(draft, shipId);
  for (const inventoryId of [...carried, ship.fittingInventoryId]) {
    delete (draft.assets.inventories as Record<string, unknown>)[inventoryId];
  }
  delete (draft.assets.ships as Record<string, unknown>)[shipId];
  if (draft.fitting?.shipId === shipId) draft.fitting = null;
  draft.navigation.currentSite = null;
  draft.navigation.travel = null;
  draft.navigation.movementOrders = {};
  draft.navigation.version += 1;

  // The pilot is recovered at the most recently docked accessible station.
  const station = content.requireStation(draft.assets.lastDockedStationId);
  draft.assets.location = { kind: 'station', stationId: station.id, systemId: station.systemId };
  draft.assets.activeShipId = null;
  draft.assets.version += 1;

  // Insurance is paid at once, and enhanced cover is spent by this loss.
  const insurance = insuranceSettlement(ship, hull, content);
  creditWallet(draft, insurance.payoutCredits);

  // Recovery: a grant when one is owed, otherwise a ship already waiting
  // here, otherwise none - the pilot can afford the starter hull.
  let outcome: LossRecoveryOutcome;
  let activeShipId: EntityId | null;
  if (recoveryGrantDue(draft, content)) {
    activeShipId = grantRecoveryShip(draft, content, station.id);
    outcome = 'granted';
  } else {
    activeShipId = replacementShipAt(draft.assets, content, station.id)?.id ?? null;
    outcome = activeShipId === null ? 'noShip' : 'otherShip';
  }
  draft.assets.activeShipId = activeShipId;
  draft.assets.version += 1;

  const record: LossRecord = {
    lossId,
    shipId,
    hullId: hull.id,
    destroyedAtMs,
    systemId: location.systemId,
    siteId: location.siteId,
    encounterId,
    wreckId,
    wreckExpiresAtMs: expiresAtMs,
    recoveryStationId: station.id,
    incoming,
    finalDamage: lastBurst,
    disablingEffects: disabled,
    items,
    insurance: {
      coverage: insurance.coverage,
      hullReferenceValueCredits: insurance.hullReferenceValueCredits,
      payoutFraction: insurance.payoutFraction,
      payoutCredits: insurance.payoutCredits,
      enhancedConsumed: insurance.coverage === 'enhanced',
      recoveryGrantHull: insurance.recoveryGrantHull,
    },
    recovery: {
      outcome,
      activeShipId,
      creditsAfter: draft.assets.credits,
      starterReferenceValueCredits: starterReferenceValue(content),
    },
  };
  const recovery = draft.recovery as { version: number; losses: number; lastLoss: LossRecord | null };
  recovery.version += 1;
  recovery.losses += 1;
  recovery.lastLoss = record;

  context.publish('recovery.shipLost', {
    shipId,
    wreckId,
    siteId: location.siteId,
    survivors: items.filter((entry) => entry.survived).length,
    lost: items.filter((entry) => !entry.survived).length,
  });
  context.publish('recovery.insurancePaid', {
    coverage: insurance.coverage,
    credits: insurance.payoutCredits,
  });
  if (outcome === 'granted' && activeShipId !== null) {
    context.publish('recovery.shipGranted', { shipId: activeShipId, stationId: station.id });
  } else if (outcome === 'otherShip' && activeShipId !== null) {
    context.publish('recovery.activeShipChanged', { shipId: activeShipId });
  }

  for (const topic of [
    'assets', 'inventory', 'wallet', 'ship', 'fitting', 'station', 'market', 'repair', 'resupply',
    'insurance', 'navigation', 'site', 'destinations', 'combat', 'encounter', 'frame', 'loss',
  ] as const) {
    context.invalidate(topic);
  }
  // Resolving a destruction is a point the campaign must be durable at
  // (Functional Specification 3.4, 9.12).
  context.requestAutosave();
}

/** Fitted modules in slot order, each followed by its loaded charge. */
function fittedInSlotOrder(draft: CampaignDraft, fittingInventoryId: string): readonly ItemStack[] {
  return [...stacksIn(draft.assets, fittingInventoryId)].sort((a, b) => {
    const left = a.state.kind === 'plain' ? null : a.state.slot;
    const right = b.state.kind === 'plain' ? null : b.state.slot;
    if (left === null || right === null) return a.id.localeCompare(b.id);
    return compareSlots(left, right) || (a.state.kind === 'fitted' ? -1 : 1);
  });
}

/**
 * The hold and any reservation the ship still holds against it. A reserve is
 * part of the hold it was taken from, so its units share the hold's fate.
 */
function carriedInventories(draft: CampaignDraft, shipId: string, cargoInventoryId: string): readonly string[] {
  const reserves = Object.keys(draft.assets.inventories)
    .sort()
    .filter((id) => {
      const inventory = draft.assets.inventories[id];
      return inventory?.location.kind === 'reserve' && inventory.location.ownerId === shipId;
    });
  return [cargoInventoryId, ...reserves];
}

/** The name the pilot met an attacker by. */
function sourceName(context: SimulationContext, sourceId: string): MessageKey {
  const draft = context.draft;
  const npc = npcOf(draft, sourceId);
  if (npc !== null) {
    const profile = context.content.npcProfile(npc.profileId);
    if (profile !== undefined) return profile.nameKey;
  }
  const ship = draft.assets.ships[sourceId];
  const hull = ship === undefined ? undefined : context.content.hull(ship.hullId);
  return (hull?.nameKey ?? 'loss.source.unknown') as MessageKey;
}
