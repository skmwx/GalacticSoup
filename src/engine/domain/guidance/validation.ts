import type { ContentRepository } from '@engine/ports';
import { isDefinitionIdIn } from '@shared';

import type { CampaignState } from '../campaign/state';

import { GUIDANCE_STEP_OUTCOMES, type OnboardingState } from './types';

/**
 * Guidance-progress shape and consistency (Technical Specification 15.3,
 * checks 1, 2, 9 and 11).
 *
 * A step can only be recorded once and never in the future, and every step
 * the campaign records must still be authored.
 *
 * @implements TECH-15.3, FUNC-3.2
 */

type Report = (rule: string, path: string, detail: string) => void;

export function isOnboardingState(value: unknown): value is OnboardingState {
  if (!shape(value, ['version', 'hidden', 'steps'])) return false;
  if (!count(value['version']) || value['version'] < 1 || typeof value['hidden'] !== 'boolean') return false;
  const steps = value['steps'];
  if (!record(steps)) return false;
  return Object.entries(steps).every(([stepId, entry]) =>
    isDefinitionIdIn(stepId, 'guide') && shape(entry, ['outcome', 'atMs']) &&
    (GUIDANCE_STEP_OUTCOMES as readonly unknown[]).includes(entry['outcome']) && count(entry['atMs']));
}

export function validateOnboarding(
  state: CampaignState,
  add: Report,
  content?: ContentRepository,
): void {
  if (!isOnboardingState(state.onboarding)) {
    add('onboardingShape', 'onboarding', 'Guidance progress has an unknown field, missing field or invalid value.');
    return;
  }
  for (const [stepId, entry] of Object.entries(state.onboarding.steps)) {
    const path = `onboarding.steps.${stepId}`;
    if (entry.atMs > state.time.simulationTimeMs) {
      add('onboardingConsistency', path, 'A guidance step cannot be recorded in the future.');
    }
    if (content !== undefined && content.guidanceStep(stepId) === undefined) {
      add('onboardingConsistency', path, 'A recorded guidance step is not authored.');
    }
  }
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
