import type { ContentRepository, HullDefinition } from '@engine/ports';

import { deriveShipAttributes } from '../attributes';
import type { AssetState, ShipIdentity } from '../assets/types';
import type { CampaignState } from '../campaign/state';
import { shipFit } from '../fitting/fit';
import { assessFit } from '../fitting/validity';

/**
 * The rules of loss and recovery that decide amounts and eligibility
 * (Functional Specification 9.12, 22.1).
 *
 * Each is a pure function of state and content so the destruction
 * transaction, the station projections and the tests all ask the same
 * question the same way.
 *
 * @implements FUNC-9.12, FUNC-22.1, TECH-10.9
 */

export interface InsuranceSettlement {
  readonly coverage: 'basic' | 'enhanced';
  readonly hullReferenceValueCredits: number;
  readonly payoutFraction: number;
  readonly payoutCredits: number;
  readonly recoveryGrantHull: boolean;
}

/**
 * What a hull's insurance pays when it is destroyed.
 *
 * Every hull carries free basic cover; enhanced cover pays more and is spent
 * by the destruction it pays for. Insurance never covers modules or cargo, and
 * a recovery-grant hull has no insurance value at all. Credits are whole, so
 * the payout rounds down at the final step (Functional Specification 4.1).
 */
export function insuranceSettlement(
  ship: ShipIdentity,
  hull: HullDefinition,
  content: ContentRepository,
): InsuranceSettlement {
  const rules = content.rules.economy;
  const payoutFraction = ship.insurance.coverage === 'enhanced'
    ? rules.enhancedInsurancePayoutFraction
    : rules.basicInsurancePayoutFraction;
  return {
    coverage: ship.insurance.coverage,
    hullReferenceValueCredits: hull.referenceValueCredits,
    payoutFraction,
    payoutCredits: ship.recoveryGrant ? 0 : Math.floor(hull.referenceValueCredits * payoutFraction),
    recoveryGrantHull: ship.recoveryGrant,
  };
}

/**
 * Whether a ship could leave the station it is docked at right now: the
 * player's, docked, and wearing a fit the undock rule accepts
 * (Functional Specification 8.4, 9.12).
 */
export function isFlightReady(
  assets: AssetState,
  content: ContentRepository,
  ship: ShipIdentity,
): boolean {
  if (ship.owner !== 'player' || ship.location.kind !== 'station') return false;
  const hull = content.hull(ship.hullId);
  if (hull === undefined) return false;
  const fit = shipFit(assets, ship.id);
  return assessFit({ hull, fit, content, derived: deriveShipAttributes({ hull, fit, content }) })
    .violations.length === 0;
}

/** The reference value below which a shipless pilot is granted a ship. */
export function starterReferenceValue(content: ContentRepository): number {
  return content.requireHull(content.rules.economy.starterHullId as HullDefinition['id']).referenceValueCredits;
}

/**
 * Whether the recovery service owes the player a starter ship
 * (Functional Specification 9.12): they own no flight-ready ship and their
 * credits are below the starter ship's reference value.
 */
export function recoveryGrantDue(state: CampaignState, content: ContentRepository): boolean {
  const assets = state.assets;
  const flightReady = Object.keys(assets.ships)
    .sort()
    .some((id) => isFlightReady(assets, content, assets.ships[id]!));
  return !flightReady && assets.credits < starterReferenceValue(content);
}

/**
 * The ship that becomes active at a station when the active one is gone:
 * the first flight-ready player ship docked there, else the first one of any
 * kind, else none.
 */
export function replacementShipAt(
  assets: AssetState,
  content: ContentRepository,
  stationId: string,
): ShipIdentity | null {
  const docked = Object.keys(assets.ships)
    .sort()
    .map((id) => assets.ships[id]!)
    .filter((ship) => ship.owner === 'player' &&
      ship.location.kind === 'station' && ship.location.stationId === stationId);
  return docked.find((ship) => isFlightReady(assets, content, ship)) ?? docked[0] ?? null;
}
