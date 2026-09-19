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

/**
 * Per-type payload rules.
 *
 * Payload validation is structural only: it decides whether the request is
 * well-formed protocol data, never whether the rules permit it. A legal
 * request that the campaign refuses comes back as `RULE_VIOLATION` from the
 * engine, with a reason the interface can explain
 * (Technical Specification 7.2, steps 1 and 4).
 */
export function validatePayload(type: RequestType, payload: unknown): EngineError | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return invalidRequest('payload', { type, reason: 'notAnObject' });
  }

  const fields = payload as Record<string, unknown>;

  switch (type) {
    case 'system.health':
    case 'system.capabilities':
    case 'content.summary':
    case 'campaign.reset':
    case 'campaign.session':
    case 'campaign.frame':
    case 'diagnostics.stateHash':
      return expectNoFields(type, fields);

    case 'campaign.create': {
      const unexpected = unexpectedField(fields, ['displayName', 'seed', 'createdAtRealMs']);
      if (unexpected !== null) {
        return payloadField(type, unexpected, 'unexpectedField');
      }
      const displayName = fields['displayName'];
      if (
        typeof displayName !== 'string' ||
        displayName.trim().length === 0 ||
        displayName.length > MAX_DISPLAY_NAME_LENGTH ||
        hasControlCharacter(displayName)
      ) {
        return payloadField(type, 'displayName', 'format');
      }
      if (typeof fields['seed'] !== 'string' || !CAMPAIGN_SEED_PATTERN.test(fields['seed'])) {
        return payloadField(type, 'seed', 'format');
      }
      if (!isWholeNonNegative(fields['createdAtRealMs'])) {
        return payloadField(type, 'createdAtRealMs', 'format');
      }
      return null;
    }

    case 'time.set': {
      const unexpected = unexpectedField(fields, ['paused', 'rate']);
      if (unexpected !== null) {
        return payloadField(type, unexpected, 'unexpectedField');
      }
      if (typeof fields['paused'] !== 'boolean') {
        return payloadField(type, 'paused', 'format');
      }
      const rate = fields['rate'];
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        return payloadField(type, 'rate', 'format');
      }
      return null;
    }

    case 'time.advance': {
      const unexpected = unexpectedField(fields, ['elapsedRealMs']);
      if (unexpected !== null) {
        return payloadField(type, unexpected, 'unexpectedField');
      }
      if (!isWholeNonNegative(fields['elapsedRealMs'])) {
        return payloadField(type, 'elapsedRealMs', 'format');
      }
      return null;
    }

    default:
      return invalidRequest('unsupportedRequestType', { type });
  }
}

/**
 * The display-name bound is duplicated from the domain deliberately: the
 * protocol must reject an oversized payload before any engine code runs, and
 * `@protocol` may not import the engine. The two values are checked against
 * each other in tests.
 */
const MAX_DISPLAY_NAME_LENGTH = 48;

const CAMPAIGN_SEED_PATTERN = /^[0-9a-f]{32}$/;

/** Rejects C0 controls and DEL without embedding them in a pattern. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function expectNoFields(type: RequestType, fields: Record<string, unknown>): EngineError | null {
  const unexpected = Object.keys(fields)[0];
  return unexpected === undefined ? null : payloadField(type, unexpected, 'unexpectedField');
}

function unexpectedField(
  fields: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  return Object.keys(fields).find((key) => !allowed.includes(key)) ?? null;
}

function payloadField(type: RequestType, field: string, reason: string): EngineError {
  return invalidRequest('payload', { type, field, reason });
}

function isWholeNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
