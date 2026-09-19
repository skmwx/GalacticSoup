import type { ContentRepository } from '@engine/ports';
import type { CapabilitiesData, ContentSummaryData, HealthData } from '@protocol';
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
  /** The engine reaches authored content only through this port. */
  readonly content: ContentRepository;
}

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

/**
 * Reports which content the engine is running on. The version and hash are
 * the values a save records, so the interface and a bug report name exactly
 * the same build (Technical Specification 6.3).
 *
 * @implements TECH-6.3
 */
export function handleContentSummary(context: HandlerContext): ContentSummaryData {
  const { content } = context;
  return {
    contentVersion: content.contentVersion,
    contentHash: content.contentHash,
    defaultLocale: content.defaultLocale,
    locales: [...content.locales],
    definitionCounts: content.definitionCounts(),
  };
}
