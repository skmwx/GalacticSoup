import type { CombatState } from './types';

/**
 * A campaign begins with no combat runtime: nothing is locked, no weapon is
 * cycling and no reload is under way (Functional Specification 3.1, 9.2).
 */
export function startingCombat(): CombatState {
  return { version: 1, ships: {} };
}
