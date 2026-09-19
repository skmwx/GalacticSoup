/**
 * Protocol version 1 request catalogue (Technical Specification 7.1, 18).
 *
 * Version 1 exposes engine health, capability reporting and content identity.
 * Gameplay command and query families are declared by the phases that
 * implement them.
 *
 * A request type is added to a version rather than incrementing it while no
 * released client exists: `system.capabilities` reports the accepted types, so
 * a client discovers what this host answers instead of assuming it. The
 * version increments when a payload or response shape that has shipped
 * changes incompatibly.
 */

/** Payload for requests that take no arguments. */
export type EmptyPayload = Record<string, never>;

export const EMPTY_PAYLOAD: EmptyPayload = {};

export interface HealthData {
  readonly status: 'ready';
  readonly engineVersion: string;
  readonly protocolVersion: number;
}

export interface CapabilitiesData {
  readonly protocolVersion: number;
  readonly engineVersion: string;
  /** Request types this host accepts, sorted for stable comparison. */
  readonly requestTypes: readonly string[];
}

/**
 * Identity of the content the engine loaded (Technical Specification 6.3).
 *
 * The version and hash are recorded in every save, so the interface and the
 * diagnostics surface report exactly what the engine is running on. The counts
 * are informational and keyed by content kind in stable order.
 */
export interface ContentSummaryData {
  readonly contentVersion: string;
  readonly contentHash: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly definitionCounts: Readonly<Record<string, number>>;
}

export interface ProtocolContract {
  'system.health': { payload: EmptyPayload; data: HealthData };
  'system.capabilities': { payload: EmptyPayload; data: CapabilitiesData };
  'content.summary': { payload: EmptyPayload; data: ContentSummaryData };
}

export type RequestType = keyof ProtocolContract;

export type RequestPayload<TType extends RequestType> = ProtocolContract[TType]['payload'];
export type ResponseData<TType extends RequestType> = ProtocolContract[TType]['data'];

/** Sorted so capability reports and fixtures are order-stable. */
export const REQUEST_TYPES = [
  'content.summary',
  'system.capabilities',
  'system.health',
] as const satisfies readonly RequestType[];

export function isRequestType(value: string): value is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(value);
}
