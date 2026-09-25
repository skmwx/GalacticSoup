import type { DamageProfile, DefenseLayer } from '@engine/ports';
import type {
  DefinitionId,
  EncounterId,
  HullId,
  MessageKey,
  ModuleId,
  SiteId,
  StationId,
  SystemId,
} from '@shared';

import type { EntityId } from '../campaign/identity';
import type { SlotRef } from '../fitting/types';

/**
 * Player ship destruction, its report and the recovery that follows
 * (Functional Specification 9.12; Technical Specification 8.1, 10.3, 10.9).
 *
 * Destruction is one transaction: the wreck, the survival rolls, the move to
 * the recovery station, the insurance settlement and any recovery grant are
 * committed together or not at all. What the player needs to understand the
 * loss afterwards is frozen here at that moment, because the ships, the
 * combat runtime and the site that caused it are gone the instant it commits.
 *
 * @implements FUNC-9.12, TECH-8.1, TECH-10.3, TECH-10.9
 */

/** One attacker's share of the damage the lost ship took. */
export interface LossDamageSourceRecord {
  /** The attacker's entity id at the time; the ship itself no longer exists. */
  readonly sourceId: string;
  /** The name the player met it by, resolved when the loss was recorded. */
  readonly nameKey: MessageKey;
  readonly hits: number;
  readonly firstAtMs: number;
  readonly lastAtMs: number;
  /** Damage before resistances, by type. */
  readonly rawDamage: DamageProfile;
  /** Damage that removed hit points, by type. */
  readonly appliedDamage: DamageProfile;
  /** Damage that removed hit points, by the layer it removed them from. */
  readonly layerDamage: Readonly<Record<DefenseLayer, number>>;
}

/** The last burst of fire the ship took before its hull gave out. */
export interface LossFinalDamageRecord {
  readonly sourceId: string;
  readonly nameKey: MessageKey;
  readonly slotKey: string;
  readonly hits: number;
  readonly atMs: number;
  readonly rawDamage: DamageProfile;
  readonly appliedDamage: DamageProfile;
}

/**
 * What had stopped working before the end (Functional Specification 9.12).
 * The MVP has no hostile control effects, so the disabling conditions are the
 * ship's own: capacitor too low to run a module, or a weapon with nothing
 * left to load.
 */
export const LOSS_DISABLING_KINDS = ['capacitorDepleted', 'ammunitionExhausted'] as const;
export type LossDisablingKind = (typeof LOSS_DISABLING_KINDS)[number];

export interface LossDisablingEffectRecord {
  readonly kind: LossDisablingKind;
  readonly slot: SlotRef;
  readonly moduleId: ModuleId;
}

/** Where a lost or surviving unit was carried. */
export const LOSS_ITEM_ORIGINS = ['fitted', 'cargo', 'loaded'] as const;
export type LossItemOrigin = (typeof LOSS_ITEM_ORIGINS)[number];

export interface LossItemRecord {
  readonly definitionId: DefinitionId;
  readonly quantity: number;
  readonly origin: LossItemOrigin;
  /** Survived into the wreck; loaded ammunition never does. */
  readonly survived: boolean;
  readonly recoveryGrant: boolean;
}

export interface LossInsuranceRecord {
  readonly coverage: 'basic' | 'enhanced';
  readonly hullReferenceValueCredits: number;
  /** The share of the hull's reference value the cover pays. */
  readonly payoutFraction: number;
  readonly payoutCredits: number;
  /** Enhanced cover is spent by the destruction it pays for. */
  readonly enhancedConsumed: boolean;
  /** A recovery-grant hull has no insurance value and pays nothing. */
  readonly recoveryGrantHull: boolean;
}

/**
 * How the player was left able to fly again (Functional Specification 9.12,
 * 22.1): a recovery grant, another ship already waiting at the station, or
 * credits enough to buy the starter hull the station always sells.
 */
export const LOSS_RECOVERY_OUTCOMES = ['granted', 'otherShip', 'noShip'] as const;
export type LossRecoveryOutcome = (typeof LOSS_RECOVERY_OUTCOMES)[number];

export interface LossRecoveryRecord {
  readonly outcome: LossRecoveryOutcome;
  /** The ship the player controls afterwards, or `null` when they own none. */
  readonly activeShipId: EntityId | null;
  readonly creditsAfter: number;
  /** The threshold below which a shipless pilot is granted a starter ship. */
  readonly starterReferenceValueCredits: number;
}

export interface LossRecord {
  readonly lossId: EntityId;
  readonly shipId: EntityId;
  readonly hullId: HullId;
  readonly destroyedAtMs: number;
  readonly systemId: SystemId;
  readonly siteId: SiteId;
  /** The authored encounter the player was inside, if any. */
  readonly encounterId: EncounterId | null;
  /** The wreck the survivors lie in; it may since have expired. */
  readonly wreckId: EntityId;
  readonly wreckExpiresAtMs: number;
  readonly recoveryStationId: StationId;
  /** Attackers in the order they first hit the ship. */
  readonly incoming: readonly LossDamageSourceRecord[];
  readonly finalDamage: LossFinalDamageRecord | null;
  readonly disablingEffects: readonly LossDisablingEffectRecord[];
  readonly items: readonly LossItemRecord[];
  readonly insurance: LossInsuranceRecord;
  readonly recovery: LossRecoveryRecord;
}

export interface RecoveryState {
  /** Changes whenever the record below changes, for projection binding. */
  readonly version: number;
  /** How many ships the player has lost in this campaign. */
  readonly losses: number;
  /** The most recent loss, which the station reports until the next one. */
  readonly lastLoss: LossRecord | null;
}
