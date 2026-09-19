import type { CampaignState } from '@engine/domain';
import { ContentIntegrityError, ContentLookupError, type ContentRepository } from '@engine/ports';
import {
  type ClientRequest,
  type CommandType,
  type EngineResponse,
  type RequestType,
  contentErrorMessageKey,
  createEngineError,
  failureResponse,
  findTransportViolation,
  internalError,
  isCommandType,
  NO_CAMPAIGN_REVISION,
  PROTOCOL_VERSION,
  ruleViolation,
  staleRevision,
  successResponse,
  validateClientRequest,
} from '@protocol';

import { runCommand } from './pipeline';
import { createRecentRequests, type RecentRequests } from './recentRequests';
import {
  handleCapabilities,
  handleContentSummary,
  handleFrame,
  handleHealth,
  handleSession,
  handleStateHash,
  type HandlerContext,
} from './handlers';
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
  /** Overridable so tests can assert version reporting without a rebuild. */
  readonly engineVersion?: string;
  /** Size of the duplicate-request cache. */
  readonly recentRequestLimit?: number;
}

interface Session {
  campaign: CampaignState | null;
  readonly content: ContentRepository;
  readonly engineVersion: string;
  readonly recent: RecentRequests;
}

export function createEngineHost(options: EngineHostOptions): EngineHost {
  const session: Session = {
    campaign: null,
    content: options.content,
    engineVersion: options.engineVersion ?? ENGINE_VERSION,
    recent:
      options.recentRequestLimit === undefined
        ? createRecentRequests()
        : createRecentRequests(options.recentRequestLimit),
  };

  return {
    engineVersion: session.engineVersion,
    protocolVersion: PROTOCOL_VERSION,
    handle(message: unknown): Promise<EngineResponse<unknown>> {
      return Promise.resolve(dispatch(session, message));
    },
  };
}

function dispatch(session: Session, message: unknown): EngineResponse<unknown> {
  const validation = validateClientRequest(message);
  if (!validation.ok) {
    return failureResponse(validation.requestId, validation.error);
  }

  const request = validation.request;
  const response = route(session, request);

  const violation = findTransportViolation(response);
  if (violation !== null) {
    return failureResponse(
      request.requestId,
      internalError({ type: request.type, path: violation.path, reason: violation.reason }),
    );
  }

  return response;
}

function route(
  session: Session,
  request: ClientRequest<RequestType, unknown>,
): EngineResponse<unknown> {
  const { requestId, type } = request;
  const revision = session.campaign?.revision ?? NO_CAMPAIGN_REVISION;

  if (isCommandType(type)) {
    const remembered = session.recent.find(requestId);
    if (remembered !== undefined) {
      return remembered;
    }
  }

  const campaignError = checkCampaign(session, request);
  if (campaignError !== null) {
    return campaignError;
  }

  if (isCommandType(type)) {
    const expected = request.expectedRevision;
    if (expected !== undefined && expected !== revision) {
      return failureResponse(
        requestId,
        staleRevision({ expected, actual: revision }),
        revision,
      );
    }
    return executeCommand(session, requestId, type, request.payload);
  }

  try {
    return successResponse(requestId, revision, query(session, type));
  } catch (error: unknown) {
    return failureResponse(requestId, describeFailure(type, error), revision);
  }
}

function executeCommand(
  session: Session,
  requestId: string,
  type: CommandType,
  payload: unknown,
): EngineResponse<unknown> {
  const result = runCommand({
    campaign: session.campaign,
    content: session.content,
    type,
    payload,
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
      // The campaign ended. Its remembered results describe a campaign that no
      // longer exists, so they are forgotten before this one is recorded.
      session.recent.clear();
    }
    session.campaign = result.campaign;
  }

  const revision = session.campaign?.revision ?? NO_CAMPAIGN_REVISION;
  const response = successResponse(requestId, revision, result.data);

  if (result.kind === 'committed') {
    session.recent.remember(requestId, response);
  }

  return response;
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

function query(session: Session, type: RequestType): unknown {
  const context: HandlerContext = {
    engineVersion: session.engineVersion,
    protocolVersion: PROTOCOL_VERSION,
    content: session.content,
    campaign: session.campaign,
  };

  switch (type) {
    case 'system.health':
      return handleHealth(context);
    case 'system.capabilities':
      return handleCapabilities(context);
    case 'content.summary':
      return handleContentSummary(context);
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
