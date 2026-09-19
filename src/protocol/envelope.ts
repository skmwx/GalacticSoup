import type { EngineError } from './errors';
import type { TransportValue } from './transport';

/**
 * Versioned request/response envelope (Technical Specification 7.1).
 *
 * The same shape is used over worker messaging today and over HTTP or a socket
 * later, so the gateway can hide the transport from the interface entirely.
 * Optional fields are omitted rather than set to `undefined`.
 *
 * @implements TECH-7.1
 */
export interface ClientRequest<TType extends string = string, TPayload = TransportValue> {
  readonly protocolVersion: number;
  readonly requestId: string;
  readonly campaignId?: string;
  readonly expectedRevision?: number;
  readonly type: TType;
  readonly payload: TPayload;
}

export interface EngineSuccess<TData> {
  readonly requestId: string;
  readonly ok: true;
  readonly revision: number;
  readonly data: TData;
}

export interface EngineFailure {
  readonly requestId: string;
  readonly ok: false;
  readonly revision?: number;
  readonly error: EngineError;
}

export type EngineResponse<TData> = EngineSuccess<TData> | EngineFailure;

export function successResponse<TData>(
  requestId: string,
  revision: number,
  data: TData,
): EngineSuccess<TData> {
  return { requestId, ok: true, revision, data };
}

export function failureResponse(
  requestId: string,
  error: EngineError,
  revision?: number,
): EngineFailure {
  return revision === undefined
    ? { requestId, ok: false, error }
    : { requestId, ok: false, revision, error };
}

export function isSuccess<TData>(
  response: EngineResponse<TData>,
): response is EngineSuccess<TData> {
  return response.ok;
}
