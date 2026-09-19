import { campaignStateHash, type CampaignState, type SchedulerState } from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import { NO_CAMPAIGN_REVISION } from '@protocol';
import type { FrameData, SessionData, StateHashData, TimeControlData } from '@protocol';

/**
 * Session, frame and diagnostic projections
 * (Technical Specification 7.3; Functional Specification 19.1).
 *
 * A projection is a purpose-built, immutable view model. It copies the values
 * the interface needs and never hands out a reference into campaign state, so
 * no interface code can hold a mutable piece of the engine. Projections are
 * pure: they take no random draw, advance no time and change no revision.
 *
 * @implements TECH-7.3, FUNC-19.1
 */

export function timeControlProjection(
  campaign: CampaignState | null,
  content: ContentRepository,
): TimeControlData {
  const rules = content.rules.time;
  const rates = [...rules.timeRates].sort((a, b) => a - b);
  const fallbackRate = rates[0] ?? 1;

  return {
    paused: campaign?.time.paused ?? true,
    rate: campaign?.time.rate ?? fallbackRate,
    availableRates: rates,
    quantumMs: rules.simulationQuantumMs,
  };
}

export function sessionProjection(
  campaign: CampaignState | null,
  content: ContentRepository,
  engineVersion: string,
): SessionData {
  return {
    campaign:
      campaign === null
        ? null
        : {
            campaignId: campaign.campaignId,
            displayName: campaign.displayName,
            createdAtRealMs: campaign.createdAtRealMs,
            stateVersion: campaign.stateVersion,
          },
    time: timeControlProjection(campaign, content),
    engineVersion,
    contentVersion: content.contentVersion,
    contentHash: content.contentHash,
  };
}

export function frameProjection(
  campaign: CampaignState | null,
  content: ContentRepository,
): FrameData {
  const time = timeControlProjection(campaign, content);
  const next = campaign === null ? null : nextBoundaryOf(campaign.scheduler);

  return {
    revision: campaign?.revision ?? NO_CAMPAIGN_REVISION,
    simulationTimeMs: campaign?.time.simulationTimeMs ?? 0,
    paused: time.paused,
    rate: time.rate,
    scheduledBoundaryCount: campaign?.scheduler.entries.length ?? 0,
    nextBoundaryAtMs: next === null ? null : next.dueAtMs,
  };
}

export function stateHashProjection(
  campaign: CampaignState | null,
  content: ContentRepository,
): StateHashData {
  return {
    campaignId: campaign?.campaignId ?? null,
    revision: campaign?.revision ?? NO_CAMPAIGN_REVISION,
    simulationTimeMs: campaign?.time.simulationTimeMs ?? 0,
    stateHash: campaign === null ? null : campaignStateHash(campaign),
    contentHash: content.contentHash,
  };
}

/** The next boundary a campaign will resolve, or `null` when none is queued. */
function nextBoundaryOf(scheduler: SchedulerState): { readonly dueAtMs: number } | null {
  return scheduler.entries[0] ?? null;
}
