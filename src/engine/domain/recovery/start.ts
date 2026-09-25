import type { RecoveryState } from './types';

/** A new campaign has lost nothing. */
export function startingRecovery(): RecoveryState {
  return { version: 1, losses: 0, lastLoss: null };
}
