import type { CapabilitiesData, HealthData, RequestType } from '@protocol';
import { REQUEST_TYPES } from '@protocol';

/**
 * Version 1 request handlers (Technical Specification 7.2).
 *
 * Handlers are pure functions of the host context. No request in this version
 * changes state, so none of them opens a transaction or advances a revision.
 */

export interface HandlerContext {
  readonly engineVersion: string;
  readonly protocolVersion: number;
}

export type RequestHandler<TType extends RequestType> = (
  context: HandlerContext,
) => TType extends 'system.health' ? HealthData : CapabilitiesData;

export function handleHealth(context: HandlerContext): HealthData {
  return {
    status: 'ready',
    engineVersion: context.engineVersion,
    protocolVersion: context.protocolVersion,
  };
}

export function handleCapabilities(context: HandlerContext): CapabilitiesData {
  return {
    protocolVersion: context.protocolVersion,
    engineVersion: context.engineVersion,
    requestTypes: [...REQUEST_TYPES],
  };
}
