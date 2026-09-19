import type { MessageKey } from '@shared';

/**
 * Stable error codes with localizable parameters
 * (Technical Specification 5.4).
 *
 * Expected rule failures are returned as values; they never throw across the
 * worker boundary.
 *
 * @implements TECH-5.4
 */
export const ENGINE_ERROR_CODES = [
  'INVALID_REQUEST',
  'STALE_REVISION',
  'STALE_PREVIEW',
  'RULE_VIOLATION',
  'NOT_FOUND',
  'CONTENT_ERROR',
  'SAVE_ERROR',
  'QUOTA_ERROR',
  'INTEGRITY_ERROR',
  'INTERNAL_ERROR',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

/** Parameter values are transport-safe scalars only. */
export type ErrorParams = Readonly<Record<string, string | number | boolean>>;

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly messageKey: MessageKey;
  readonly params?: ErrorParams;
}

/** Default message key for each code. A specific failure may refine the key. */
export const ENGINE_ERROR_MESSAGE_KEYS: Readonly<Record<EngineErrorCode, MessageKey>> = {
  INVALID_REQUEST: 'error.invalidRequest',
  STALE_REVISION: 'error.staleRevision',
  STALE_PREVIEW: 'error.stalePreview',
  RULE_VIOLATION: 'error.ruleViolation',
  NOT_FOUND: 'error.notFound',
  CONTENT_ERROR: 'error.contentError',
  SAVE_ERROR: 'error.saveError',
  QUOTA_ERROR: 'error.quotaError',
  INTEGRITY_ERROR: 'error.integrityError',
  INTERNAL_ERROR: 'error.internalError',
};

/** Why an envelope or payload was rejected as malformed protocol data. */
export const INVALID_REQUEST_REASONS = [
  'notAnObject',
  'protocolVersion',
  'requestId',
  'requestType',
  'campaignId',
  'expectedRevision',
  'payload',
  'unknownField',
  'unsupportedRequestType',
  'nonTransportableValue',
] as const;

export type InvalidRequestReason = (typeof INVALID_REQUEST_REASONS)[number];

export function invalidRequestMessageKey(reason: InvalidRequestReason): MessageKey {
  return `error.invalidRequest.${reason}`;
}

export function createEngineError(
  code: EngineErrorCode,
  messageKey: MessageKey,
  params?: ErrorParams,
): EngineError {
  return params === undefined || Object.keys(params).length === 0
    ? { code, messageKey }
    : { code, messageKey, params };
}

export function invalidRequest(reason: InvalidRequestReason, params?: ErrorParams): EngineError {
  return createEngineError('INVALID_REQUEST', invalidRequestMessageKey(reason), params);
}

export function internalError(params?: ErrorParams): EngineError {
  return createEngineError('INTERNAL_ERROR', ENGINE_ERROR_MESSAGE_KEYS.INTERNAL_ERROR, params);
}

/**
 * Every message key the protocol can emit. The shipped catalog must cover all
 * of them (tests/unit/ui/messageCatalog.test.ts).
 */
export const PROTOCOL_MESSAGE_KEYS: readonly MessageKey[] = [
  ...Object.values(ENGINE_ERROR_MESSAGE_KEYS),
  ...INVALID_REQUEST_REASONS.map(invalidRequestMessageKey),
].sort();
