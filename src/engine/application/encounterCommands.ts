import {
  wreckAccessRefusal,
  type EncounterCommandRefusal,
  type EncounterRuleInput,
} from '@engine/domain';
import { takeLoot } from '@engine/simulation';
import type { TakeLootPayload } from '@protocol';

import { APPLIED, reject, type CommandOutcome, type Transaction } from './transaction';

/**
 * The loot command (Functional Specification 9.11, 22.2).
 *
 * Taking from a wreck is the ordinary physical move: the handler proves the
 * player may reach the wreck, and the inventory service decides whether the
 * hold can accept the goods. Nothing is created and nothing is silently
 * discarded for lack of space.
 *
 * @implements FUNC-9.11, FUNC-22.2, FUNC-22.10, TECH-7.2, MVP-AC-06
 */
export function handleEncounterCommand(
  transaction: Transaction,
  type: 'loot.take',
  payload: unknown,
): CommandOutcome {
  const rules: EncounterRuleInput = {
    state: transaction.requireDraft(),
    content: transaction.content,
  };
  switch (type) {
    case 'loot.take':
      return take(transaction, rules, payload as TakeLootPayload);
    default:
      return assertUnreachable(type);
  }
}

function refuse(refusal: EncounterCommandRefusal): CommandOutcome | null {
  return refusal === null ? null : reject(refusal);
}

function take(
  transaction: Transaction,
  rules: EncounterRuleInput,
  payload: TakeLootPayload,
): CommandOutcome {
  const refused = refuse(wreckAccessRefusal(rules, payload.wreckId));
  if (refused !== null) return refused;

  // The inventory service raises an explainable failure when the hold is too
  // small or the stack no longer holds that many units; the pipeline turns it
  // into the matching rule violation.
  const applied = takeLoot(
    transaction.simulation(),
    payload.wreckId,
    payload.stackId,
    payload.quantity,
  );
  if (!applied) return reject('itemNotFound');
  transaction.invalidate('encounter');
  transaction.invalidate('inventory');
  transaction.invalidate('assets');
  transaction.invalidate('ship');
  return APPLIED;
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled encounter command ${String(value)}.`);
}
