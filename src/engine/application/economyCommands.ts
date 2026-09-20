import {
  EconomyError,
  InventoryError,
  allocateEntityId,
  applyStockMovement,
  creditWallet,
  debitWallet,
  inventoryService,
  requireInventory,
  isLocalInventory,
  listingDefinition,
  type CampaignDraft,
} from '@engine/domain';
import {
  insurancePreview,
  marketBuyPreview,
  marketSellPreview,
  previewTokenMatches,
  repairPreview,
  resupplyPreview,
} from '@engine/projections';
import {
  createEngineError,
  ruleViolationMessageKey,
  stalePreview,
  validatePayload,
  type ConfirmPreviewPayload,
  type EconomicAction,
  type MarketBuyPreviewPayload,
  type MarketSellPreviewPayload,
  type MarketTransactionPreviewData,
  type RepairPreviewData,
  type ResupplyPreviewData,
  type InsurancePreviewData,
  type PreviewTokenData,
  type RequestType,
  type ShipEconomicPayload,
  type TransactionPreviewData,
} from '@protocol';
import type { DefinitionId, HullId, StationId } from '@shared';
import type { SlotKind } from '@engine/ports';

import { APPLIED, reject, type CommandOutcome, type Transaction } from './transaction';

/**
 * Atomic preview-confirm station transactions.
 * @implements MVP-AC-02, MVP-AC-06, FUNC-9.12, FUNC-10, FUNC-11.3, FUNC-22.2, FUNC-22.4, TECH-7.4, TECH-8.2, TECH-8.3, TECH-10.4
 */
export function handleEconomyCommand(
  transaction: Transaction,
  type: string,
  payload: unknown,
): CommandOutcome {
  const draft = transaction.draft;
  if (draft === null) return reject('noCampaignOpen');

  const token = (payload as ConfirmPreviewPayload).token;
  const expectedAction = actionOf(type);
  if (token.action !== expectedAction) return reject('invalidPreview');

  try {
    const parameters = readParameters(token, expectedAction);
    const replacement = project(draft, transaction, expectedAction, parameters);
    if (!previewTokenMatches(token, replacement)) {
      return { kind: 'rejected', error: stalePreview(replacement) };
    }
    if (!replacement.available || replacement.token === null) return reject('invalidPreview');

    switch (expectedAction) {
      case 'market.buy': applyBuy(transaction, draft, replacement as MarketTransactionPreviewData); break;
      case 'market.sell': applySell(transaction, draft, replacement as MarketTransactionPreviewData); break;
      case 'repair': applyRepair(transaction, draft, replacement as RepairPreviewData); break;
      case 'resupply': applyResupply(transaction, draft, replacement as ResupplyPreviewData); break;
      case 'insurance.enhance': applyInsurance(transaction, draft, replacement as InsurancePreviewData); break;
    }
    return APPLIED;
  } catch (error: unknown) {
    if (error instanceof InventoryError) {
      if (error.reason === 'inventoryNotFound' || error.reason === 'itemNotFound') {
        return { kind: 'rejected', error: createEngineError('NOT_FOUND', ruleViolationMessageKey(error.reason)) };
      }
      return reject(error.reason);
    }
    if (error instanceof EconomyError) {
      if (error.reason === 'stationNotFound' || error.reason === 'listingNotFound') {
        return { kind: 'rejected', error: createEngineError('NOT_FOUND', 'error.notFound') };
      }
      return reject(error.reason === 'invalidPreview' ? 'invalidPreview' : 'marketUnavailable');
    }
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError) {
      return reject('invalidPreview');
    }
    throw error;
  }
}

function actionOf(type: string): EconomicAction {
  switch (type) {
    case 'market.confirmBuy': return 'market.buy';
    case 'market.confirmSell': return 'market.sell';
    case 'repair.confirm': return 'repair';
    case 'resupply.confirm': return 'resupply';
    case 'insurance.confirm': return 'insurance.enhance';
    default: throw new TypeError(`Unknown economic command ${type}.`);
  }
}

function readParameters(token: PreviewTokenData, action: EconomicAction): object {
  const value: unknown = JSON.parse(token.canonicalParameters);
  const requestType = previewRequestOf(action);
  if (validatePayload(requestType, value) !== null) throw new EconomyError('invalidPreview');
  return value as object;
}

function previewRequestOf(action: EconomicAction): RequestType {
  switch (action) {
    case 'market.buy': return 'market.previewBuy';
    case 'market.sell': return 'market.previewSell';
    case 'repair': return 'repair.preview';
    case 'resupply': return 'resupply.preview';
    case 'insurance.enhance': return 'insurance.preview';
  }
}

function project(
  draft: CampaignDraft,
  transaction: Transaction,
  action: EconomicAction,
  parameters: object,
): TransactionPreviewData {
  const state = draft;
  switch (action) {
    case 'market.buy': return marketBuyPreview(state, transaction.content, parameters as MarketBuyPreviewPayload);
    case 'market.sell': return marketSellPreview(state, transaction.content, parameters as MarketSellPreviewPayload);
    case 'repair': return repairPreview(state, transaction.content, parameters as ShipEconomicPayload);
    case 'resupply': return resupplyPreview(state, transaction.content, parameters as ShipEconomicPayload);
    case 'insurance.enhance': return insurancePreview(state, transaction.content, parameters as ShipEconomicPayload);
  }
}

function applyBuy(
  transaction: Transaction,
  draft: CampaignDraft,
  preview: MarketTransactionPreviewData,
): void {
  debitWallet(draft, preview.totalCredits);
  moveListingStock(draft, transaction, preview.stationId, preview.item.definitionId, 'stationSells', preview.quantity);

  if (preview.item.kind === 'hull') {
    for (let count = 0; count < preview.quantity; count += 1) {
      addPurchasedHull(draft, transaction, preview.stationId, preview.item.definitionId as HullId);
    }
  } else {
    inventoryService(draft, transaction.content).add(
      preview.destinationInventoryId!,
      preview.item.definitionId as DefinitionId,
      preview.quantity,
      { grantedQuantity: 0, purchasedQuantity: preview.quantity, purchaseCostCredits: preview.totalCredits },
    );
  }

  transaction.publish('market.transactionCommitted', {
    side: 'buy', stationId: preview.stationId, itemId: preview.item.definitionId,
    quantity: preview.quantity, totalCredits: preview.totalCredits,
  });
  invalidateMarketTransaction(transaction);
}

function applySell(
  transaction: Transaction,
  draft: CampaignDraft,
  preview: MarketTransactionPreviewData,
): void {
  inventoryService(draft, transaction.content).remove(preview.sourceStackId!, preview.quantity);
  creditWallet(draft, preview.totalCredits);
  moveListingStock(draft, transaction, preview.stationId, preview.item.definitionId, 'stationBuys', preview.quantity);
  transaction.publish('market.transactionCommitted', {
    side: 'sell', stationId: preview.stationId, itemId: preview.item.definitionId,
    quantity: preview.quantity, totalCredits: preview.totalCredits,
  });
  invalidateMarketTransaction(transaction);
}

function applyRepair(
  transaction: Transaction,
  draft: CampaignDraft,
  preview: RepairPreviewData,
): void {
  debitWallet(draft, preview.totalCredits);
  const ship = draft.assets.ships[preview.shipId]!;
  draft.assets.ships[preview.shipId] = {
    ...ship,
    condition: { ...ship.condition, damage: { shield: 0, armor: 0, hull: 0 } },
  };
  draft.assets.version += 1;
  transaction.publish('repair.completed', { shipId: preview.shipId, totalCredits: preview.totalCredits });
  for (const topic of ['assets', 'wallet', 'ship', 'repair'] as const) transaction.invalidate(topic);
}

function applyInsurance(
  transaction: Transaction,
  draft: CampaignDraft,
  preview: InsurancePreviewData,
): void {
  debitWallet(draft, preview.premiumCredits);
  const ship = draft.assets.ships[preview.shipId]!;
  draft.assets.ships[preview.shipId] = {
    ...ship,
    insurance: { coverage: 'enhanced', premiumPaidCredits: preview.premiumCredits },
  };
  draft.assets.version += 1;
  transaction.publish('insurance.enhancedPurchased', {
    shipId: preview.shipId, premiumCredits: preview.premiumCredits,
  });
  for (const topic of ['assets', 'wallet', 'ship', 'insurance'] as const) transaction.invalidate(topic);
}

function applyResupply(
  transaction: Transaction,
  draft: CampaignDraft,
  preview: ResupplyPreviewData,
): void {
  debitWallet(draft, preview.totalCredits);
  const ship = draft.assets.ships[preview.shipId]!;
  const service = inventoryService(draft, transaction.content);
  let boughtRounds = 0;
  for (const line of preview.lines) {
    if (line.ammunitionId === null) continue;
    const quantity = line.roundsFromInventory + line.roundsPurchased;
    if (quantity === 0) continue;
    const owned = consumeOwnedAmmunition(
      draft,
      service,
      preview.stationId,
      line.ammunitionId,
      line.roundsFromInventory,
    );
    service.addAs(
      ship.fittingInventoryId,
      line.ammunitionId as DefinitionId,
      quantity,
      {
        grantedQuantity: owned.grantedQuantity,
        purchasedQuantity: owned.purchasedQuantity + line.roundsPurchased,
        purchaseCostCredits: owned.purchaseCostCredits + line.totalCredits,
      },
      { kind: 'charge', slot: { kind: line.slot.kind as SlotKind, index: line.slot.index } },
    );
    if (line.roundsPurchased > 0) {
      moveListingStock(draft, transaction, preview.stationId, line.ammunitionId, 'stationSells', line.roundsPurchased);
      boughtRounds += line.roundsPurchased;
    }
  }
  transaction.publish('resupply.completed', {
    shipId: preview.shipId,
    rounds: preview.lines.reduce((sum, line) => sum + line.roundsFromInventory + line.roundsPurchased, 0),
    totalCredits: preview.totalCredits,
  });
  for (const topic of ['assets', 'inventory', 'wallet', 'ship', 'fitting'] as const) {
    transaction.invalidate(topic);
  }
  if (boughtRounds > 0) {
    transaction.invalidate('market');
    transaction.requestAutosave();
  }
  transaction.invalidate('resupply');
}

function consumeOwnedAmmunition(
  draft: CampaignDraft,
  service: ReturnType<typeof inventoryService>,
  stationId: string,
  ammunitionId: string,
  quantity: number,
): { grantedQuantity: number; purchasedQuantity: number; purchaseCostCredits: number } {
  const provenance = { grantedQuantity: 0, purchasedQuantity: 0, purchaseCostCredits: 0 };
  let remaining = quantity;
  for (const stackId of Object.keys(draft.assets.stacks).sort()) {
    if (remaining === 0) break;
    const stack = draft.assets.stacks[stackId];
    if (stack === undefined || stack.definitionId !== ammunitionId || stack.state.kind !== 'plain') continue;
    const inventory = requireInventory(draft.assets, stack.inventoryId);
    const atStation = inventory.location.kind === 'hangar'
      ? inventory.location.stationId === stationId
      : inventory.location.kind === 'cargo' &&
        draft.assets.ships[inventory.location.shipId]?.location.stationId === stationId;
    if (!atStation || !isLocalInventory(draft.assets, inventory)) continue;
    const removed = service.remove(stack.id, Math.min(remaining, stack.quantity));
    provenance.grantedQuantity += removed.provenance.grantedQuantity;
    provenance.purchasedQuantity += removed.provenance.purchasedQuantity;
    provenance.purchaseCostCredits += removed.provenance.purchaseCostCredits;
    remaining -= removed.quantity;
  }
  if (remaining !== 0) throw new InventoryError('insufficientItems');
  return provenance;
}

function moveListingStock(
  draft: CampaignDraft,
  transaction: Transaction,
  stationId: string,
  itemId: string,
  side: 'stationSells' | 'stationBuys',
  quantity: number,
): void {
  const station = draft.economy.stations[stationId];
  if (station === undefined) throw new EconomyError('stationNotFound');
  const listing = station.listings[itemId]!;
  station.listings[itemId] = applyStockMovement(
    listing,
    listingDefinition(transaction.content, stationId, itemId),
    side,
    quantity,
  );
}

function addPurchasedHull(
  draft: CampaignDraft,
  transaction: Transaction,
  stationId: string,
  hullId: HullId,
): void {
  const station = transaction.content.requireStation(stationId as StationId);
  const hull = transaction.content.requireHull(hullId);
  const shipId = allocateEntityId(draft);
  const inventories = inventoryService(draft, transaction.content);
  const cargoInventoryId = inventories.create(
    { kind: 'cargo', shipId },
    { kind: 'limited', volumeCubicDecimetres: hull.cargoCapacityCubicDecimetres },
  );
  const fittingInventoryId = inventories.create({ kind: 'fitting', shipId }, { kind: 'unlimited' });
  const location = { kind: 'station' as const, stationId: station.id, systemId: station.systemId };
  draft.assets.ships[shipId] = {
    id: shipId,
    hullId,
    cargoInventoryId,
    fittingInventoryId,
    location,
    condition: {
      damage: { shield: 0, armor: 0, hull: 0 },
      capacitorCharge: hull.capacitor.capacity,
    },
    insurance: { coverage: 'basic', premiumPaidCredits: 0 },
  };
  draft.assets.version += 1;
}

function invalidateMarketTransaction(transaction: Transaction): void {
  for (const topic of ['market', 'assets', 'inventory', 'wallet', 'ship', 'fitting'] as const) {
    transaction.invalidate(topic);
  }
  transaction.requestAutosave();
}
