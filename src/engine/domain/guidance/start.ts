import type { OnboardingState } from './types';

/** A new campaign has done nothing and shows the guidance. */
export function startingOnboarding(): OnboardingState {
  return { version: 1, hidden: false, steps: {} };
}
