/**
 * Protocol version 1 request catalogue (Technical Specification 7.1, 18).
 *
 * Version 1 exposes engine health and capability reporting only. Gameplay
 * command and query families are declared by the phases that implement them.
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

export interface ProtocolContract {
  'system.health': { payload: EmptyPayload; data: HealthData };
  'system.capabilities': { payload: EmptyPayload; data: CapabilitiesData };
}

export type RequestType = keyof ProtocolContract;

export type RequestPayload<TType extends RequestType> = ProtocolContract[TType]['payload'];
export type ResponseData<TType extends RequestType> = ProtocolContract[TType]['data'];

/** Sorted so capability reports and fixtures are order-stable. */
export const REQUEST_TYPES = [
  'system.capabilities',
  'system.health',
] as const satisfies readonly RequestType[];

export function isRequestType(value: string): value is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(value);
}
