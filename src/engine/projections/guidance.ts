import { currentStep, stepStatus, type CampaignState } from '@engine/domain';
import type { ContentRepository, GuidanceChainDefinition } from '@engine/ports';
import type {
  CommandAvailabilityData,
  GuidanceChainData,
  GuidanceStepData,
  OnboardingData,
} from '@protocol';
import { deepFreeze } from '@shared';

/**
 * The guidance view (Functional Specification 3.2; Technical Specification
 * 7.3, 10.6).
 *
 * Every authored step is published with its status and whether it can be
 * skipped - and if not, why - so the interface can say exactly where the
 * player is and never has to reconstruct progress itself.
 *
 * @implements FUNC-3.2, FUNC-22.10, TECH-7.3, MVP-AC-10
 */
export function onboardingProjection(state: CampaignState, content: ContentRepository): OnboardingData {
  const onboarding = state.onboarding;
  const chains = content.guidanceChains().map((chain) => chainData(state, chain));
  const current = content.guidanceChains()
    .map((chain) => currentStep(onboarding, chain))
    .find((step) => step !== null) ?? null;
  return deepFreeze({
    version: onboarding.version,
    hidden: onboarding.hidden,
    currentStepId: current?.id ?? null,
    chains,
    commands: [
      availability('onboarding.hide', onboarding.hidden ? 'guidance.alreadyHidden' : null),
      availability('onboarding.show', onboarding.hidden ? null : 'guidance.alreadyShown'),
    ],
  });
}

function chainData(state: CampaignState, chain: GuidanceChainDefinition): GuidanceChainData {
  const onboarding = state.onboarding;
  const steps: GuidanceStepData[] = chain.steps.map((step) => {
    const record = onboarding.steps[step.id];
    const status = stepStatus(onboarding, chain, step);
    const skipReason = record !== undefined
      ? 'error.ruleViolation.guidanceStepRecorded'
      : step.skippable ? null : 'error.ruleViolation.guidanceStepNotSkippable';
    return {
      id: step.id,
      titleKey: step.titleKey,
      bodyKey: step.bodyKey,
      surface: step.surface,
      skippable: step.skippable,
      status,
      recordedAtMs: record?.atMs ?? null,
      commands: [availability('onboarding.skipStep', skipReason)],
    };
  });
  const completedCount = steps.filter((step) => step.status === 'completed').length;
  const skippedCount = steps.filter((step) => step.status === 'skipped').length;
  return {
    id: chain.id,
    titleKey: chain.titleKey,
    introKey: chain.introKey,
    completedKey: chain.completedKey,
    steps,
    completedCount,
    skippedCount,
    finished: completedCount + skippedCount === steps.length,
  };
}

function availability(command: string, unavailableReason: string | null): CommandAvailabilityData {
  return { command, available: unavailableReason === null, unavailableReason };
}
