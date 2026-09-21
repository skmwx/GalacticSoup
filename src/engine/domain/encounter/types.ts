import type { EncounterId, HullId, LootTableId, MessageKey, NpcProfileId, SiteId, SystemId } from '@shared';

import type { InventoryId } from '../assets/types';
import type { EntityId } from '../campaign/identity';
import type { Vector2 } from '../navigation/types';

/**
 * Authored combat encounters as running state
 * (Functional Specification 5.4, 9.10-9.11, 18; Technical Specification 8.2,
 * 10.3, 10.6).
 *
 * An encounter is an instance of an authored definition, not the definition
 * itself: the definition says which opponents a site holds, and the instance
 * says which ships were created for them, what the objective still needs and
 * which rewards have already been settled. Nothing here copies an authored
 * value that content still owns.
 *
 * Two lifetimes live side by side. The instance lasts as long as the player
 * occupies the site: leaving abandons it, and the next visit instantiates a
 * fresh one, so the loop cannot be exhausted (MVP Scope 4.2). A wreck outlives
 * it, because Functional Specification 5.4 gives a wreck 30 simulation minutes
 * whether or not the site stays loaded.
 *
 * @implements FUNC-5.4, FUNC-9.10, FUNC-9.11, TECH-8.2, TECH-10.6
 */

export const ENCOUNTER_STATUSES = ['active', 'completed', 'abandoned'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

/** One authored spawn, once it has become a ship. */
export interface EncounterNpcState {
  /** The ship entity in `assets.ships`, while it is still alive. */
  readonly shipId: EntityId;
  readonly profileId: NpcProfileId;
  /** Order the spawn was instantiated in; the display name is derived from it. */
  readonly spawnOrdinal: number;
  readonly bountyCredits: number;
  readonly lootTableId: LootTableId;
  /** Set once the ship has been destroyed and its rewards resolved. */
  readonly destroyedAtMs: number | null;
  /** The boundary at which this opponent next reconsiders its orders. */
  readonly decisionBoundaryEntryId: EntityId | null;
}

/**
 * The declarative objective (Technical Specification 10.6).
 *
 * The MVP authors only one predicate - destroy the spawned group - so the
 * state machine has one node. The kind is stored explicitly so a later
 * objective can be added without reinterpreting saved instances.
 */
export interface EncounterObjectiveState {
  readonly kind: 'destroyGroup';
  readonly destroyed: number;
  readonly required: number;
}

export interface EncounterInstanceState {
  readonly instanceId: EntityId;
  readonly encounterId: EncounterId;
  readonly systemId: SystemId;
  readonly siteId: SiteId;
  readonly status: EncounterStatus;
  readonly startedAtMs: number;
  readonly resolvedAtMs: number | null;
  readonly npcs: readonly EncounterNpcState[];
  readonly objective: EncounterObjectiveState;
  /**
   * Rewards already settled, by grant id. A replayed completion cannot pay a
   * bounty twice (Technical Specification 10.6).
   */
  readonly grantedRewardIds: readonly string[];
  readonly bountyCreditsPaid: number;
}

/**
 * A wreck and the container it is (Functional Specification 9.11).
 *
 * Its contents are ordinary item stacks in an ordinary inventory, so taking
 * from it is the same physical move as any other and cannot duplicate goods.
 */
export interface WreckState {
  readonly id: EntityId;
  readonly systemId: SystemId;
  readonly siteId: SiteId;
  readonly inventoryId: InventoryId;
  /** The hull that produced it; the site object is named after it. */
  readonly hullId: HullId;
  readonly nameKey: MessageKey;
  readonly position: Vector2;
  readonly radiusKm: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly boundaryEntryId: EntityId;
}

/** What the station reports about the last attempt (MVP Scope 9.1). */
export interface EncounterOutcomeRecord {
  readonly encounterId: EncounterId;
  readonly status: 'completed' | 'abandoned';
  readonly resolvedAtMs: number;
  readonly bountyCreditsPaid: number;
  readonly npcsDestroyed: number;
  readonly npcsTotal: number;
}

export interface EncounterState {
  /** Changes whenever any encounter runtime changes, for projection binding. */
  readonly version: number;
  /** The instance the player is inside, or `null`. */
  readonly active: EncounterInstanceState | null;
  /** Wrecks by entity id. They outlive the instance that created them. */
  readonly wrecks: Readonly<Record<string, WreckState>>;
  /** Completions per encounter id, so repeatability is visible. */
  readonly completions: Readonly<Record<string, number>>;
  readonly lastOutcome: EncounterOutcomeRecord | null;
}

/** One rolled loot line, before it becomes a stack. */
export interface RolledLootEntry {
  readonly definitionId: string;
  readonly quantity: number;
}
