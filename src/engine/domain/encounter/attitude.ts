import type { CampaignState } from '../campaign/state';

import { isEncounterShip } from './state';

/**
 * How the player stands toward one object in the loaded site
 * (Functional Specification 9.1, 19.3).
 *
 * A ship is hostile when its faction state, its encounter role or a previous
 * action lets the player attack it without a standing penalty. The MVP has no
 * factions and no standings, so an encounter role is the only thing that makes
 * a ship hostile here: every opponent an authored site spawned is one, and
 * nothing else is. The interface draws the answer with a shape as well as a
 * colour; it never decides it.
 *
 * @implements FUNC-9.1, FUNC-19.3
 */

export const OBJECT_ATTITUDES = ['own', 'hostile', 'neutral'] as const;

export type ObjectAttitude = (typeof OBJECT_ATTITUDES)[number];

export function objectAttitude(state: CampaignState, objectId: string): ObjectAttitude {
  if (objectId === state.assets.activeShipId) return 'own';
  return isEncounterShip(state, objectId) ? 'hostile' : 'neutral';
}
