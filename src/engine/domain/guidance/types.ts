/**
 * Campaign-owned guidance progress (Functional Specification 3.2 as MVP Scope
 * 3 selects it; Technical Specification 8.1, 10.6).
 *
 * The chain itself is authored content. What the campaign stores is only what
 * the player has done with it: which steps are behind them, how each one was
 * left behind, and whether the guidance is hidden. A step is recorded once;
 * the record is its grant id, so a replayed event can never complete it twice.
 *
 * @implements FUNC-3.2, TECH-8.1, TECH-10.6
 */

/** How a step was left behind. Skipping grants nothing (Functional Specification 3.2). */
export const GUIDANCE_STEP_OUTCOMES = ['completed', 'skipped'] as const;
export type GuidanceStepOutcome = (typeof GUIDANCE_STEP_OUTCOMES)[number];

export interface GuidanceStepRecord {
  readonly outcome: GuidanceStepOutcome;
  /** Simulation time the step was completed or skipped. */
  readonly atMs: number;
}

/** A step as the player currently sees it. */
export const GUIDANCE_STEP_STATUSES = ['completed', 'skipped', 'current', 'open', 'waiting'] as const;
export type GuidanceStepStatus = (typeof GUIDANCE_STEP_STATUSES)[number];

export interface OnboardingState {
  /** Changes whenever anything below changes, for projection binding. */
  readonly version: number;
  /**
   * The player hid the guidance. Steps still record while it is hidden, so
   * showing it again never asks for something the player has already done.
   */
  readonly hidden: boolean;
  /** Completed or skipped steps, keyed by step id. */
  readonly steps: Readonly<Record<string, GuidanceStepRecord>>;
}
