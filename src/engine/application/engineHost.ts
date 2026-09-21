import { EconomyError, InventoryError, type CampaignState } from '@engine/domain';
import { assetsProjection, walletProjection, hangarProjection, cargoProjection,
  itemInspectionProjection, maximumInventoryProjection, comparisonProjection,
  fittingDraftProjection, shipProjection, undockValidityProjection } from '@engine/projections';
import { insurancePreview, marketBuyPreview, marketListingsProjection, marketSellPreview,
  repairPreview, resupplyPreview, stationServicesProjection } from '@engine/projections';
import { combatProjection, destinationsProjection, siteProjection } from '@engine/projections';
import { encounterProjection, wreckContentsProjection } from '@engine/projections';
import type { HangarPayload, CargoPayload, StackPayload, MaximumInventoryPayload,
  ComparePayload, ShipPayload } from '@protocol';
import type { MarketBuyPreviewPayload, MarketSellPreviewPayload, ShipEconomicPayload,
  StationPayload } from '@protocol';
import type { ContentMessagesPayload, WreckPayload } from '@protocol';
import {
  ContentIntegrityError,
  ContentLookupError,
  type ContentRepository,
  type SaveRetention,
  type SaveStore,
} from '@engine/ports';
import {
  type ClientRequest,
  type CloseCampaignPayload,
  type CommandResultData,
  type CommandType,
  type CreateCampaignPayload,
  type EngineResponse,
  type RequestType,
  type SaveCampaignPayload,
  contentErrorMessageKey,
  createEngineError,
  failureResponse,
  findTransportViolation,
  internalError,
  isCommandType,
  isPersistenceType,
  NO_CAMPAIGN_REVISION,
  PROTOCOL_VERSION,
  readRequestId,
  ruleViolation,
  staleRevision,
  successResponse,
  validateClientRequest,
} from '@protocol';

import { runCommand } from './pipeline';
import { createRecentRequests, type RecentRequests } from './recentRequests';
import {
  handleCapabilities,
  handleContentMessages,
  handleContentSummary,
  handleFrame,
  handleHealth,
  handleSession,
  handleStateHash,
  type HandlerContext,
} from './handlers';
import { createSaveService, type SaveService } from './saves';
import { ENGINE_VERSION } from './version';

/**
 * The engine host: the single entry point through which any transport reaches
 * the engine (Technical Specification 4.1, 4.2, 7.2).
 *
 * It owns the open campaign for the lifetime of the session, processes one
 * request at a time and always answers with a transport-safe response.
 * Expected failures are returned as error responses; an unexpected throw is
 * contained here and reported as `INTERNAL_ERROR` so it cannot cross the
 * worker boundary as an exception.
 *
 * Requests are serialised: reaching persistence makes handling asynchronous,
 * and two commands must never interleave over one campaign. The queue is the
 * host's, not the transport's, so the guarantee holds however messages arrive.
 *
 * @implements TECH-2, TECH-4.1, TECH-7.1, TECH-7.2
 */
export interface EngineHost {
  readonly engineVersion: string;
  readonly protocolVersion: number;
  handle(message: unknown): Promise<EngineResponse<unknown>>;
}

export interface EngineHostOptions {
  /**
   * Authored content. The engine cannot run without it, so the host takes it
   * rather than discovering it: the worker supplies the compiled bundle and a
   * test supplies whichever pack the case needs.
   */
  readonly content: ContentRepository;
  /**
   * Durable storage for snapshots. The engine orchestrates saving; where the
   * bytes go is the adapter's business (Technical Specification 4.1, 11).
   */
  readonly saves: SaveStore;
  /** Overridable so tests can assert version reporting without a rebuild. */
  readonly engineVersion?: string;
  /** Size of the duplicate-request cache. */
  readonly recentRequestLimit?: number;
  readonly slotId?: string;
  readonly retention?: SaveRetention;
}

interface Session {
  campaign: CampaignState | null;
  readonly content: ContentRepository;
  readonly engineVersion: string;
  readonly recent: RecentRequests;
  readonly saves: SaveService;
}

export function createEngineHost(options: EngineHostOptions): EngineHost {
  const engineVersion = options.engineVersion ?? ENGINE_VERSION;
  const session: Session = {
    campaign: null,
    content: options.content,
    engineVersion,
    recent:
      options.recentRequestLimit === undefined
        ? createRecentRequests()
        : createRecentRequests(options.recentRequestLimit),
    saves: createSaveService({
      store: options.saves,
      content: options.content,
      engineVersion,
      protocolVersion: PROTOCOL_VERSION,
      ...(options.slotId === undefined ? {} : { slotId: options.slotId }),
      ...(options.retention === undefined ? {} : { retention: options.retention }),
    }),
  };

  let queue: Promise<unknown> = Promise.resolve();

  return {
    engineVersion: session.engineVersion,
    protocolVersion: PROTOCOL_VERSION,
    handle(message: unknown): Promise<EngineResponse<unknown>> {
      const run = queue.then(() =>
        dispatch(session, message).catch(() =>
          failureResponse(readRequestId(message), internalError({ stage: 'dispatch' })),
        ),
      );
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

async function dispatch(session: Session, message: unknown): Promise<EngineResponse<unknown>> {
  const validation = validateClientRequest(message);
  if (!validation.ok) {
    return failureResponse(validation.requestId, validation.error);
  }

  const request = validation.request;
  const response = await route(session, request);

  const violation = findTransportViolation(response);
  if (violation !== null) {
    return failureResponse(
      request.requestId,
      internalError({ type: request.type, path: violation.path, reason: violation.reason }),
    );
  }

  return response;
}

async function route(
  session: Session,
  request: ClientRequest<RequestType, unknown>,
): Promise<EngineResponse<unknown>> {
  const { requestId, type } = request;
  const revision = session.campaign?.revision ?? NO_CAMPAIGN_REVISION;

  if (isCommandType(type) || isPersistenceType(type)) {
    const remembered = session.recent.find(requestId);
    if (remembered !== undefined) {
      return remembered;
    }
  }

  const campaignError = checkCampaign(session, request);
  if (campaignError !== null) {
    return campaignError;
  }

  if (isPersistenceType(type)) {
    return executeSave(session, requestId, request.payload as SaveCampaignPayload);
  }

  if (isCommandType(type)) {
    const expected = request.expectedRevision;
    if (expected !== undefined && expected !== revision) {
      return failureResponse(requestId, staleRevision({ expected, actual: revision }), revision);
    }
    return executeCommand(session, requestId, type, request.payload);
  }

  if (type === 'campaign.saves') {
    return successResponse(requestId, revision, await session.saves.slot());
  }

  if (isCampaignQuery(type) && session.campaign === null) {
    return failureResponse(requestId, ruleViolation('noCampaignOpen'), revision);
  }

  try {
    return successResponse(requestId, revision, query(session, type, request.payload));
  } catch (error: unknown) {
    return failureResponse(requestId, describeFailure(type, error), revision);
  }
}

/**
 * Takes a snapshot on request (Technical Specification 11.3).
 *
 * The capture happens now, at the revision the campaign is at; the write is
 * queued and the response reports that it is pending. Simulation is never
 * held up waiting for storage.
 */
async function executeSave(
  session: Session,
  requestId: string,
  payload: SaveCampaignPayload,
): Promise<EngineResponse<unknown>> {
  const revision = session.campaign?.revision ?? NO_CAMPAIGN_REVISION;
  if (session.campaign === null) {
    return failureResponse(requestId, ruleViolation('noCampaignOpen'), revision);
  }

  const status = await session.saves.save(session.campaign, payload.kind, payload.savedAtRealMs);
  const response = successResponse(requestId, revision, status);
  session.recent.remember(requestId, response);
  return response;
}

async function executeCommand(
  session: Session,
  requestId: string,
  type: CommandType,
  payload: unknown,
): Promise<EngineResponse<unknown>> {
  let commandPayload = payload;

  if (type === 'campaign.resume') {
    if (session.campaign !== null) {
      return failureResponse(
        requestId,
        ruleViolation('campaignAlreadyOpen'),
        session.campaign.revision,
      );
    }
    const resumed = await session.saves.resume();
    if (!resumed.ok) {
      return failureResponse(requestId, resumed.error, NO_CAMPAIGN_REVISION);
    }
    commandPayload = { state: resumed.loaded.state };
  }

  if (type === 'campaign.close') {
    if (session.campaign === null) {
      return failureResponse(requestId, ruleViolation('noCampaignOpen'), NO_CAMPAIGN_REVISION);
    }
    // Closing must leave a durable campaign behind, so the snapshot is taken
    // and written before the campaign leaves the session.
    await session.saves.save(
      session.campaign,
      'auto',
      (payload as CloseCampaignPayload).savedAtRealMs,
    );
    await session.saves.drain();
  }

  const result = runCommand({
    campaign: session.campaign,
    content: session.content,
    type,
    payload: commandPayload,
  });

  if (result.kind === 'failed') {
    return failureResponse(
      requestId,
      result.error,
      session.campaign?.revision ?? NO_CAMPAIGN_REVISION,
    );
  }

  if (result.kind === 'committed') {
    if (result.campaign === null) {
      // The campaign left the session. Its remembered results describe a
      // campaign that is no longer open, so they are forgotten before this
      // one is recorded.
      session.recent.clear();
    }
    session.campaign = result.campaign;
  }

  if (type === 'campaign.reset' && result.kind === 'committed') {
    // Reset discards the campaign, and a discarded campaign keeps no saves.
    await session.saves.clear();
  }

  const data = await fulfilAutosave(session, type, payload, result.data, result.kind);
  const revision = session.campaign?.revision ?? NO_CAMPAIGN_REVISION;
  const response = successResponse(requestId, revision, data);

  if (result.kind === 'committed') {
    session.recent.remember(requestId, response);
  }

  return response;
}

/**
 * Answers an autosave trigger (Technical Specification 11.3).
 *
 * The trigger is emitted only after the transaction commits. The engine has no
 * wall clock, so it can only take the snapshot itself when the request that
 * triggered it supplied a real timestamp. Otherwise the trigger travels to the
 * client, which stamps and sends `campaign.save`.
 */
async function fulfilAutosave(
  session: Session,
  type: CommandType,
  payload: unknown,
  data: CommandResultData,
  kind: 'committed' | 'unchanged',
): Promise<CommandResultData> {
  if (kind !== 'committed' || !data.autosaveRequested || session.campaign === null) {
    return data;
  }

  const savedAtRealMs = realTimeOf(type, payload);
  if (savedAtRealMs === null) {
    return data;
  }

  await session.saves.save(session.campaign, 'auto', savedAtRealMs);
  await session.saves.drain();
  return { ...data, autosaveRequested: false };
}

/** The wall-clock stamp a request carried, or `null` when it carried none. */
function realTimeOf(type: CommandType, payload: unknown): number | null {
  switch (type) {
    case 'campaign.create':
      return (payload as CreateCampaignPayload).createdAtRealMs;
    case 'campaign.close':
      return (payload as CloseCampaignPayload).savedAtRealMs;
    default:
      return null;
  }
}

function checkCampaign(
  session: Session,
  request: ClientRequest<RequestType, unknown>,
): EngineResponse<unknown> | null {
  const campaignId = request.campaignId;
  if (campaignId === undefined) {
    return null;
  }

  const revision = session.campaign?.revision ?? NO_CAMPAIGN_REVISION;
  if (session.campaign === null) {
    return failureResponse(request.requestId, ruleViolation('noCampaignOpen'), revision);
  }
  if (session.campaign.campaignId !== campaignId) {
    return failureResponse(
      request.requestId,
      ruleViolation('campaignMismatch', { expected: session.campaign.campaignId }),
      revision,
    );
  }
  return null;
}

/** Queries that read a campaign and therefore need one to be open. */
function isCampaignQuery(type: RequestType): boolean {
  return [
    'assets.list', 'wallet.get', 'inventory.hangar', 'inventory.cargo', 'item.inspect',
    'inventory.maximum', 'ship.get', 'ship.undockValidity', 'fitting.draft', 'item.compare',
    'station.services', 'market.listings', 'market.previewBuy', 'market.previewSell',
    'repair.preview', 'resupply.preview', 'insurance.preview',
    'navigation.destinations', 'navigation.site', 'combat.state',
    'encounter.state', 'loot.contents',
  ].includes(type);
}

function query(session: Session, type: RequestType, payload: unknown): unknown {
  const context: HandlerContext = {
    engineVersion: session.engineVersion,
    protocolVersion: PROTOCOL_VERSION,
    content: session.content,
    campaign: session.campaign,
  };

  switch (type) {
    case 'navigation.destinations':
      return destinationsProjection(session.campaign!, session.content);
    case 'navigation.site':
      return siteProjection(session.campaign!, session.content);
    case 'combat.state':
      return combatProjection(session.campaign!, session.content);
    case 'encounter.state':
      return encounterProjection(session.campaign!, session.content);
    case 'loot.contents':
      return wreckContentsProjection(
        session.campaign!,
        session.content,
        (payload as WreckPayload).wreckId,
      );
    case 'assets.list': return assetsProjection(session.campaign!, session.content);
    case 'wallet.get': return walletProjection(session.campaign!);
    case 'inventory.hangar': return hangarProjection(session.campaign!, session.content, (payload as HangarPayload).stationId);
    case 'inventory.cargo': return cargoProjection(session.campaign!, session.content, (payload as CargoPayload).shipId);
    case 'item.inspect': return itemInspectionProjection(session.campaign!, session.content, (payload as StackPayload).stackId);
    case 'inventory.maximum': {
      const p = payload as MaximumInventoryPayload;
      return maximumInventoryProjection(session.campaign!, session.content, p.stackId, p.destinationInventoryId);
    }
    case 'ship.get': return shipProjection(session.campaign!, session.content, (payload as ShipPayload).shipId);
    case 'ship.undockValidity':
      return undockValidityProjection(session.campaign!, session.content, (payload as ShipPayload).shipId);
    case 'fitting.draft': return fittingDraftProjection(session.campaign!, session.content);
    case 'item.compare': {
      const p = payload as ComparePayload;
      return comparisonProjection(session.campaign!, session.content, p.definitionId, p.againstDefinitionId);
    }
    case 'station.services':
      return stationServicesProjection(session.campaign!, session.content, (payload as StationPayload).stationId);
    case 'market.listings':
      return marketListingsProjection(session.campaign!, session.content, (payload as StationPayload).stationId);
    case 'market.previewBuy':
      return marketBuyPreview(session.campaign!, session.content, payload as MarketBuyPreviewPayload);
    case 'market.previewSell':
      return marketSellPreview(session.campaign!, session.content, payload as MarketSellPreviewPayload);
    case 'repair.preview':
      return repairPreview(session.campaign!, session.content, payload as ShipEconomicPayload);
    case 'resupply.preview':
      return resupplyPreview(session.campaign!, session.content, payload as ShipEconomicPayload);
    case 'insurance.preview':
      return insurancePreview(session.campaign!, session.content, payload as ShipEconomicPayload);
    case 'system.health':
      return handleHealth(context);
    case 'system.capabilities':
      return handleCapabilities(context);
    case 'content.summary':
      return handleContentSummary(context);
    case 'content.messages':
      return handleContentMessages(context, payload as ContentMessagesPayload);
    case 'campaign.session':
      return handleSession(context);
    case 'campaign.frame':
      return handleFrame(context);
    case 'diagnostics.stateHash':
      return handleStateHash(context);
    default:
      throw new Error(`Unhandled query type: ${String(type)}`);
  }
}

/**
 * Turns a thrown engine error into its protocol code. A missing definition and
 * an untrustworthy bundle are expected, explainable failures, not internal
 * ones (Technical Specification 5.4).
 */
function describeFailure(type: RequestType, error: unknown): ReturnType<typeof internalError> {
  if (error instanceof InventoryError) {
    const failure = ruleViolation(error.reason);
    return error.reason === 'itemNotFound' || error.reason === 'inventoryNotFound'
      ? { ...failure, code: 'NOT_FOUND' } : failure;
  }
  if (error instanceof EconomyError) {
    return error.reason === 'stationNotFound' || error.reason === 'listingNotFound'
      ? createEngineError('NOT_FOUND', 'error.notFound', { type, reason: error.reason })
      : ruleViolation(error.reason === 'invalidPreview' ? 'invalidPreview' : 'marketUnavailable');
  }
  if (error instanceof ContentLookupError) {
    return createEngineError('NOT_FOUND', 'error.notFound', {
      type,
      kind: error.kind,
      definitionId: error.definitionId,
    });
  }
  if (error instanceof ContentIntegrityError) {
    return createEngineError('CONTENT_ERROR', contentErrorMessageKey('structure'), {
      type,
      reason: error.reason,
      path: error.path,
    });
  }
  return internalError({ type });
}
