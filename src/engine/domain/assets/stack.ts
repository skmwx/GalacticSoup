import { canonicalJson } from '@shared';
import type { ItemStack, Provenance, StackState } from './types';
import { InventoryError } from './types';

/**
 * Whether two stacks may become one (Technical Specification 8.3).
 *
 * Recovery-grant units stay in stacks of their own, so they can never lend
 * their mark to - or lose it among - ordinary units. A loaded magazine is the
 * exception: one slot holds one charge, so rounds of either kind loaded into
 * it share a stack, and `mergedRecoveryGrant` keeps the result marked.
 *
 * @implements TECH-8.3, TECH-10.9, FUNC-6.2, FUNC-9.12
 */
export function compatibleStacks(a: ItemStack, b: ItemStack): boolean {
  return a.definitionId === b.definitionId && sameState(a.state, b.state) &&
    (a.recoveryGrant === b.recoveryGrant || a.state.kind === 'charge');
}
/** A merge never removes the recovery-grant mark from any unit it covers. */
export function mergedRecoveryGrant(a: ItemStack, b: ItemStack): boolean {
  return a.recoveryGrant || b.recoveryGrant;
}
/** Two states are the same when their canonical forms are identical. */
export function sameState(a: StackState, b: StackState): boolean {
  return a.kind === b.kind && canonicalJson(a) === canonicalJson(b);
}
export function safeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new InventoryError('numericOverflow');
  return value;
}
export function positiveQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new InventoryError('invalidQuantity');
  return value;
}
/** Exact multiplication/division; bigint is local arithmetic, never persisted or transported. */
function portion(total: number, units: number, quantity: number): number {
  return Number(BigInt(total) * BigInt(units) / BigInt(quantity));
}
export function splitProvenance(p: Provenance, quantity: number): readonly [Provenance, Provenance] {
  const total = p.grantedQuantity + p.purchasedQuantity;
  const purchasedQuantity = portion(p.purchasedQuantity, quantity, total);
  const purchaseCostCredits = p.purchasedQuantity === 0 ? 0
    : portion(p.purchaseCostCredits, purchasedQuantity, p.purchasedQuantity);
  const moved = { grantedQuantity: quantity - purchasedQuantity, purchasedQuantity, purchaseCostCredits };
  return [moved, {
    grantedQuantity: p.grantedQuantity - moved.grantedQuantity,
    purchasedQuantity: p.purchasedQuantity - purchasedQuantity,
    purchaseCostCredits: p.purchaseCostCredits - purchaseCostCredits,
  }];
}
export function mergeProvenance(a: Provenance, b: Provenance): Provenance {
  return {
    grantedQuantity: safeCount(a.grantedQuantity + b.grantedQuantity),
    purchasedQuantity: safeCount(a.purchasedQuantity + b.purchasedQuantity),
    purchaseCostCredits: safeCount(a.purchaseCostCredits + b.purchaseCostCredits),
  };
}
