import type { EncounterState } from './types';

/** A new campaign has fought nothing and owns no wreck. */
export function startingEncounters(): EncounterState {
  return { version: 1, active: null, wrecks: {}, completions: {}, lastOutcome: null };
}
