import type { ClientRequest } from './envelope';
import { type EngineError, invalidRequest } from './errors';
import { isRequestType, type RequestType } from './requests';
import { findTransportViolation } from './transport';
import { MAX_REQUEST_ID_LENGTH, PROTOCOL_VERSION, UNKNOWN_REQUEST_ID } from './version';

/**
 * Envelope and payload validation (Technical Specification 7.2, step 1).
 *
 * Validation is hand-written rather than schema-driven at runtime so the engine
 * keeps no library dependency (Technical Specification 2). The JSON Schemas in
 * `schemas/protocol` describe the same contract for other languages and are
 * checked against this implementation in tests.
 *
 * @implements TECH-7.1, TECH-5.4
 */

const ENVELOPE_FIELDS = new Set([
  'protocolVersion',
  'requestId',
  'campaignId',
  'expectedRevision',
  'type',
  'payload',
]);

export type EnvelopeValidation =
  | { readonly ok: true; readonly request: ClientRequest<RequestType, unknown> }
  | { readonly ok: false; readonly requestId: string; readonly error: EngineError };

/** Best-effort correlation id for a message that may be malformed. */
export function readRequestId(message: unknown): string {
  if (typeof message !== 'object' || message === null) {
    return UNKNOWN_REQUEST_ID;
  }
  const candidate = (message as { requestId?: unknown }).requestId;
  if (typeof candidate !== 'string') {
    return UNKNOWN_REQUEST_ID;
  }
  return candidate.length > 0 && candidate.length <= MAX_REQUEST_ID_LENGTH
    ? candidate
    : UNKNOWN_REQUEST_ID;
}

export function validateClientRequest(message: unknown): EnvelopeValidation {
  const requestId = readRequestId(message);

  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return fail(requestId, invalidRequest('notAnObject'));
  }

  const violation = findTransportViolation(message);
  if (violation !== null) {
    return fail(
      requestId,
      invalidRequest('nonTransportableValue', {
        path: violation.path,
        reason: violation.reason,
      }),
    );
  }

  const envelope = message as Record<string, unknown>;

  for (const field of Object.keys(envelope)) {
    if (!ENVELOPE_FIELDS.has(field)) {
      return fail(requestId, invalidRequest('unknownField', { field }));
    }
  }

  if (envelope['protocolVersion'] !== PROTOCOL_VERSION) {
    return fail(
      requestId,
      invalidRequest('protocolVersion', {
        expected: PROTOCOL_VERSION,
        received: describe(envelope['protocolVersion']),
      }),
    );
  }

  const rawRequestId = envelope['requestId'];
  if (
    typeof rawRequestId !== 'string' ||
    rawRequestId.length === 0 ||
    rawRequestId.length > MAX_REQUEST_ID_LENGTH
  ) {
    return fail(requestId, invalidRequest('requestId', { maxLength: MAX_REQUEST_ID_LENGTH }));
  }

  const type = envelope['type'];
  if (typeof type !== 'string' || type.length === 0) {
    return fail(rawRequestId, invalidRequest('requestType'));
  }
  if (!isRequestType(type)) {
    return fail(rawRequestId, invalidRequest('unsupportedRequestType', { type }));
  }

  if ('campaignId' in envelope) {
    const campaignId = envelope['campaignId'];
    if (typeof campaignId !== 'string' || campaignId.length === 0) {
      return fail(rawRequestId, invalidRequest('campaignId'));
    }
  }

  if ('expectedRevision' in envelope) {
    const expectedRevision = envelope['expectedRevision'];
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return fail(rawRequestId, invalidRequest('expectedRevision'));
    }
  }

  if (!('payload' in envelope)) {
    return fail(rawRequestId, invalidRequest('payload', { reason: 'missing' }));
  }

  const payloadError = validatePayload(type, envelope['payload']);
  if (payloadError !== null) {
    return fail(rawRequestId, payloadError);
  }

  return { ok: true, request: envelope as unknown as ClientRequest<RequestType, unknown> };
}

/** Per-type payload rules. Both version 1 requests take an empty object. */
export function validatePayload(type: RequestType, payload: unknown): EngineError | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return invalidRequest('payload', { type, reason: 'notAnObject' });
  }

  switch (type) {
    case 'system.health':
    case 'system.capabilities': {
      const keys = Object.keys(payload as Record<string, unknown>);
      const unexpected = keys[0];
      if (unexpected !== undefined) {
        return invalidRequest('payload', {
          type,
          reason: 'unexpectedField',
          field: unexpected,
        });
      }
      return null;
    }
    default:
      return invalidRequest('unsupportedRequestType', { type });
  }
}

function fail(requestId: string, error: EngineError): EnvelopeValidation {
  return { ok: false, requestId, error };
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return typeof value === 'object' ? 'object' : String(value);
}
