import type { EngineResponse, RequestPayload, RequestType, ResponseData } from '@protocol';
import type { MessageKey } from '@shared';

/**
 * The transport-independent client API (Technical Specification 4.1, 7.1, 17).
 *
 * Interface code knows only this contract. Whether the engine runs in a worker,
 * in the same process for a test, or behind a network transport later is not
 * visible to any caller.
 *
 * @implements TECH-4.1
 */

export type TransportKind = 'worker' | 'port' | 'direct';

export interface RequestOptions {
  readonly campaignId?: string;
  readonly expectedRevision?: number;
  readonly timeoutMs?: number;
}

export interface SendEnvelopeOptions {
  /** Correlation id to wait for when the message carries none of its own. */
  readonly correlationId?: string;
  readonly timeoutMs?: number;
}

export interface ClientGateway {
  readonly transport: TransportKind;

  /** Sends a well-formed request and resolves with the engine response. */
  request<TType extends RequestType>(
    type: TType,
    payload: RequestPayload<TType>,
    options?: RequestOptions,
  ): Promise<EngineResponse<ResponseData<TType>>>;

  /**
   * Sends a raw message without client-side validation. Contract tests use it
   * to prove that the engine, not the gateway, rejects malformed protocol data.
   */
  sendEnvelope(message: unknown, options?: SendEnvelopeOptions): Promise<EngineResponse<unknown>>;

  dispose(): void;
}

/** Why a request failed at the transport, before any engine rule ran. */
export type GatewayFailureCode =
  | 'TIMEOUT'
  | 'TRANSPORT_FAILED'
  | 'DISPOSED'
  | 'DUPLICATE_REQUEST_ID'
  | 'MALFORMED_RESPONSE';

export class GatewayRequestError extends Error {
  readonly code: GatewayFailureCode;
  readonly messageKey: MessageKey;

  constructor(code: GatewayFailureCode, message: string) {
    super(message);
    this.name = 'GatewayRequestError';
    this.code = code;
    this.messageKey = GATEWAY_FAILURE_MESSAGE_KEYS[code];
  }
}

/** Why the engine could not be hosted at all (Technical Specification 4.2). */
export type EngineUnavailableReason = 'worker-unsupported' | 'worker-failed';

export class EngineUnavailableError extends Error {
  readonly reason: EngineUnavailableReason;
  readonly messageKey: MessageKey;

  constructor(reason: EngineUnavailableReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EngineUnavailableError';
    this.reason = reason;
    this.messageKey = ENGINE_UNAVAILABLE_MESSAGE_KEYS[reason];
  }
}

export const GATEWAY_FAILURE_MESSAGE_KEYS: Readonly<Record<GatewayFailureCode, MessageKey>> = {
  TIMEOUT: 'error.gateway.timeout',
  TRANSPORT_FAILED: 'error.gateway.transportFailed',
  DISPOSED: 'error.gateway.disposed',
  DUPLICATE_REQUEST_ID: 'error.gateway.duplicateRequestId',
  MALFORMED_RESPONSE: 'error.gateway.malformedResponse',
};

export const ENGINE_UNAVAILABLE_MESSAGE_KEYS: Readonly<
  Record<EngineUnavailableReason, MessageKey>
> = {
  'worker-unsupported': 'error.compatibility.workerUnsupported',
  'worker-failed': 'error.compatibility.workerFailed',
};

/** Every message key the gateway can surface, for catalog coverage checks. */
export const GATEWAY_MESSAGE_KEYS: readonly MessageKey[] = [
  ...Object.values(GATEWAY_FAILURE_MESSAGE_KEYS),
  ...Object.values(ENGINE_UNAVAILABLE_MESSAGE_KEYS),
].sort();
