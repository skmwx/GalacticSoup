import {
  distance,
  isDestroyed,
  maximumThatFits,
  objectiveComplete,
  requireStack,
  stacksIn,
  wreck as wreckOf,
  wreckAccessRefusal,
  wrecksInSite,
  type CampaignState,
  type EncounterCommandRefusal,
  type EncounterRuleInput,
  type WreckState,
} from '@engine/domain';
import { InventoryError } from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type {
  CommandAvailabilityData,
  EncounterData,
  EncounterInstanceData,
  EncounterNpcData,
  EncounterOutcomeData,
  StackData,
  WreckContentsData,
  WreckData,
} from '@protocol';
import { ruleViolationMessageKey } from '@protocol';
import { deepClone, deepFreeze } from '@shared';

import { itemDataOf } from './items';

/**
 * The encounter, opponent, wreck and loot views
 * (Functional Specification 9.10-9.11, 19.3; Technical Specification 7.3,
 * 12.3).
 *
 * The engine answers what the site holds, how far the objective has come and
 * whether a wreck is close enough to open, using the same predicate the take
 * command asks. The interface therefore never measures a range or decides an
 * availability of its own.
 *
 * @implements TECH-7.3, TECH-12.3, FUNC-9.10, FUNC-9.11, FUNC-19.3, MVP-AC-05, MVP-AC-06, MVP-AC-09
 */
export function encounterProjection(
  state: CampaignState,
  content: ContentRepository,
): EncounterData {
  const site = state.navigation.currentSite;
  const player = site?.objects[state.assets.activeShipId];
  const instance = state.encounter.active;

  return deepFreeze({
    revision: state.revision,
    simulationTimeMs: state.time.simulationTimeMs,
    instance: instance === null ? null : instanceData(state, content),
    wrecks:
      site === null || player === undefined
        ? []
        : wrecksInSite(state, site.siteId).map((entry) => wreckData(state, content, entry)),
    lastOutcome: outcomeData(state, content),
  });
}

function instanceData(state: CampaignState, content: ContentRepository): EncounterInstanceData | null {
  const instance = state.encounter.active;
  if (instance === null) return null;
  const definition = content.encounter(instance.encounterId);
  const site = state.navigation.currentSite;
  const player = site?.objects[state.assets.activeShipId];

  return {
    instanceId: instance.instanceId,
    encounterId: instance.encounterId,
    nameKey: definition?.nameKey ?? '',
    descriptionKey: definition?.descriptionKey ?? '',
    rewardSummaryKey: definition?.rewardSummaryKey ?? '',
    tier: definition?.tier ?? 0,
    siteId: instance.siteId,
    status: instance.status,
    startedAtMs: instance.startedAtMs,
    resolvedAtMs: instance.resolvedAtMs,
    objective: {
      kind: instance.objective.kind,
      destroyed: instance.objective.destroyed,
      required: instance.objective.required,
      complete: objectiveComplete(instance),
    },
    bountyCreditsPaid: instance.bountyCreditsPaid,
    npcs: instance.npcs
      .map((npc): EncounterNpcData => {
        const profile = content.npcProfile(npc.profileId);
        const object = site?.objects[npc.shipId];
        return {
          shipId: npc.shipId,
          profileId: npc.profileId,
          nameKey: profile?.nameKey ?? '',
          role: profile?.role ?? '',
          hullId: profile?.hullId ?? '',
          spawnOrdinal: npc.spawnOrdinal,
          bountyCredits: npc.bountyCredits,
          destroyed: npc.destroyedAtMs !== null || isDestroyed(state, npc.shipId),
          destroyedAtMs: npc.destroyedAtMs,
          rangeFromPlayerKm:
            object === undefined || player === undefined
              ? null
              : distance(player.position, object.position),
        };
      })
      .sort((a, b) => a.spawnOrdinal - b.spawnOrdinal),
  };
}

function wreckData(
  state: CampaignState,
  content: ContentRepository,
  entry: WreckState,
): WreckData {
  const rules: EncounterRuleInput = { state, content };
  const site = state.navigation.currentSite;
  const player = site?.objects[state.assets.activeShipId];
  return {
    wreckId: entry.id,
    nameKey: entry.nameKey,
    hullId: entry.hullId,
    position: { ...entry.position },
    rangeFromPlayerKm: player === undefined ? 0 : distance(player.position, entry.position),
    expiresAtMs: entry.expiresAtMs,
    remainingSeconds: Math.max(0, (entry.expiresAtMs - state.time.simulationTimeMs) / 1000),
    itemCount: stacksIn(state.assets, entry.inventoryId).length,
    commands: [availability('loot.take', wreckAccessRefusal(rules, entry.id))],
  };
}

function outcomeData(
  state: CampaignState,
  content: ContentRepository,
): EncounterOutcomeData | null {
  const outcome = state.encounter.lastOutcome;
  if (outcome === null) return null;
  return {
    encounterId: outcome.encounterId,
    nameKey: content.encounter(outcome.encounterId)?.nameKey ?? '',
    status: outcome.status,
    resolvedAtMs: outcome.resolvedAtMs,
    bountyCreditsPaid: outcome.bountyCreditsPaid,
    npcsDestroyed: outcome.npcsDestroyed,
    npcsTotal: outcome.npcsTotal,
  };
}

/**
 * The contents of one wreck (Functional Specification 9.11).
 *
 * Contents are published whatever the range, together with the reason the
 * player may not take them, so the interface can explain "too far" rather than
 * showing an empty container.
 */
export function wreckContentsProjection(
  state: CampaignState,
  content: ContentRepository,
  wreckId: string,
): WreckContentsData {
  const entry = wreckOf(state, wreckId);
  if (entry === null) throw new InventoryError('inventoryNotFound');

  const rules: EncounterRuleInput = { state, content };
  const refusal = wreckAccessRefusal(rules, wreckId);
  const site = state.navigation.currentSite;
  const player = site?.objects[state.assets.activeShipId];
  const ship = state.assets.ships[state.assets.activeShipId];
  const stacks = stacksIn(state.assets, entry.inventoryId);

  return deepFreeze({
    revision: state.revision,
    wreckId,
    accessible: refusal === null,
    unavailableReason: refusal === null ? null : ruleViolationMessageKey(refusal),
    rangeFromPlayerKm: player === undefined ? null : distance(player.position, entry.position),
    expiresAtMs: entry.expiresAtMs,
    remainingSeconds: Math.max(0, (entry.expiresAtMs - state.time.simulationTimeMs) / 1000),
    stacks: stacks.map((stack): StackData => ({
      id: stack.id,
      inventoryId: stack.inventoryId,
      quantity: stack.quantity,
      state: deepClone(stack.state),
      provenance: deepClone(stack.provenance),
      item: itemDataOf(content.requireTradeable(stack.definitionId), content),
    })),
    maximumQuantities: stacks.map((stack) => ({
      stackId: stack.id,
      maximumQuantity:
        ship === undefined || refusal !== null
          ? 0
          : Math.min(
              requireStack(state.assets, stack.id).quantity,
              maximumThatFits(state.assets, content, ship.cargoInventoryId, stack.definitionId),
            ),
    })),
  });
}

function availability(command: string, refusal: EncounterCommandRefusal): CommandAvailabilityData {
  return {
    command,
    available: refusal === null,
    unavailableReason: refusal === null ? null : ruleViolationMessageKey(refusal),
  };
}
