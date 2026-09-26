import type {
  ContentRepository,
  GuidanceChainDefinition,
  GuidanceStepDefinition,
} from '@engine/ports';

import type { CampaignDraft, CampaignState } from '../campaign/state';

import type { GuidanceStepOutcome, GuidanceStepStatus, OnboardingState } from './types';

/**
 * Guidance progress rules (Functional Specification 3.2; Technical
 * Specification 10.6).
 *
 * A step is open once every step it requires is behind the player. Steps are
 * shown in authored order, and the current step is the first open one - but an
 * open step completes whenever its predicate is met, so a player who does
 * something early is never asked to do it again.
 *
 * @implements FUNC-3.2, TECH-10.6
 */

export function isStepRecorded(onboarding: OnboardingState, stepId: string): boolean {
  return onboarding.steps[stepId] !== undefined;
}

export function isStepOpen(onboarding: OnboardingState, step: GuidanceStepDefinition): boolean {
  return !isStepRecorded(onboarding, step.id) &&
    step.requires.every((required) => isStepRecorded(onboarding, required));
}

/** The step the player is pointed at, or `null` when the chain is finished. */
export function currentStep(
  onboarding: OnboardingState,
  chain: GuidanceChainDefinition,
): GuidanceStepDefinition | null {
  return chain.steps.find((step) => isStepOpen(onboarding, step)) ?? null;
}

export function stepStatus(
  onboarding: OnboardingState,
  chain: GuidanceChainDefinition,
  step: GuidanceStepDefinition,
): GuidanceStepStatus {
  const record = onboarding.steps[step.id];
  if (record !== undefined) return record.outcome;
  if (!isStepOpen(onboarding, step)) return 'waiting';
  return currentStep(onboarding, chain)?.id === step.id ? 'current' : 'open';
}

/** Every step of every chain is behind the player. */
export function guidanceFinished(onboarding: OnboardingState, content: ContentRepository): boolean {
  return content.guidanceChains().every((chain) =>
    chain.steps.every((step) => isStepRecorded(onboarding, step.id)));
}

/**
 * Records a step. Returns false, changing nothing, when it is already
 * recorded: the record is the step's one-time grant (Technical Specification
 * 10.6, 15.3 check 9).
 */
export function recordStep(
  draft: CampaignDraft,
  stepId: string,
  outcome: GuidanceStepOutcome,
): boolean {
  const onboarding = draft.onboarding;
  if (isStepRecorded(onboarding, stepId)) return false;
  draft.onboarding = {
    ...onboarding,
    version: onboarding.version + 1,
    steps: { ...onboarding.steps, [stepId]: { outcome, atMs: draft.time.simulationTimeMs } },
  };
  return true;
}

export function setGuidanceHidden(draft: CampaignDraft, hidden: boolean): boolean {
  if (draft.onboarding.hidden === hidden) return false;
  draft.onboarding = { ...draft.onboarding, version: draft.onboarding.version + 1, hidden };
  return true;
}

/** The chain that holds a step, with the step. */
export function findGuidanceStep(
  content: ContentRepository,
  stepId: string,
): { readonly chain: GuidanceChainDefinition; readonly step: GuidanceStepDefinition } | null {
  for (const chain of content.guidanceChains()) {
    const step = chain.steps.find((candidate) => candidate.id === stepId);
    if (step !== undefined) return { chain, step };
  }
  return null;
}

/** Open steps of every chain, in chain order then authored order. */
export function openSteps(
  state: CampaignState,
  content: ContentRepository,
): readonly GuidanceStepDefinition[] {
  return content.guidanceChains().flatMap((chain) =>
    chain.steps.filter((step) => isStepOpen(state.onboarding, step)));
}
