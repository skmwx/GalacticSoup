import type { StackData } from './assets';
import type { CommandAvailabilityData, VectorData } from './navigation';

/**
 * The encounter, opponent, wreck and loot views
 * (Functional Specification 9.10-9.11, 19.3).
 *
 * The engine decides everything here: which opponents an authored site
 * spawned, how far the objective has come, what a wreck holds and whether the
 * player is close enough to take it. The interface renders the answer and asks
 * for nothing it could work out for itself.
 */

/** Payload of the wreck query and the take command. */
export interface WreckPayload {
  readonly wreckId: string;
}

export interface TakeLootPayload extends WreckPayload {
  readonly stackId: string;
  readonly quantity: number;
}

export interface EncounterNpcData {
  readonly shipId: string;
  readonly profileId: string;
  readonly nameKey: string;
  readonly role: string;
  readonly hullId: string;
  readonly spawnOrdinal: number;
  readonly bountyCredits: number;
  readonly destroyed: boolean;
  readonly destroyedAtMs: number | null;
  /** `null` once the opponent has been destroyed and its ship removed. */
  readonly rangeFromPlayerKm: number | null;
}

export interface EncounterObjectiveData {
  readonly kind: string;
  readonly destroyed: number;
  readonly required: number;
  readonly complete: boolean;
}

export interface EncounterInstanceData {
  readonly instanceId: string;
  readonly encounterId: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly rewardSummaryKey: string;
  readonly tier: number;
  readonly siteId: string;
  readonly status: 'active' | 'completed' | 'abandoned';
  readonly startedAtMs: number;
  readonly resolvedAtMs: number | null;
  readonly objective: EncounterObjectiveData;
  readonly bountyCreditsPaid: number;
  readonly npcs: readonly EncounterNpcData[];
}

export interface WreckData {
  readonly wreckId: string;
  /** `player` for the pilot's own wreck, which is theirs to recover. */
  readonly owner: 'npc' | 'player';
  readonly nameKey: string;
  readonly hullId: string;
  readonly position: VectorData;
  readonly rangeFromPlayerKm: number;
  readonly expiresAtMs: number;
  readonly remainingSeconds: number;
  readonly itemCount: number;
  /** Whether the wreck may be opened, and why not (Functional Specification 9.11). */
  readonly commands: readonly CommandAvailabilityData[];
}

/** What one encounter attempt produced, for the station-side summary. */
export interface EncounterOutcomeData {
  readonly encounterId: string;
  readonly nameKey: string;
  /** `lost` when the attempt ended with the player's ship destroyed. */
  readonly status: 'completed' | 'abandoned' | 'lost';
  readonly resolvedAtMs: number;
  readonly bountyCreditsPaid: number;
  readonly npcsDestroyed: number;
  readonly npcsTotal: number;
}

export interface EncounterData {
  readonly revision: number;
  readonly simulationTimeMs: number;
  /** `null` when the player is not inside an authored encounter. */
  readonly instance: EncounterInstanceData | null;
  /** Wrecks present in the loaded site, oldest first. */
  readonly wrecks: readonly WreckData[];
  readonly lastOutcome: EncounterOutcomeData | null;
}

/** The contents of one wreck (Functional Specification 9.11). */
export interface WreckContentsData {
  readonly revision: number;
  readonly wreckId: string;
  readonly accessible: boolean;
  readonly unavailableReason: string | null;
  readonly rangeFromPlayerKm: number | null;
  readonly expiresAtMs: number;
  readonly remainingSeconds: number;
  readonly stacks: readonly StackData[];
  /** The most of each stack the player's hold could accept right now. */
  readonly maximumQuantities: readonly WreckStackCapacityData[];
}

export interface WreckStackCapacityData {
  readonly stackId: string;
  readonly maximumQuantity: number;
}
