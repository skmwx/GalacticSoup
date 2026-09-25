import {
  EconomyError,
  attributeValue,
  bulkQuote,
  deriveShipAttributes,
  isLocalInventory,
  listingDefinition,
  maximumThatFits,
  requireInventory,
  requireStack,
  requireStationEconomy,
  shipFit,
  unitQuote,
  type CampaignState,
  type EconomyServiceName,
  type MarketListingState,
} from '@engine/domain';
import type { ContentRepository, HullDefinition, MarketListingDefinition } from '@engine/ports';
import type {
  FormulaTraceData,
  InsurancePreviewData,
  MarketBuyPreviewPayload,
  MarketListingData,
  MarketListingsData,
  MarketSellPreviewPayload,
  MarketTransactionPreviewData,
  PreviewTokenData,
  RepairPreviewData,
  ResupplyLineData,
  ResupplyPreviewData,
  ShipEconomicPayload,
  StationServicesData,
  TransactionPreviewData,
} from '@protocol';
import { canonicalJson, deepFreeze, sha256Hex, type StationId } from '@shared';

import { itemDataOf } from './items';

/**
 * Immutable station, quote and formula views, including state-bound previews.
 * @implements MVP-AC-02, MVP-AC-06, FUNC-19.6, FUNC-22.10, TECH-7.3, TECH-7.4
 */

const REASON = {
  notDocked: 'station.unavailable.notDocked',
  service: 'station.unavailable.service',
  listing: 'market.unavailable.listing',
  stock: 'market.unavailable.insufficientStock',
  credits: 'market.unavailable.insufficientCredits',
  capacity: 'market.unavailable.insufficientCapacity',
  source: 'market.unavailable.sourceNotLocal',
  damaged: 'repair.unavailable.noDamage',
  supplied: 'resupply.unavailable.fullySupplied',
  ammunition: 'resupply.unavailable.noAmmunitionLoaded',
  enhanced: 'insurance.unavailable.alreadyEnhanced',
  recoverySale: 'market.unavailable.recoveryGrant',
  recoveryInsurance: 'insurance.unavailable.recoveryGrant',
} as const;

export function stationServicesProjection(
  state: CampaignState,
  content: ContentRepository,
  stationId: string,
): StationServicesData {
  const station = content.station(stationId);
  if (station === undefined) throw new EconomyError('stationNotFound');
  const economy = requireStationEconomy(state.economy, stationId);
  const docked = state.assets.location.kind === 'station' && state.assets.location.stationId === stationId;
  const names = ['market', 'fitting', 'repair', 'resupply', 'insurance'] as const;
  return deepFreeze({
    revision: state.revision,
    stationId,
    nameKey: station.nameKey,
    docked,
    serviceModifier: station.serviceModifier,
    services: names.map((service) => {
      const authored = service === 'fitting'
        ? station.services.includes('fitting')
        : economy.services[service].available;
      return {
        service,
        available: docked && authored,
        unavailableReason: !docked ? REASON.notDocked : authored ? null : REASON.service,
      };
    }),
  });
}

export function marketListingsProjection(
  state: CampaignState,
  content: ContentRepository,
  stationId: string,
): MarketListingsData {
  const station = content.station(stationId);
  if (station === undefined) throw new EconomyError('stationNotFound');
  const economy = requireStationEconomy(state.economy, stationId);
  const docked = state.assets.location.kind === 'station' && state.assets.location.stationId === stationId;
  const marketAvailable = economy.services.market.available;
  const unavailableReason = !docked ? REASON.notDocked : marketAvailable ? null : REASON.service;

  const listings: MarketListingData[] = content.listings(stationId).map((definition) => {
    const listing = economy.listings[definition.itemId];
    if (listing === undefined) throw new EconomyError('listingNotFound');
    const stationSells = unitQuote(content, definition, listing, 'stationSells');
    const stationBuys = unitQuote(content, definition, listing, 'stationBuys');
    return {
      item: marketItemData(content, definition.itemId),
      supply: definition.supply,
      stock: definition.supply === 'fixed' ? null : listing.stock,
      stationSellPriceCredits: stationSells.unitPriceCredits,
      stationBuyPriceCredits: stationBuys.unitPriceCredits,
      stationSellTrace: stationSells.trace,
      stationBuyTrace: stationBuys.trace,
      available: unavailableReason === null,
      unavailableReason,
    };
  });

  return deepFreeze({
    revision: state.revision,
    stationId,
    simulationHour: Math.floor(state.time.simulationTimeMs / 3_600_000),
    listings,
    unavailableReason,
  });
}

export function marketBuyPreview(
  state: CampaignState,
  content: ContentRepository,
  payload: MarketBuyPreviewPayload,
): MarketTransactionPreviewData {
  const { definition, listing } = marketContext(state, content, payload.stationId, payload.itemId);
  const item = marketItemData(content, payload.itemId);
  const isHull = item.kind === 'hull';
  const destination = isHull
    ? null
    : payload.destinationInventoryId ?? stationHangarId(state, payload.stationId);
  let unavailableReason = serviceReason(state, payload.stationId, 'market');
  let quote: ReturnType<typeof bulkQuote> | null = null;

  try {
    quote = bulkQuote(content, definition, listing, 'stationSells', payload.quantity);
  } catch (error: unknown) {
    if (error instanceof EconomyError && error.reason === 'insufficientStock') unavailableReason ??= REASON.stock;
    else throw error;
  }

  if (!isHull && destination !== null) {
    const inventory = requireInventory(state.assets, destination);
    if (!isLocalInventory(state.assets, inventory) || !inventoryAtStation(state, inventory.id, payload.stationId)) {
      unavailableReason ??= REASON.source;
    } else if (payload.quantity > maximumThatFits(state.assets, content, destination, payload.itemId)) {
      unavailableReason ??= REASON.capacity;
    }
  }
  if (quote !== null && quote.totalCredits > state.assets.credits) unavailableReason ??= REASON.credits;

  const trace = quote?.firstUnitTrace ?? unitQuote(content, definition, listing, 'stationSells').trace;
  const base: MarketTransactionPreviewData = {
    action: 'market.buy',
    available: unavailableReason === null && quote !== null,
    unavailableReason,
    token: null,
    walletDeltaCredits: -(quote?.totalCredits ?? 0),
    totalCredits: quote?.totalCredits ?? 0,
    traces: quote === null ? [trace] : tracesOf(quote),
    stationId: payload.stationId,
    item,
    quantity: payload.quantity,
    sourceStackId: null,
    destinationInventoryId: destination,
    averageUnitPriceCredits: quote?.averageUnitPriceCredits ?? 0,
    firstUnitPriceCredits: quote?.firstUnitPriceCredits ?? 0,
    lastUnitPriceCredits: quote?.lastUnitPriceCredits ?? 0,
    initialStock: definition.supply === 'fixed' ? null : listing.stock,
    remainingStock: quote?.remainingStock ?? (definition.supply === 'fixed' ? null : listing.stock),
    priceMovementCredits: quote?.priceMovementCredits ?? 0,
    cargoVolumeDeltaCubicDecimetres: isHull ? 0 : item.unitVolumeCubicDecimetres * payload.quantity,
  };
  return deepFreeze(bindIfAvailable(state, base, payload, versions(state, payload.stationId, 'market', listing)));
}

export function marketSellPreview(
  state: CampaignState,
  content: ContentRepository,
  payload: MarketSellPreviewPayload,
): MarketTransactionPreviewData {
  const stack = requireStack(state.assets, payload.stackId);
  const { definition, listing } = marketContext(state, content, payload.stationId, stack.definitionId);
  const quote = bulkQuote(content, definition, listing, 'stationBuys', payload.quantity);
  let unavailableReason = serviceReason(state, payload.stationId, 'market');
  const inventory = requireInventory(state.assets, stack.inventoryId);
  if (stack.state.kind !== 'plain' || payload.quantity > stack.quantity ||
      !isLocalInventory(state.assets, inventory) || !inventoryAtStation(state, inventory.id, payload.stationId)) {
    unavailableReason ??= REASON.source;
  }
  // Recovery-grant units have no sale value (Functional Specification 9.12).
  if (stack.recoveryGrant) unavailableReason ??= REASON.recoverySale;
  const base: MarketTransactionPreviewData = {
    action: 'market.sell',
    available: unavailableReason === null,
    unavailableReason,
    token: null,
    walletDeltaCredits: quote.totalCredits,
    totalCredits: quote.totalCredits,
    traces: tracesOf(quote),
    stationId: payload.stationId,
    item: marketItemData(content, stack.definitionId),
    quantity: payload.quantity,
    sourceStackId: stack.id,
    destinationInventoryId: null,
    averageUnitPriceCredits: quote.averageUnitPriceCredits,
    firstUnitPriceCredits: quote.firstUnitPriceCredits,
    lastUnitPriceCredits: quote.lastUnitPriceCredits,
    initialStock: quote.initialStock,
    remainingStock: quote.remainingStock,
    priceMovementCredits: quote.priceMovementCredits,
    cargoVolumeDeltaCubicDecimetres: -content.requireTradeable(stack.definitionId).volumeCubicDecimetres * payload.quantity,
  };
  return deepFreeze(bindIfAvailable(state, base, payload, versions(state, payload.stationId, 'market', listing)));
}

export function repairPreview(
  state: CampaignState,
  content: ContentRepository,
  payload: ShipEconomicPayload,
): RepairPreviewData {
  const ship = requireShip(state, payload.shipId);
  const station = content.requireStation(stationForShip(ship.location, content));
  const hull = content.requireHull(ship.hullId);
  const derived = deriveShipAttributes({ hull, fit: shipFit(state.assets, ship.id), content });
  const armorMaximum = attributeValue(derived, 'armorHitPoints');
  const hullMaximum = attributeValue(derived, 'hullHitPoints');
  const missingArmorFraction = armorMaximum === 0 ? 0 : ship.condition.damage.armor / armorMaximum;
  const missingHullFraction = hullMaximum === 0 ? 0 : ship.condition.damage.hull / hullMaximum;
  const rules = content.rules.economy;
  const standingServiceMultiplier = 1;
  const unrounded = hull.referenceValueCredits *
    (rules.repairArmorFraction * missingArmorFraction + rules.repairHullFraction * missingHullFraction) *
    station.serviceModifier * standingServiceMultiplier;
  const total = Math.ceil(unrounded);
  let unavailableReason = serviceReason(state, station.id, 'repair');
  const damaged = Object.values(ship.condition.damage).some((amount) => amount > 0);
  if (!damaged) unavailableReason ??= REASON.damaged;
  if (total > state.assets.credits) unavailableReason ??= REASON.credits;
  const trace: FormulaTraceData = {
    formulaKey: 'repair.totalPrice',
    operands: [
      { key: 'hullReferenceValueCredits', value: hull.referenceValueCredits },
      { key: 'armorRepairFraction', value: rules.repairArmorFraction },
      { key: 'missingArmorFraction', value: missingArmorFraction },
      { key: 'hullRepairFraction', value: rules.repairHullFraction },
      { key: 'missingHullFraction', value: missingHullFraction },
      { key: 'stationServiceModifier', value: station.serviceModifier },
      { key: 'standingServiceMultiplier', value: standingServiceMultiplier },
    ],
    unroundedResult: unrounded,
    displayResult: total,
  };
  const base: RepairPreviewData = {
    action: 'repair', available: unavailableReason === null, unavailableReason, token: null,
    walletDeltaCredits: -total, totalCredits: total, traces: [trace], stationId: station.id,
    shipId: ship.id, shieldDamage: ship.condition.damage.shield, armorDamage: ship.condition.damage.armor,
    hullDamage: ship.condition.damage.hull, missingArmorFraction, missingHullFraction,
    serviceModifier: station.serviceModifier, standingServiceMultiplier,
  };
  return deepFreeze(bindIfAvailable(state, base, payload, versions(state, station.id, 'repair')));
}

export function insurancePreview(
  state: CampaignState,
  content: ContentRepository,
  payload: ShipEconomicPayload,
): InsurancePreviewData {
  const ship = requireShip(state, payload.shipId);
  const stationId = stationForShip(ship.location, content);
  const hull = content.requireHull(ship.hullId);
  const rules = content.rules.economy;
  const premium = Math.ceil(hull.referenceValueCredits * rules.enhancedInsurancePremiumFraction);
  let unavailableReason = serviceReason(state, stationId, 'insurance');
  // A recovery-grant hull has no insurance value (Functional Specification 9.12).
  if (ship.recoveryGrant) unavailableReason ??= REASON.recoveryInsurance;
  if (ship.insurance.coverage === 'enhanced') unavailableReason ??= REASON.enhanced;
  if (premium > state.assets.credits) unavailableReason ??= REASON.credits;
  const trace: FormulaTraceData = {
    formulaKey: 'insurance.enhancedPremium',
    operands: [
      { key: 'hullReferenceValueCredits', value: hull.referenceValueCredits },
      { key: 'premiumFraction', value: rules.enhancedInsurancePremiumFraction },
    ],
    unroundedResult: hull.referenceValueCredits * rules.enhancedInsurancePremiumFraction,
    displayResult: premium,
  };
  const base: InsurancePreviewData = {
    action: 'insurance.enhance', available: unavailableReason === null, unavailableReason, token: null,
    walletDeltaCredits: -premium, totalCredits: premium, traces: [trace], stationId, shipId: ship.id,
    currentCoverage: ship.insurance.coverage, resultingCoverage: 'enhanced',
    // The same whole-credit settlement destruction pays (Functional Specification 4.1, 9.12).
    basicPayoutCredits: ship.recoveryGrant ? 0
      : Math.floor(hull.referenceValueCredits * rules.basicInsurancePayoutFraction),
    enhancedPayoutCredits: ship.recoveryGrant ? 0
      : Math.floor(hull.referenceValueCredits * rules.enhancedInsurancePayoutFraction),
    premiumCredits: premium,
  };
  return deepFreeze(bindIfAvailable(state, base, payload, versions(state, stationId, 'insurance')));
}

export function resupplyPreview(
  state: CampaignState,
  content: ContentRepository,
  payload: ShipEconomicPayload,
): ResupplyPreviewData {
  const ship = requireShip(state, payload.shipId);
  const stationId = stationForShip(ship.location, content);
  let unavailableReason = serviceReason(state, stationId, 'resupply');
  let total = 0;
  const traces: FormulaTraceData[] = [];
  const lines: ResupplyLineData[] = [];
  const virtual = new Map<string, MarketListingState>();
  const touched = new Map<string, MarketListingState>();
  const availableOwned = new Map(
    Object.values(state.assets.stacks)
      .filter((stack) => stack.state.kind === 'plain' &&
        inventoryAtStation(state, stack.inventoryId, stationId))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((stack) => [stack.id, stack.quantity]),
  );

  for (const fitted of shipFit(state.assets, ship.id)) {
    const module = content.module(fitted.moduleId);
    if (module?.category !== 'turret') continue;
    const magazineSize = module.turret.magazineSize;
    if (fitted.charge === null) {
      lines.push({ slot: { ...fitted.slot }, ammunitionId: null, ammunitionNameKey: null,
        loadedRounds: 0, magazineSize,
        roundsFromInventory: 0, roundsPurchased: 0, totalCredits: 0,
        unavailableReason: REASON.ammunition });
      continue;
    }
    const missing = Math.max(0, magazineSize - fitted.charge.quantity);
    if (missing === 0) {
      lines.push({ slot: { ...fitted.slot }, ammunitionId: fitted.charge.ammunitionId,
        ammunitionNameKey: content.requireAmmunition(fitted.charge.ammunitionId).nameKey,
        loadedRounds: fitted.charge.quantity, magazineSize, roundsPurchased: 0,
        roundsFromInventory: 0,
        totalCredits: 0, unavailableReason: null });
      continue;
    }
    const roundsFromInventory = allocateOwnedRounds(
      state,
      fitted.charge.ammunitionId,
      missing,
      availableOwned,
    );
    const roundsPurchased = missing - roundsFromInventory;
    if (roundsPurchased === 0) {
      lines.push({ slot: { ...fitted.slot }, ammunitionId: fitted.charge.ammunitionId,
        ammunitionNameKey: content.requireAmmunition(fitted.charge.ammunitionId).nameKey,
        loadedRounds: fitted.charge.quantity, magazineSize, roundsFromInventory,
        roundsPurchased: 0, totalCredits: 0, unavailableReason: null });
      continue;
    }
    try {
      const context = marketContext(state, content, stationId, fitted.charge.ammunitionId);
      const current = virtual.get(fitted.charge.ammunitionId) ?? context.listing;
      const quote = bulkQuote(content, context.definition, current, 'stationSells', roundsPurchased);
      virtual.set(fitted.charge.ammunitionId,
        { ...current, stock: quote.remainingStock ?? current.stock });
      touched.set(fitted.charge.ammunitionId, context.listing);
      total += quote.totalCredits;
      traces.push(...tracesOf(quote));
      lines.push({ slot: { ...fitted.slot }, ammunitionId: fitted.charge.ammunitionId,
        ammunitionNameKey: content.requireAmmunition(fitted.charge.ammunitionId).nameKey,
        loadedRounds: fitted.charge.quantity, magazineSize, roundsPurchased,
        roundsFromInventory,
        totalCredits: quote.totalCredits, unavailableReason: null });
    } catch (error: unknown) {
      if (!(error instanceof EconomyError)) throw error;
      unavailableReason ??= error.reason === 'insufficientStock' ? REASON.stock : REASON.listing;
      lines.push({ slot: { ...fitted.slot }, ammunitionId: fitted.charge.ammunitionId,
        ammunitionNameKey: content.requireAmmunition(fitted.charge.ammunitionId).nameKey,
        loadedRounds: fitted.charge.quantity, magazineSize, roundsPurchased: 0,
        roundsFromInventory, totalCredits: 0, unavailableReason });
    }
  }
  if (!lines.some((line) => line.roundsFromInventory + line.roundsPurchased > 0)) {
    unavailableReason ??= REASON.supplied;
  }
  if (total > state.assets.credits) unavailableReason ??= REASON.credits;
  const related = [...touched.values()];
  const base: ResupplyPreviewData = {
    action: 'resupply', available: unavailableReason === null, unavailableReason, token: null,
    walletDeltaCredits: -total, totalCredits: total, traces, stationId, shipId: ship.id, lines,
  };
  return deepFreeze(bindIfAvailable(state, base, payload, versions(state, stationId, 'resupply', ...related)));
}

export function previewTokenMatches(token: PreviewTokenData, replacement: TransactionPreviewData): boolean {
  const current = replacement.token;
  return current !== null && token.action === current.action &&
    token.canonicalParameters === current.canonicalParameters &&
    canonicalJson(token.relevantVersions) === canonicalJson(current.relevantVersions) &&
    token.valuesHash === current.valuesHash;
}

function bindIfAvailable<T extends TransactionPreviewData>(
  state: CampaignState,
  preview: T,
  parameters: object,
  relevantVersions: Readonly<Record<string, number>>,
): T {
  if (!preview.available) return preview;
  const canonicalParameters = canonicalJson(parameters);
  const valuesHash = sha256Hex(canonicalJson(preview));
  const token: PreviewTokenData = {
    action: preview.action,
    canonicalParameters,
    campaignRevision: state.revision,
    relevantVersions,
    valuesHash,
  };
  return { ...preview, token };
}

function versions(
  state: CampaignState,
  stationId: string,
  service: EconomyServiceName,
  ...listings: readonly MarketListingState[]
): Readonly<Record<string, number>> {
  const station = requireStationEconomy(state.economy, stationId);
  const values: Record<string, number> = {
    assets: state.assets.version,
    [`service:${stationId}:${service}`]: station.services[service].version,
  };
  for (const listing of listings) values[`listing:${stationId}:${listing.itemId}`] = listing.version;
  return values;
}

function marketContext(state: CampaignState, content: ContentRepository, stationId: string, itemId: string): {
  station: ReturnType<typeof requireStationEconomy>;
  definition: MarketListingDefinition;
  listing: MarketListingState;
} {
  const station = requireStationEconomy(state.economy, stationId);
  const definition = listingDefinition(content, stationId, itemId);
  const listing = station.listings[itemId];
  if (listing === undefined) throw new EconomyError('listingNotFound');
  return { station, definition, listing };
}

function serviceReason(
  state: CampaignState,
  stationId: string,
  service: EconomyServiceName,
): string | null {
  if (state.assets.location.kind !== 'station' || state.assets.location.stationId !== stationId) return REASON.notDocked;
  return requireStationEconomy(state.economy, stationId).services[service].available ? null : REASON.service;
}

function stationHangarId(state: CampaignState, stationId: string): string {
  const inventory = Object.values(state.assets.inventories).find(
    (candidate) => candidate.location.kind === 'hangar' && candidate.location.stationId === stationId,
  );
  if (inventory === undefined) throw new EconomyError('stationNotFound');
  return inventory.id;
}

function inventoryAtStation(state: CampaignState, inventoryId: string, stationId: string): boolean {
  const inventory = requireInventory(state.assets, inventoryId);
  if (inventory.location.kind === 'hangar') return inventory.location.stationId === stationId;
  if (inventory.location.kind === 'cargo') {
    const location = state.assets.ships[inventory.location.shipId]?.location;
    return location?.kind === 'station' && location.stationId === stationId;
  }
  return false;
}

function stationForShip(
  location: CampaignState['assets']['location'],
  content: ContentRepository,
): StationId {
  if (location.kind === 'station') return location.stationId;
  return content.stations().find((station) => station.systemId === location.systemId)?.id ??
    content.rules.economy.startingStationId as StationId;
}

function allocateOwnedRounds(
  state: CampaignState,
  ammunitionId: string,
  required: number,
  remaining: Map<string, number>,
): number {
  let allocated = 0;
  for (const stackId of [...remaining.keys()].sort()) {
    const stack = state.assets.stacks[stackId];
    const available = remaining.get(stackId) ?? 0;
    if (stack?.definitionId !== ammunitionId || available === 0) continue;
    const taken = Math.min(required - allocated, available);
    remaining.set(stackId, available - taken);
    allocated += taken;
    if (allocated === required) break;
  }
  return allocated;
}

function requireShip(state: CampaignState, shipId: string) {
  const ship = state.assets.ships[shipId];
  if (ship === undefined) throw new EconomyError('invalidPreview');
  return ship;
}

function marketItemData(content: ContentRepository, itemId: string): MarketTransactionPreviewData['item'] {
  const tradeable = content.tradeable(itemId);
  if (tradeable !== undefined) return itemDataOf(tradeable, content);
  const hull = content.hull(itemId);
  if (hull === undefined) throw new EconomyError('listingNotFound');
  return hullData(hull);
}

function hullData(hull: HullDefinition): MarketTransactionPreviewData['item'] {
  return { definitionId: hull.id, nameKey: hull.nameKey, descriptionKey: hull.descriptionKey,
    kind: 'hull', unitVolumeCubicDecimetres: 0, referenceValueCredits: hull.referenceValueCredits };
}

function tracesOf(quote: ReturnType<typeof bulkQuote>): readonly FormulaTraceData[] {
  return quote.quantity === 1 || canonicalJson(quote.firstUnitTrace) === canonicalJson(quote.lastUnitTrace)
    ? [quote.firstUnitTrace]
    : [quote.firstUnitTrace, quote.lastUnitTrace];
}
