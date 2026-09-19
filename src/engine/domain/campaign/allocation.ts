import { entityIdOf, MAX_ORDINAL, type EntityId } from './identity';
import type { CampaignDraft } from './state';

/**
 * Ordinal allocation (Technical Specification 5.1).
 *
 * Identifier and event ordinals are campaign state, and allocation happens on
 * the transaction draft. A command that fails before commit therefore consumes
 * no ordinal, and a replay of the same command log allocates exactly the same
 * identifiers.
 *
 * @implements TECH-5.1
 */

export class OrdinalExhaustedError extends Error {
  constructor(field: string) {
    super(`The campaign ran out of ${field} ordinals.`);
    this.name = 'OrdinalExhaustedError';
  }
}

export function allocateEntityId(draft: CampaignDraft): EntityId {
  const ordinal = draft.nextEntityOrdinal;
  if (ordinal >= MAX_ORDINAL) {
    throw new OrdinalExhaustedError('entity');
  }
  draft.nextEntityOrdinal = ordinal + 1;
  return entityIdOf(draft.campaignId, ordinal);
}

export function allocateEventOrdinal(draft: CampaignDraft): number {
  const ordinal = draft.nextEventOrdinal;
  if (ordinal >= MAX_ORDINAL) {
    throw new OrdinalExhaustedError('event');
  }
  draft.nextEventOrdinal = ordinal + 1;
  return ordinal;
}
