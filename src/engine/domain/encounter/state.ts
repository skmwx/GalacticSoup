import type { Mutable } from '@shared';

import type { CampaignDraft, CampaignState } from '../campaign/state';

import type {
  EncounterInstanceState,
  EncounterNpcState,
  EncounterOutcomeRecord,
  EncounterState,
  WreckState,
} from './types';

/**
 * Reading and changing encounter runtime (Technical Specification 8.2, 10.6).
 *
 * Every accessor here is total: a campaign that has never undocked holds no
 * instance and no wreck, and asking for either answers emptily rather than
 * throwing. Mutation goes through this module so the version that projections
 * bind to always moves with the state it describes.
 *
 * @implements TECH-8.2, TECH-10.6, FUNC-9.11
 */

export type MutableEncounterState = Mutable<EncounterState> & {
  active: Mutable<EncounterInstanceState> | null;
  wrecks: Record<string, Mutable<WreckState>>;
  completions: Record<string, number>;
  lastOutcome: EncounterOutcomeRecord | null;
};

export function mutableEncounter(draft: CampaignDraft): MutableEncounterState {
  return draft.encounter as unknown as MutableEncounterState;
}

/** The instance the player is inside, or `null`. */
export function activeEncounter(state: CampaignState): EncounterInstanceState | null {
  return state.encounter.active;
}

/** The instance that is still being fought, or `null` once it has resolved. */
export function runningEncounter(state: CampaignState): EncounterInstanceState | null {
  const active = state.encounter.active;
  return active !== null && active.status === 'active' ? active : null;
}

export function npcOf(state: CampaignState, shipId: string): EncounterNpcState | null {
  return state.encounter.active?.npcs.find((npc) => npc.shipId === shipId) ?? null;
}

/** Whether a ship belongs to the running encounter rather than to the player. */
export function isEncounterShip(state: CampaignState, shipId: string): boolean {
  return npcOf(state, shipId) !== null;
}

/** Opponents that have not yet been destroyed, in spawn order. */
export function survivingNpcs(instance: EncounterInstanceState): readonly EncounterNpcState[] {
  return instance.npcs.filter((npc) => npc.destroyedAtMs === null);
}

export function objectiveComplete(instance: EncounterInstanceState): boolean {
  return instance.objective.destroyed >= instance.objective.required;
}

export function wreck(state: CampaignState, wreckId: string): WreckState | null {
  return state.encounter.wrecks[wreckId] ?? null;
}

/** Wrecks present in one site, oldest first, then by id. */
export function wrecksInSite(state: CampaignState, siteId: string): readonly WreckState[] {
  return Object.keys(state.encounter.wrecks)
    .sort()
    .map((id) => state.encounter.wrecks[id]!)
    .filter((entry) => entry.siteId === siteId)
    .sort((a, b) =>
      a.createdAtMs !== b.createdAtMs ? a.createdAtMs - b.createdAtMs : a.id.localeCompare(b.id),
    );
}

export function completionCount(state: CampaignState, encounterId: string): number {
  return state.encounter.completions[encounterId] ?? 0;
}

/** Whether one reward has already been settled (Technical Specification 10.6). */
export function isGranted(instance: EncounterInstanceState, grantId: string): boolean {
  return instance.grantedRewardIds.includes(grantId);
}

/** The grant id of one opponent's bounty. */
export function bountyGrantId(shipId: string): string {
  return `bounty.${shipId}`;
}

/** The grant id of an instance's completion reward. */
export function completionGrantId(instanceId: string): string {
  return `completion.${instanceId}`;
}

export function encounterChanged(draft: CampaignDraft): void {
  draft.encounter.version += 1;
}
