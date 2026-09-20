/**
 * Simulation-time display (Functional Specification 4.1).
 *
 * Time is shown in simulation seconds, minutes, hours and days. Below one
 * minute the interface shows whole seconds, because nothing on this surface is
 * a timing decision; a surface where timing matters shows tenths instead.
 *
 * Rounding happens here and only here: the value that arrives is the
 * unrounded authoritative one.
 *
 * @implements FUNC-4.1
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatSimulationDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '0s';
  }

  const days = Math.floor(milliseconds / DAY_MS);
  const hours = Math.floor((milliseconds % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((milliseconds % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((milliseconds % MINUTE_MS) / SECOND_MS);

  if (days > 0) {
    return `${String(days)}d ${pad(hours)}h`;
  }
  if (hours > 0) {
    return `${String(hours)}h ${pad(minutes)}m`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${pad(seconds)}s`;
  }
  return `${String(seconds)}s`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
