import { inventoryService, requireInventory, requireStack, isLocalInventory, InventoryError } from '@engine/domain';
import { createEngineError, ruleViolationMessageKey, type TransferInventoryPayload, type SplitInventoryPayload, type MergeInventoryPayload } from '@protocol';
import { APPLIED, reject, type Transaction, type CommandOutcome } from './transaction';

/** @implements FUNC-6.1, FUNC-6.2, TECH-7.2 */
export function handleInventoryCommand(transaction: Transaction, type: string, payload: unknown): CommandOutcome {
  const draft = transaction.draft;
  if (draft === null) return reject('noCampaignOpen');
  try {
    const service = inventoryService(draft, transaction.content);
    const localStack = (id: string) => {
      const stack = requireStack(draft.assets, id);
      localInventory(stack.inventoryId);
      return stack;
    };
    const localInventory = (id: string) => {
      if (!isLocalInventory(draft.assets, requireInventory(draft.assets, id))) throw new InventoryError('inventoryUnavailable');
    };
    let resultStackId: string;
    if (type === 'inventory.transfer') {
      const p = payload as TransferInventoryPayload;
      localStack(p.stackId); localInventory(p.destinationInventoryId);
      resultStackId = service.transfer(p.stackId, p.destinationInventoryId, p.quantity);
    } else if (type === 'inventory.split') {
      const p = payload as SplitInventoryPayload;
      localStack(p.stackId);
      resultStackId = service.split(p.stackId, p.quantity);
    } else {
      const p = payload as MergeInventoryPayload;
      localStack(p.sourceStackId); localStack(p.targetStackId);
      resultStackId = service.merge(p.sourceStackId, p.targetStackId);
    }
    transaction.publish('inventory.changed', { action: type, stackId: resultStackId });
    transaction.invalidate('inventory');
    transaction.invalidate('assets');
    return APPLIED;
  } catch (error) {
    if (error instanceof InventoryError) {
      if (error.reason === 'inventoryNotFound' || error.reason === 'itemNotFound') {
        return { kind: 'rejected', error: createEngineError('NOT_FOUND', ruleViolationMessageKey(error.reason)) };
      }
      return reject(error.reason);
    }
    throw error;
  }
}
