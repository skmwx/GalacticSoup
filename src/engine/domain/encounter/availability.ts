import type { ContentRepository } from '@engine/ports';

import type { CampaignState } from '../campaign/state';
import { isDestroyed } from '../combat/state';
import { distance } from '../navigation/geometry';

import { wreck } from './state';

/**
 * Whether each loot command may be issued right now, and why not
 * (Functional Specification 9.11, 22.10; Technical Specification 12.3).
 *
 * The same predicates answer the command handler and the projection, as the
 * navigation and combat ones do, so a wreck the player cannot reach is never
 * offered with a take control that the engine would then refuse.
 *
 * @implements TECH-12.3, FUNC-9.11, FUNC-22.10
 */

export const ENCOUNTER_COMMANDS = ['loot.take'] as const;

export type EncounterCommand = (typeof ENCOUNTER_COMMANDS)[number];

export const ENCOUNTER_REFUSALS = [
  'lootUnavailable',
  'wreckNotFound',
  'wreckOutOfRange',
] as const;

export type EncounterRefusal = (typeof ENCOUNTER_REFUSALS)[number];

/** `null` means the command may be issued. */
export type EncounterCommandRefusal = EncounterRefusal | null;

export interface EncounterRuleInput {
  readonly state: CampaignState;
  readonly content: ContentRepository;
}

/**
 * Refuses opening or emptying one wreck (Functional Specification 9.11).
 *
 * A wreck is read and taken from at the same distance, so one predicate
 * answers both the contents query and the take command.
 */
export function wreckAccessRefusal(
  { state, content }: EncounterRuleInput,
  wreckId: string,
): EncounterCommandRefusal {
  const location = state.assets.location;
  const site = state.navigation.currentSite;
  const playerId = state.assets.activeShipId;
  const player = playerId === null ? undefined : site?.objects[playerId];
  if (location.kind !== 'site' || site === null || playerId === null || player === undefined) {
    return 'lootUnavailable';
  }
  if (isDestroyed(state, playerId)) return 'lootUnavailable';

  const target = wreck(state, wreckId);
  const object = site.objects[wreckId];
  if (target === null || object === undefined || target.siteId !== site.siteId) {
    return 'wreckNotFound';
  }
  return distance(player.position, object.position) > content.rules.combat.wreckAccessRangeKm
    ? 'wreckOutOfRange'
    : null;
}
