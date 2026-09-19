import {
  type EngineResponse,
  type RequestType,
  failureResponse,
  findTransportViolation,
  internalError,
  NO_CAMPAIGN_REVISION,
  PROTOCOL_VERSION,
  successResponse,
  validateClientRequest,
} from '@protocol';

import { handleCapabilities, handleHealth, type HandlerContext } from './handlers';
import { ENGINE_VERSION } from './version';

/**
 * The engine host: the single entry point through which any transport reaches
 * the engine (Technical Specification 4.1, 4.2, 7.2).
 *
 * It takes an unvalidated transport message and always answers with a
 * transport-safe response. Expected failures are returned as error responses;
 * an unexpected throw is contained here and reported as `INTERNAL_ERROR` so it
 * cannot cross the worker boundary as an exception.
 *
 * @implements TECH-2, TECH-4.1, TECH-7.1
 */
export interface EngineHost {
  readonly engineVersion: string;
  readonly protocolVersion: number;
  handle(message: unknown): Promise<EngineResponse<unknown>>;
}

export interface EngineHostOptions {
  /** Overridable so tests can assert version reporting without a rebuild. */
  readonly engineVersion?: string;
}

export function createEngineHost(options: EngineHostOptions = {}): EngineHost {
  const context: HandlerContext = {
    engineVersion: options.engineVersion ?? ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  };

  return {
    engineVersion: context.engineVersion,
    protocolVersion: context.protocolVersion,
    handle(message: unknown): Promise<EngineResponse<unknown>> {
      return Promise.resolve(dispatch(context, message));
    },
  };
}

function dispatch(context: HandlerContext, message: unknown): EngineResponse<unknown> {
  const validation = validateClientRequest(message);
  if (!validation.ok) {
    return failureResponse(validation.requestId, validation.error);
  }

  const { requestId, type } = validation.request;

  let response: EngineResponse<unknown>;
  try {
    response = successResponse(requestId, NO_CAMPAIGN_REVISION, execute(context, type));
  } catch {
    return failureResponse(requestId, internalError({ type }));
  }

  const violation = findTransportViolation(response);
  if (violation !== null) {
    return failureResponse(
      requestId,
      internalError({ type, path: violation.path, reason: violation.reason }),
    );
  }

  return response;
}

function execute(context: HandlerContext, type: RequestType): unknown {
  switch (type) {
    case 'system.health':
      return handleHealth(context);
    case 'system.capabilities':
      return handleCapabilities(context);
    default:
      return assertUnreachable(type);
  }
}

function assertUnreachable(type: never): never {
  throw new Error(`Unhandled request type: ${String(type)}`);
}
