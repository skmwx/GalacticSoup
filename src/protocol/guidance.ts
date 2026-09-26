import type { CommandAvailabilityData } from './navigation';

/**
 * The contextual guidance (Functional Specification 3.2 as MVP Scope 3
 * selects it; Technical Specification 7.3, 10.6).
 *
 * The engine publishes every authored step with where it is carried out and
 * how far the player is with it. Which step to point at is the engine's
 * answer too, so the interface never works out progress for itself; it only
 * decides how prominently to show it.
 */

export const GUIDANCE_STEP_STATUS_NAMES = ['completed', 'skipped', 'current', 'open', 'waiting'] as const;
export type GuidanceStepStatusName = (typeof GUIDANCE_STEP_STATUS_NAMES)[number];

export interface GuidanceStepData {
  readonly id: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** The station surface or `space` where the step is carried out. */
  readonly surface: string;
  readonly skippable: boolean;
  readonly status: GuidanceStepStatusName;
  /** When it was completed or skipped, in simulation time; `null` until then. */
  readonly recordedAtMs: number | null;
  /** `onboarding.skipStep` for this step, with the reason when it cannot be skipped. */
  readonly commands: readonly CommandAvailabilityData[];
}

export interface GuidanceChainData {
  readonly id: string;
  readonly titleKey: string;
  readonly introKey: string;
  readonly completedKey: string;
  readonly steps: readonly GuidanceStepData[];
  readonly completedCount: number;
  readonly skippedCount: number;
  /** Every step is behind the player. */
  readonly finished: boolean;
}

export interface OnboardingData {
  /** Changes whenever guidance progress changes. */
  readonly version: number;
  readonly hidden: boolean;
  /** The step the player is pointed at, or `null` when every chain is finished. */
  readonly currentStepId: string | null;
  readonly chains: readonly GuidanceChainData[];
  /** `onboarding.hide` and `onboarding.show`, each with its availability. */
  readonly commands: readonly CommandAvailabilityData[];
}

/** Payload of `onboarding.skipStep`. */
export interface SkipGuidanceStepPayload {
  readonly stepId: string;
}
