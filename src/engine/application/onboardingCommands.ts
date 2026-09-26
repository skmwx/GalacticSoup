import { findGuidanceStep, recordStep, setGuidanceHidden } from '@engine/domain';
import type { SkipGuidanceStepPayload } from '@protocol';

import { APPLIED, reject, UNCHANGED, type CommandOutcome, type Transaction } from './transaction';

/**
 * The guidance commands (Functional Specification 3.2; Technical
 * Specification 7.2 tutorial state).
 *
 * The guidance is optional: it can be hidden and shown again at any time, and
 * any step the content marks skippable can be skipped. Skipping records the
 * step as behind the player and grants nothing - the MVP guidance needs no
 * tutorial-specific items to keep later steps completable.
 *
 * @implements FUNC-3.2, FUNC-22.10, TECH-7.2, MVP-AC-10
 */
export function handleOnboardingCommand(
  transaction: Transaction,
  type: 'onboarding.hide' | 'onboarding.show' | 'onboarding.skipStep',
  payload: unknown,
): CommandOutcome {
  const draft = transaction.draft;
  if (draft === null) return reject('noCampaignOpen');
  switch (type) {
    case 'onboarding.hide':
    case 'onboarding.show': {
      const hidden = type === 'onboarding.hide';
      if (!setGuidanceHidden(draft, hidden)) return UNCHANGED;
      transaction.publish(hidden ? 'onboarding.hidden' : 'onboarding.shown');
      transaction.invalidate('onboarding');
      return APPLIED;
    }
    case 'onboarding.skipStep': {
      const { stepId } = payload as SkipGuidanceStepPayload;
      const found = findGuidanceStep(transaction.content, stepId);
      if (found === null) return reject('guidanceStepUnknown', { stepId });
      if (draft.onboarding.steps[stepId] !== undefined) return reject('guidanceStepRecorded', { stepId });
      if (!found.step.skippable) return reject('guidanceStepNotSkippable', { stepId });
      recordStep(draft, stepId, 'skipped');
      transaction.publish('onboarding.stepSkipped', { chainId: found.chain.id, stepId });
      transaction.invalidate('onboarding');
      return APPLIED;
    }
    default:
      return assertUnreachable(type);
  }
}

function assertUnreachable(type: never): never {
  throw new Error(`Unhandled guidance command: ${String(type)}`);
}
