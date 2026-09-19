import {
  type ClientRequest,
  type RequestPayload,
  type RequestType,
  PROTOCOL_VERSION,
} from '@protocol';

/**
 * Client-side envelope construction (Technical Specification 7.1).
 *
 * Optional envelope fields are omitted rather than sent as `undefined`, because
 * protocol payloads use the JSON-compatible subset of structured-clone data.
 */

export interface EnvelopeFields {
  readonly requestId: string;
  readonly campaignId?: string;
  readonly expectedRevision?: number;
}

export function buildClientRequest<TType extends RequestType>(
  type: TType,
  payload: RequestPayload<TType>,
  fields: EnvelopeFields,
): ClientRequest<TType, RequestPayload<TType>> {
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: fields.requestId,
    type,
    payload,
  };

  const withCampaign =
    fields.campaignId === undefined ? base : { ...base, campaignId: fields.campaignId };

  return fields.expectedRevision === undefined
    ? withCampaign
    : { ...withCampaign, expectedRevision: fields.expectedRevision };
}

/**
 * Request ids only need to be unique within a session; they are correlation
 * handles, never authoritative identifiers (Technical Specification 5.1).
 */
export function createRequestIdFactory(): () => string {
  const cryptoApi: Crypto | undefined = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return () => cryptoApi.randomUUID();
  }

  let counter = 0;
  const prefix = Math.trunc(Math.random() * 0xffffffff).toString(16);
  return () => {
    counter += 1;
    return `req-${prefix}-${counter.toString(16)}`;
  };
}
