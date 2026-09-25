import type { SlotRefData } from './assets';
import type { FormulaTraceData } from './economy';

/**
 * The loss report (Functional Specification 9.12, 19.6, 20).
 *
 * A destroyed ship is explained after the fact: who hit it, with what, which
 * layers each attacker broke, what the last burst was, what had stopped
 * working, what was lost and what survived into the wreck, what the insurance
 * paid and how the pilot was left able to fly again. The engine froze all of
 * it at the moment of destruction; the interface renders it and decides
 * nothing.
 */

export interface LossDamageSourceData {
  readonly sourceId: string;
  readonly nameKey: string;
  readonly hits: number;
  readonly firstAtMs: number;
  readonly lastAtMs: number;
  readonly rawDamage: Readonly<Record<string, number>>;
  readonly appliedDamage: Readonly<Record<string, number>>;
  /** Applied damage by layer: shield, armor and hull. */
  readonly layerDamage: Readonly<Record<string, number>>;
  readonly appliedTotal: number;
}

export interface LossFinalDamageData {
  readonly sourceId: string;
  readonly nameKey: string;
  readonly slotKey: string;
  readonly hits: number;
  readonly atMs: number;
  readonly rawDamage: Readonly<Record<string, number>>;
  readonly appliedDamage: Readonly<Record<string, number>>;
  readonly appliedTotal: number;
}

export interface LossDisablingEffectData {
  readonly kind: 'capacitorDepleted' | 'ammunitionExhausted';
  readonly slot: SlotRefData;
  readonly moduleId: string;
  readonly moduleNameKey: string;
}

export interface LossItemData {
  readonly definitionId: string;
  readonly nameKey: string;
  readonly quantity: number;
  readonly origin: 'fitted' | 'cargo' | 'loaded';
  readonly survived: boolean;
  readonly recoveryGrant: boolean;
}

export interface LossInsuranceData {
  readonly coverage: 'basic' | 'enhanced';
  readonly hullReferenceValueCredits: number;
  readonly payoutFraction: number;
  readonly payoutCredits: number;
  readonly enhancedConsumed: boolean;
  readonly recoveryGrantHull: boolean;
  /** The payout with its operands, for the expanded explanation. */
  readonly trace: FormulaTraceData;
}

export interface LossRecoveryData {
  readonly outcome: 'granted' | 'otherShip' | 'noShip';
  readonly activeShipId: string | null;
  readonly creditsAfter: number;
  readonly starterReferenceValueCredits: number;
}

/** The survivors' wreck as it is now; it may since have expired. */
export interface LossWreckData {
  readonly wreckId: string;
  /** False once the wreck has expired and taken what was left in it. */
  readonly present: boolean;
  readonly expiresAtMs: number;
  readonly remainingSeconds: number;
  /** Stacks still in the wreck now, which looting reduces. */
  readonly itemCount: number;
  /** Whether it is the destination chosen at the station. */
  readonly selected: boolean;
}

export interface LossData {
  readonly lossId: string;
  readonly shipId: string;
  readonly hullId: string;
  readonly hullNameKey: string;
  readonly destroyedAtMs: number;
  readonly systemId: string;
  readonly siteId: string;
  readonly siteNameKey: string;
  readonly encounterId: string | null;
  readonly encounterNameKey: string | null;
  readonly recoveryStationId: string;
  readonly recoveryStationNameKey: string;
  readonly wreck: LossWreckData;
  /** Attackers in the order they first hit the ship. */
  readonly incoming: readonly LossDamageSourceData[];
  readonly totalAppliedDamage: number;
  readonly finalDamage: LossFinalDamageData | null;
  readonly disablingEffects: readonly LossDisablingEffectData[];
  readonly items: readonly LossItemData[];
  readonly insurance: LossInsuranceData;
  readonly recovery: LossRecoveryData;
}

export interface LossReportData {
  readonly revision: number;
  readonly simulationTimeMs: number;
  /** Ships lost in this campaign. */
  readonly losses: number;
  /** The most recent loss, or `null` before the first one. */
  readonly report: LossData | null;
}
