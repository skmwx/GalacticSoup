import {
  type EngineResponse,
  type RequestPayload,
  type RequestType,
  type ResponseData,
  readRequestId,
} from '@protocol';

import {
  type ClientGateway,
  type RequestOptions,
  type SendEnvelopeOptions,
  type TransportKind,
  GatewayRequestError,
} from './clientGateway';
import { buildClientRequest, createRequestIdFactory } from './envelope';

/**
 * Gateway over a message-port style transport (Technical Specification 4.2, 7.1).
 *
 * It owns correlation, timeouts and disposal. It contains no game rule: an
 * engine response is passed through unchanged, whether it reports success or a
 * rule failure.
 *
 * @implements TECH-7.1
 */

export interface MessagePortLike {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start?(): void;
}

export interface PortGatewayOptions {
  readonly transport: TransportKind;
  readonly createRequestId?: () => string;
  readonly defaultTimeoutMs?: number;
  /** Called when a response arrives that no pending request is waiting for. */
  readonly onUnmatchedResponse?: (response: unknown) => void;
  /** Runs when the gateway is disposed, for transport-owned cleanup. */
  readonly onDispose?: () => void;
}

export interface PortGateway extends ClientGateway {
  /** Rejects every in-flight request; used when the transport itself fails. */
  failPending(error: GatewayRequestError): void;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

interface PendingRequest {
  readonly resolve: (response: EngineResponse<unknown>) => void;
  readonly reject: (error: GatewayRequestError) => void;
  readonly cancelTimeout: () => void;
}

export function createPortGateway(
  port: MessagePortLike,
  options: PortGatewayOptions,
): PortGateway {
  const createRequestId = options.createRequestId ?? createRequestIdFactory();
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pending = new Map<string, PendingRequest>();
  let disposed = false;

  const listener = (event: { data: unknown }): void => {
    const response = event.data;
    if (!isEngineResponseShape(response)) {
      options.onUnmatchedResponse?.(response);
      return;
    }

    const entry = pending.get(response.requestId);
    if (entry === undefined) {
      options.onUnmatchedResponse?.(response);
      return;
    }

    pending.delete(response.requestId);
    entry.cancelTimeout();
    entry.resolve(response);
  };

  port.addEventListener('message', listener);
  port.start?.();

  function send(
    message: unknown,
    correlationId: string,
    timeoutMs: number,
  ): Promise<EngineResponse<unknown>> {
    if (disposed) {
      return Promise.reject(
        new GatewayRequestError('DISPOSED', 'The gateway has already been disposed.'),
      );
    }
    if (pending.has(correlationId)) {
      return Promise.reject(
        new GatewayRequestError(
          'DUPLICATE_REQUEST_ID',
          `A request with id "${correlationId}" is already in flight.`,
        ),
      );
    }

    return new Promise<EngineResponse<unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(correlationId);
        reject(
          new GatewayRequestError('TIMEOUT', `The engine did not answer within ${timeoutMs}ms.`),
        );
      }, timeoutMs);

      pending.set(correlationId, {
        resolve,
        reject,
        cancelTimeout: () => {
          clearTimeout(timer);
        },
      });

      try {
        port.postMessage(message);
      } catch (cause) {
        pending.delete(correlationId);
        clearTimeout(timer);
        reject(
          new GatewayRequestError(
            'TRANSPORT_FAILED',
            'The request could not be sent over the transport.',
          ),
        );
        void cause;
      }
    });
  }

  return {
    transport: options.transport,

    async request<TType extends RequestType>(
      type: TType,
      payload: RequestPayload<TType>,
      requestOptions: RequestOptions = {},
    ): Promise<EngineResponse<ResponseData<TType>>> {
      const requestId = createRequestId();
      const envelope = buildClientRequest(type, payload, {
        requestId,
        ...(requestOptions.campaignId === undefined ? {} : { campaignId: requestOptions.campaignId }),
        ...(requestOptions.expectedRevision === undefined
          ? {}
          : { expectedRevision: requestOptions.expectedRevision }),
      });

      const response = await send(
        envelope,
        requestId,
        requestOptions.timeoutMs ?? defaultTimeoutMs,
      );
      return response as EngineResponse<ResponseData<TType>>;
    },

    sendEnvelope(
      message: unknown,
      envelopeOptions: SendEnvelopeOptions = {},
    ): Promise<EngineResponse<unknown>> {
      const correlationId = envelopeOptions.correlationId ?? readRequestId(message);
      return send(message, correlationId, envelopeOptions.timeoutMs ?? defaultTimeoutMs);
    },

    failPending(error: GatewayRequestError): void {
      for (const [, entry] of [...pending]) {
        entry.cancelTimeout();
        entry.reject(error);
      }
      pending.clear();
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const [, entry] of [...pending]) {
        entry.cancelTimeout();
        entry.reject(new GatewayRequestError('DISPOSED', 'The gateway was disposed.'));
      }
      pending.clear();
      port.removeEventListener?.('message', listener);
      options.onDispose?.();
    },
  };
}

function isEngineResponseShape(value: unknown): value is EngineResponse<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { requestId?: unknown; ok?: unknown };
  return typeof candidate.requestId === 'string' && typeof candidate.ok === 'boolean';
}
