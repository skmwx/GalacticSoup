import type { CampaignDraft } from '@engine/domain';
import { createEngineError, ruleViolationMessageKey, type ShipPayload } from '@protocol';

import { APPLIED, reject, UNCHANGED, type CommandOutcome, type Transaction } from './transaction';

/**
 * Choosing which owned ship the player flies (Functional Specification 6.3;
 * FeatureSpec02 4.2).
 *
 * Switching is instantaneous and free while docked, and accepts only a ship
 * of the player's that is docked at the same station. It moves nothing: cargo,
 * fitted modules, loaded charges, damage and insurance all stay with the ship
 * they belong to. A ship whose fit is invalid may be chosen so that its fit can
 * be repaired; it simply cannot undock.
 *
 * An open fitting draft is bound to its ship. Switching while one is open is
 * refused, so the player explicitly applies or discards it first and a commit
 * can never land on a ship they did not mean (FeatureSpec02 4.2). The switch
 * changes the asset version, so every station preview taken before it goes
 * stale and must be confirmed again.
 *
 * A completed switch requests an autosave, so a resumed campaign never comes
 * back in the previous ship (Functional Specification 3.4 as amended for v0.2).
 *
 * @implements FUNC-6.3, FUNC-3.4, V02-AC-03
 */
export function handleShipCommand(
  transaction: Transaction,
  type: string,
  payload: unknown,
): CommandOutcome {
  const draft = transaction.draft;
  if (draft === null) return reject('noCampaignOpen');
  switch (type) {
    case 'ship.activate':
      return activate(transaction, draft, (payload as ShipPayload).shipId);
    default:
      throw new TypeError(`Unknown ship command ${type}.`);
  }
}

function activate(transaction: Transaction, draft: CampaignDraft, shipId: string): CommandOutcome {
  const ship = Object.hasOwn(draft.assets.ships, shipId) ? draft.assets.ships[shipId] : undefined;
  if (ship === undefined || ship.owner !== 'player') {
    return {
      kind: 'rejected',
      error: createEngineError('NOT_FOUND', ruleViolationMessageKey('shipNotFound')),
    };
  }
  const here = draft.assets.location;
  if (here.kind !== 'station') return reject('shipSwitchInSpace');
  if (ship.location.kind !== 'station' || ship.location.stationId !== here.stationId) {
    return reject('shipNotLocal');
  }
  if (draft.assets.activeShipId === ship.id) return UNCHANGED;
  if (draft.fitting !== null) {
    return reject('fittingDraftOpen');
  }

  const previousShipId = draft.assets.activeShipId;
  draft.assets.activeShipId = ship.id;
  draft.assets.version += 1;

  transaction.publish('ship.activated', {
    shipId: ship.id,
    previousShipId: previousShipId ?? '',
    hullId: ship.hullId,
  });
  for (const topic of [
    'assets', 'ship', 'fitting', 'inventory', 'station', 'market',
    'repair', 'resupply', 'insurance', 'site', 'destinations',
  ] as const) {
    transaction.invalidate(topic);
  }
  transaction.requestAutosave();
  return APPLIED;
}
