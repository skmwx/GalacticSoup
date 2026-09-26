import type { CampaignState } from '@engine/domain';
import { advanceGuidance, raiseNotifications } from '@engine/simulation';
import type { CommandType } from '@protocol';

import type { Transaction } from './transaction';

/**
 * What the campaign learns from a transaction once it has applied its change
 * (Technical Specification 9.2 steps 9-10, 10.6, 12.4).
 *
 * Guidance and notifications react to what a command or an elapsed interval
 * did; they never decide it. They run inside the same transaction, after the
 * change and before the invariants, so a step completed or a notification
 * raised commits with the change that caused it or not at all. Guidance runs
 * first so that a completed step can itself be told to the player.
 *
 * Opening, restoring and closing a campaign are not observed: a resumed
 * campaign must be the snapshot it came from, to the hash.
 *
 * @implements TECH-9.2, TECH-10.6, TECH-12.4
 */

const UNOBSERVED: ReadonlySet<CommandType> = new Set<CommandType>([
  'campaign.create',
  'campaign.resume',
  'campaign.close',
  'campaign.reset',
]);

export function observeTransaction(
  transaction: Transaction,
  type: CommandType,
  before: CampaignState | null,
): void {
  if (UNOBSERVED.has(type) || transaction.draft === null) return;
  const context = transaction.simulation();
  advanceGuidance(context, transaction.publishedEvents());
  raiseNotifications(context, transaction.publishedEvents(), before);
}
