import type { CommandAvailabilityData } from '@protocol';
import type { MessageKey } from '@shared';

/**
 * Reading one command's projected availability (Technical Specification 12.3).
 *
 * Projections carry, for each subject, the commands it offers and the message
 * the refused ones would answer with. A control looks its command up here and
 * nowhere else; a command the projection does not mention is treated as
 * refused, because the interface may not assume a rule the engine did not
 * state.
 */

export interface CommandAvailability {
  readonly available: boolean;
  readonly unavailableReason: MessageKey | null;
}

const REFUSED: CommandAvailability = { available: false, unavailableReason: null };

export function commandAvailability(
  commands: readonly CommandAvailabilityData[] | undefined,
  command: string,
): CommandAvailability {
  const entry = commands?.find((candidate) => candidate.command === command);
  return entry === undefined
    ? REFUSED
    : { available: entry.available, unavailableReason: entry.unavailableReason };
}
