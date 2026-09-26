/**
 * Contextual guidance progress (Functional Specification 3.2;
 * Technical Specification 8.1, 10.6).
 */
export {
  currentStep,
  findGuidanceStep,
  guidanceFinished,
  isStepOpen,
  isStepRecorded,
  openSteps,
  recordStep,
  setGuidanceHidden,
  stepStatus,
} from './rules';
export { GUIDANCE_STEP_OUTCOMES, GUIDANCE_STEP_STATUSES } from './types';
export type {
  GuidanceStepOutcome,
  GuidanceStepRecord,
  GuidanceStepStatus,
  OnboardingState,
} from './types';
export { startingOnboarding } from './start';
export { isOnboardingState, validateOnboarding } from './validation';
