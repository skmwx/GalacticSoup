import type { ClientRequest } from './envelope';
import { isDefinitionId, isDefinitionIdIn } from '@shared';
import { type EngineError, invalidRequest } from './errors';
import { isRequestType, SAVE_KIND_NAMES, type RequestType } from './requests';
import { findTransportViolation } from './transport';
import { MAX_REQUEST_ID_LENGTH, PROTOCOL_VERSION, UNKNOWN_REQUEST_ID } from './version';
import { ECONOMIC_ACTIONS } from './economy';

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
    case 'assets.list':
    case 'fitting.draft':
    case 'fitting.revert':
    case 'fitting.commit':
    case 'wallet.get':
    case 'system.health':
    case 'system.capabilities':
    case 'content.summary':
    case 'campaign.reset':
    case 'campaign.resume':
    case 'campaign.saves':
    case 'campaign.session':
    case 'campaign.frame':
    case 'diagnostics.stateHash':
      return expectNoFields(type, fields);

    case 'inventory.transfer':
    case 'inventory.split':
    case 'inventory.merge':
    case 'inventory.maximum':
    case 'inventory.hangar':
    case 'inventory.cargo':
    case 'item.inspect': {
      const keys = {
        'inventory.transfer': ['stackId', 'destinationInventoryId', 'quantity'],
        'inventory.split': ['stackId', 'quantity'],
        'inventory.merge': ['sourceStackId', 'targetStackId'],
        'inventory.maximum': ['stackId', 'destinationInventoryId'],
        'inventory.hangar': ['stationId'], 'inventory.cargo': ['shipId'], 'item.inspect': ['stackId'],
      }[type];
      const unexpected = unexpectedField(fields, keys);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      for (const key of keys) {
        const value = fields[key];
        if (key === 'quantity') {
          if (!isWholeNonNegative(value) || value === 0) return payloadField(type, key, 'format');
        } else {
          const valid = key === 'stationId' ? isDefinitionIdIn(value, 'station') : isEntityId(value);
          if (!valid) return payloadField(type, key, 'format');
        }
      }
      return null;
    }

    case 'ship.get':
    case 'ship.undockValidity':
    case 'fitting.begin': {
      const unexpected = unexpectedField(fields, ['shipId']);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      return isEntityId(fields['shipId']) ? null : payloadField(type, 'shipId', 'format');
    }

    case 'fitting.set':
    case 'fitting.clear': {
      const allowed =
        type === 'fitting.clear'
          ? ['slotKind', 'slotIndex']
          : ['slotKind', 'slotIndex', 'moduleId', 'online', 'ammunitionId'];
      const unexpected = unexpectedField(fields, allowed);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      if (!SLOT_KIND_NAMES.includes(fields['slotKind'] as string)) {
        return payloadField(type, 'slotKind', 'format');
      }
      if (!isIndex(fields['slotIndex'])) return payloadField(type, 'slotIndex', 'format');
      if (type === 'fitting.clear') return null;
      if (!isDefinitionIdIn(fields['moduleId'], 'module')) {
        return payloadField(type, 'moduleId', 'format');
      }
      if (typeof fields['online'] !== 'boolean') return payloadField(type, 'online', 'format');
      if ('ammunitionId' in fields && !isDefinitionIdIn(fields['ammunitionId'], 'ammo')) {
        return payloadField(type, 'ammunitionId', 'format');
      }
      return null;
    }

    case 'content.messages': {
      const unexpected = unexpectedField(fields, ['locale']);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      if ('locale' in fields && !isLocaleTag(fields['locale'])) {
        return payloadField(type, 'locale', 'format');
      }
      return null;
    }

    case 'item.compare': {
      const keys = ['definitionId', 'againstDefinitionId'];
      const unexpected = unexpectedField(fields, keys);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      for (const key of keys) {
        if (!isDefinitionId(fields[key])) return payloadField(type, key, 'format');
      }
      return null;
    }

    case 'station.services':
    case 'market.listings': {
      const unexpected = unexpectedField(fields, ['stationId']);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      return isDefinitionIdIn(fields['stationId'], 'station')
        ? null : payloadField(type, 'stationId', 'format');
    }

    case 'market.previewBuy': {
      const unexpected = unexpectedField(fields, ['stationId', 'itemId', 'quantity', 'destinationInventoryId']);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      if (!isDefinitionIdIn(fields['stationId'], 'station')) return payloadField(type, 'stationId', 'format');
      if (!isDefinitionId(fields['itemId'])) return payloadField(type, 'itemId', 'format');
      if (!isPositiveWhole(fields['quantity'])) return payloadField(type, 'quantity', 'format');
      if ('destinationInventoryId' in fields && !isEntityId(fields['destinationInventoryId'])) {
        return payloadField(type, 'destinationInventoryId', 'format');
      }
      return null;
    }

    case 'market.previewSell': {
      const unexpected = unexpectedField(fields, ['stationId', 'stackId', 'quantity']);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      if (!isDefinitionIdIn(fields['stationId'], 'station')) return payloadField(type, 'stationId', 'format');
      if (!isEntityId(fields['stackId'])) return payloadField(type, 'stackId', 'format');
      return isPositiveWhole(fields['quantity']) ? null : payloadField(type, 'quantity', 'format');
    }

    case 'repair.preview':
    case 'resupply.preview':
    case 'insurance.preview': {
      const unexpected = unexpectedField(fields, ['shipId']);
      if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
      return isEntityId(fields['shipId']) ? null : payloadField(type, 'shipId', 'format');
    }

    case 'market.confirmBuy':
    case 'market.confirmSell':
    case 'repair.confirm':
    case 'resupply.confirm':
    case 'insurance.confirm':
      return validatePreviewToken(type, fields);

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

    case 'campaign.save': {
      const unexpected = unexpectedField(fields, ['kind', 'savedAtRealMs']);
      if (unexpected !== null) {
        return payloadField(type, unexpected, 'unexpectedField');
      }
      if (!(SAVE_KIND_NAMES as readonly unknown[]).includes(fields['kind'])) {
        return payloadField(type, 'kind', 'format');
      }
      if (!isWholeNonNegative(fields['savedAtRealMs'])) {
        return payloadField(type, 'savedAtRealMs', 'format');
      }
      return null;
    }

    case 'campaign.close': {
      const unexpected = unexpectedField(fields, ['savedAtRealMs']);
      if (unexpected !== null) {
        return payloadField(type, unexpected, 'unexpectedField');
      }
      if (!isWholeNonNegative(fields['savedAtRealMs'])) {
        return payloadField(type, 'savedAtRealMs', 'format');
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

/**
 * Slot kinds and the entity-id shape are duplicated from the engine for the
 * same reason the display-name bound is: the protocol must reject a malformed
 * payload before any engine code runs, and `@protocol` may not import the
 * engine. Tests check the two against each other.
 */
const SLOT_KIND_NAMES: readonly string[] = ['weapon', 'system', 'engineering', 'utility'];

const MAX_SLOT_INDEX = 15;

const ENTITY_ID_PATTERN = /^c[0-9a-f]{24}-e[1-9][0-9]*$/;

/** A BCP-47-shaped tag, which is as much as the protocol needs to know. */
const LOCALE_TAG_PATTERN = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8})*$/;

function isLocaleTag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 35 && LOCALE_TAG_PATTERN.test(value);
}

function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && ENTITY_ID_PATTERN.test(value);
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SLOT_INDEX;
}

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

function isPositiveWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validatePreviewToken(type: RequestType, fields: Record<string, unknown>): EngineError | null {
  const unexpected = unexpectedField(fields, ['token']);
  if (unexpected !== null) return payloadField(type, unexpected, 'unexpectedField');
  const token = fields['token'];
  if (typeof token !== 'object' || token === null || Array.isArray(token)) {
    return payloadField(type, 'token', 'format');
  }
  const values = token as Record<string, unknown>;
  const tokenUnexpected = unexpectedField(values,
    ['action', 'canonicalParameters', 'campaignRevision', 'relevantVersions', 'valuesHash']);
  if (tokenUnexpected !== null) return payloadField(type, `token.${tokenUnexpected}`, 'unexpectedField');
  if (!(ECONOMIC_ACTIONS as readonly unknown[]).includes(values['action'])) {
    return payloadField(type, 'token.action', 'format');
  }
  if (typeof values['canonicalParameters'] !== 'string' || values['canonicalParameters'].length === 0 ||
      values['canonicalParameters'].length > 4096) return payloadField(type, 'token.canonicalParameters', 'format');
  if (!isWholeNonNegative(values['campaignRevision'])) return payloadField(type, 'token.campaignRevision', 'format');
  const versions = values['relevantVersions'];
  if (typeof versions !== 'object' || versions === null || Array.isArray(versions) ||
      Object.keys(versions).length === 0 || Object.keys(versions).length > 128 ||
      !Object.values(versions).every(isWholeNonNegative)) {
    return payloadField(type, 'token.relevantVersions', 'format');
  }
  return typeof values['valuesHash'] === 'string' && /^[0-9a-f]{64}$/.test(values['valuesHash'])
    ? null : payloadField(type, 'token.valuesHash', 'format');
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
