import {
  applyDraftTo,
  assessFit,
  deriveShipAttributes,
  draftFromFit,
  fitFromDraft,
  InventoryError,
  shipFit,
  slotKey,
  structuralViolations,
  type CampaignDraft,
  type FittingDraft,
  type PlannedSlot,
  type SlotRef,
} from '@engine/domain';
import type { ContentRepository, SlotKind } from '@engine/ports';
import {
  createEngineError,
  fitViolationError,
  ruleViolationMessageKey,
  type ClearFittingSlotPayload,
  type SetFittingSlotPayload,
  type ShipPayload,
} from '@protocol';
import { canonicalJson, type AmmunitionId, type ModuleId } from '@shared';

import { APPLIED, reject, UNCHANGED, type CommandOutcome, type Transaction } from './transaction';

/**
 * The fitting-draft commands (Functional Specification 8.4-8.5; Technical
 * Specification 10.2).
 *
 * Fitting is a draft, not a stream of edits applied to the ship. Opening it
 * copies the fit the ship wears, each change replaces one slot, reverting
 * discards the draft, and committing performs every move at once. Nothing the
 * player is considering reaches the ship until they commit.
 *
 * A change that could not physically exist - a module in a slot the hull does
 * not have, a charge in a weapon that does not take it - is refused when it is
 * made, with the constraint it breaks. A fit that merely over-commits the
 * power grid is allowed to exist and blocks undocking instead, which is what
 * Functional Specification 8.4 requires.
 *
 * @implements FUNC-8.4, FUNC-8.5, FUNC-22.4, FUNC-22.10, TECH-10.2, MVP-AC-02
 */
export function handleFittingCommand(
  transaction: Transaction,
  type: string,
  payload: unknown,
): CommandOutcome {
  const draft = transaction.draft;
  if (draft === null) {
    return reject('noCampaignOpen');
  }

  try {
    switch (type) {
      case 'fitting.begin':
        return begin(transaction, draft, (payload as ShipPayload).shipId);
      case 'fitting.set':
        return set(transaction, draft, payload as SetFittingSlotPayload);
      case 'fitting.clear':
        return clear(transaction, draft, payload as ClearFittingSlotPayload);
      case 'fitting.revert':
        return revert(transaction, draft);
      default:
        return commit(transaction, draft);
    }
  } catch (error: unknown) {
    if (error instanceof InventoryError) {
      return error.reason === 'inventoryNotFound' || error.reason === 'itemNotFound'
        ? {
            kind: 'rejected',
            error: createEngineError('NOT_FOUND', ruleViolationMessageKey(error.reason)),
          }
        : reject(error.reason);
    }
    throw error;
  }
}

/**
 * Opens a draft on a docked ship. Reopening the screen on the ship that
 * already has one keeps the changes the player has not committed yet.
 */
function begin(
  transaction: Transaction,
  draft: CampaignDraft,
  shipId: string,
): CommandOutcome {
  const open = draft.fitting;
  if (open !== null) {
    return open.shipId === shipId ? UNCHANGED : reject('fittingDraftOpen');
  }

  const ship = draft.assets.ships[shipId];
  if (ship === undefined) {
    return { kind: 'rejected', error: createEngineError('NOT_FOUND', ruleViolationMessageKey('itemNotFound')) };
  }
  if (!hasFittingService(transaction.content, draft, shipId)) {
    return reject('fittingUnavailable');
  }

  draft.fitting = draftFromFit(ship.id, draft.revision, shipFit(draft.assets, shipId));
  transaction.publish('fitting.draftOpened', { shipId });
  transaction.invalidate('fitting');
  return APPLIED;
}

function set(
  transaction: Transaction,
  draft: CampaignDraft,
  payload: SetFittingSlotPayload,
): CommandOutcome {
  const open = requireDraft(draft);
  if (open === null) {
    return reject('fittingDraftClosed');
  }

  const slot: SlotRef = { kind: payload.slotKind as SlotKind, index: payload.slotIndex };
  const planned: PlannedSlot = {
    moduleId: payload.moduleId as ModuleId,
    online: payload.online,
    ammunitionId: (payload.ammunitionId as AmmunitionId | undefined) ?? null,
  };

  const content = transaction.content;
  if (content.module(planned.moduleId) === undefined) {
    return { kind: 'rejected', error: fitViolationError('moduleUnknown', { moduleId: planned.moduleId }) };
  }
  if (planned.ammunitionId !== null && content.ammunition(planned.ammunitionId) === undefined) {
    return {
      kind: 'rejected',
      error: fitViolationError('ammunitionUnknown', { ammunitionId: planned.ammunitionId }),
    };
  }

  const key = slotKey(slot);
  if (canonicalJson(open.slots[key] ?? null) === canonicalJson(planned)) {
    return UNCHANGED;
  }

  const candidate: FittingDraft = { ...open, slots: { ...open.slots, [key]: planned } };
  const broken = firstStructuralViolation(transaction.content, draft, candidate);
  if (broken !== null) {
    return { kind: 'rejected', error: fitViolationError(broken.code, broken.params) };
  }

  draft.fitting = candidate;
  transaction.publish('fitting.draftChanged', { slot: key, moduleId: planned.moduleId });
  transaction.invalidate('fitting');
  return APPLIED;
}

function clear(
  transaction: Transaction,
  draft: CampaignDraft,
  payload: ClearFittingSlotPayload,
): CommandOutcome {
  const open = requireDraft(draft);
  if (open === null) {
    return reject('fittingDraftClosed');
  }

  const key = slotKey({ kind: payload.slotKind as SlotKind, index: payload.slotIndex });
  if (!Object.hasOwn(open.slots, key)) {
    return UNCHANGED;
  }

  const slots = { ...open.slots };
  delete slots[key];
  draft.fitting = { ...open, slots };
  transaction.publish('fitting.draftChanged', { slot: key, moduleId: '' });
  transaction.invalidate('fitting');
  return APPLIED;
}

function revert(transaction: Transaction, draft: CampaignDraft): CommandOutcome {
  const open = requireDraft(draft);
  if (open === null) {
    return reject('fittingDraftClosed');
  }

  draft.fitting = null;
  transaction.publish('fitting.draftReverted', { shipId: open.shipId });
  transaction.invalidate('fitting');
  return APPLIED;
}

/**
 * Applies the draft atomically. Every move happens on the transaction's own
 * copy of campaign state, so a refusal here leaves the ship, the hangar and
 * the wallet exactly as they were.
 */
function commit(transaction: Transaction, draft: CampaignDraft): CommandOutcome {
  const open = requireDraft(draft);
  if (open === null) {
    return reject('fittingDraftClosed');
  }
  if (!hasFittingService(transaction.content, draft, open.shipId)) {
    return reject('fittingUnavailable');
  }

  // The inventory service works on its own asset draft and hands back the
  // result, so the campaign only adopts it once every move has succeeded.
  const work = {
    campaignId: draft.campaignId,
    nextEntityOrdinal: draft.nextEntityOrdinal,
    assets: draft.assets,
  };
  const missing = applyDraftTo(work, transaction.content, open);
  if (missing.length > 0) {
    return reject('fittingItemsMissing', {
      definitionId: missing[0]?.definitionId ?? '',
      required: missing[0]?.required ?? 0,
      available: missing[0]?.available ?? 0,
    });
  }

  draft.assets = work.assets;
  draft.nextEntityOrdinal = work.nextEntityOrdinal;

  draft.fitting = null;
  transaction.publish('fitting.committed', { shipId: open.shipId });
  transaction.invalidate('fitting');
  transaction.invalidate('ship');
  transaction.invalidate('assets');
  transaction.invalidate('inventory');
  // Functional Specification 3.4 lists the points that trigger an autosave and
  // a fitting change is not one of them, so none is requested here.
  return APPLIED;
}

function requireDraft(draft: CampaignDraft): FittingDraft | null {
  return draft.fitting;
}

/** Fitting is a station service; a ship in space cannot be refitted. */
function hasFittingService(
  content: ContentRepository,
  draft: CampaignDraft,
  shipId: string,
): boolean {
  const ship = draft.assets.ships[shipId];
  if (
    ship === undefined ||
    ship.location.kind !== 'station' ||
    draft.assets.location.kind !== 'station' ||
    ship.location.stationId !== draft.assets.location.stationId
  ) {
    return false;
  }
  return content.station(ship.location.stationId)?.services.includes('fitting') === true;
}

function firstStructuralViolation(
  content: ContentRepository,
  draft: CampaignDraft,
  candidate: FittingDraft,
): { readonly code: string; readonly params: Readonly<Record<string, string | number | boolean>> } | null {
  const ship = draft.assets.ships[candidate.shipId];
  if (ship === undefined) {
    return null;
  }
  const hull = content.requireHull(ship.hullId);
  const fit = fitFromDraft(candidate, content);
  const derived = deriveShipAttributes({ hull, fit, content });
  const broken = structuralViolations(assessFit({ hull, fit, content, derived }).violations)[0];
  return broken === undefined ? null : { code: broken.code, params: broken.params };
}
