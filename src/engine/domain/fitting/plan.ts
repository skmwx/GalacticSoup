import type { ContentRepository } from '@engine/ports';
import { canonicalJson, deepClone } from '@shared';

import type { CampaignId, EntityId } from '../campaign/identity';
import { InventoryError, type AssetDraft, type AssetState, type InventoryFailure } from '../assets/types';

import { applyDraftTo } from './apply';
import { slotKey } from './types';
import type { FitDescription, FittingDraft, MissingItem, PlannedSlot } from './types';

/**
 * Planning a fitting change (Technical Specification 10.2).
 *
 * A draft is opened from the fit the ship is wearing, so opening it changes
 * nothing and reverting means discarding it. Each edit replaces one slot, and
 * the whole draft describes the fit the player is asking for rather than a
 * list of edits, which is what makes it safe to keep across a save and a
 * purchase.
 *
 * A preview is the commit, run against a copy. The player therefore cannot be
 * shown one result and given another (Functional Specification 22.4).
 *
 * @implements FUNC-8.4, FUNC-8.5, FUNC-22.4, TECH-10.2
 */

export function draftFromFit(
  shipId: EntityId,
  baseRevision: number,
  fit: FitDescription,
): FittingDraft {
  const slots: Record<string, PlannedSlot> = {};
  for (const fitted of fit) {
    slots[slotKey(fitted.slot)] = {
      moduleId: fitted.moduleId,
      online: fitted.online,
      ammunitionId: fitted.charge?.ammunitionId ?? null,
    };
  }
  return { shipId, baseRevision, slots };
}

/** True when the draft asks for exactly the fit the ship already wears. */
export function draftMatchesFit(draft: FittingDraft, fit: FitDescription): boolean {
  const current = draftFromFit(draft.shipId, draft.baseRevision, fit);
  return canonicalJson(current.slots) === canonicalJson(draft.slots);
}

export interface DraftPreview {
  /** False when the change cannot be made at all, such as a full cargo hold. */
  readonly ok: boolean;
  readonly failureReason: InventoryFailure | null;
  /** Items the draft needs that the local stores cannot supply. */
  readonly missing: readonly MissingItem[];
  /** The assets a commit would produce, or `null` when it would fail. */
  readonly assets: AssetState | null;
}

export interface PreviewInput {
  readonly campaignId: CampaignId;
  readonly nextEntityOrdinal: number;
  readonly assets: AssetState;
  readonly content: ContentRepository;
  readonly draft: FittingDraft;
}

export function previewDraft(input: PreviewInput): DraftPreview {
  const work: AssetDraft = {
    campaignId: input.campaignId,
    nextEntityOrdinal: input.nextEntityOrdinal,
    assets: deepClone(input.assets),
  };

  try {
    const missing = applyDraftTo(work, input.content, input.draft);
    return { ok: true, failureReason: null, missing, assets: work.assets };
  } catch (error: unknown) {
    if (error instanceof InventoryError) {
      return { ok: false, failureReason: error.reason, missing: [], assets: null };
    }
    throw error;
  }
}
