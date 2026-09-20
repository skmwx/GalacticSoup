import type { AssetDraft } from './types';
import { InventoryError } from './types';
import { safeCount } from './stack';

/** @implements FUNC-4.1, FUNC-6.1, FUNC-22.2 */
export function creditWallet(draft: AssetDraft, credits: number): void {
  safeCount(credits);
  if (credits === 0) return;
  draft.assets.credits = safeCount(draft.assets.credits + credits);
  draft.assets.version += 1;
}
export function debitWallet(draft: AssetDraft, credits: number): void {
  safeCount(credits);
  if (credits > draft.assets.credits) throw new InventoryError('insufficientCredits');
  if (credits === 0) return;
  draft.assets.credits -= credits;
  draft.assets.version += 1;
}
