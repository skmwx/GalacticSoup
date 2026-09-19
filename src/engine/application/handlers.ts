import type { CampaignState } from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import { frameProjection, sessionProjection, stateHashProjection } from '@engine/projections';
import type {
  CapabilitiesData,
  ContentSummaryData,
  FrameData,
  HealthData,
  SessionData,
  StateHashData,
} from '@protocol';
import { REQUEST_TYPES } from '@protocol';

/**
 * Read-only query handlers (Technical Specification 7.3).
 *
 * A query takes no random draw, advances no time and changes no revision. It
 * returns a projection built from the campaign the session currently holds.
 */

export interface HandlerContext {
  readonly engineVersion: string;
  readonly protocolVersion: number;
  /** The engine reaches authored content only through this port. */
  readonly content: ContentRepository;
  /** The open campaign, or `null` when none is open. */
  readonly campaign: CampaignState | null;
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

export function handleSession(context: HandlerContext): SessionData {
  return sessionProjection(context.campaign, context.content, context.engineVersion);
}

export function handleFrame(context: HandlerContext): FrameData {
  return frameProjection(context.campaign, context.content);
}

export function handleStateHash(context: HandlerContext): StateHashData {
  return stateHashProjection(context.campaign, context.content);
}
