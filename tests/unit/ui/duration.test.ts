import { describe, expect, it } from 'vitest';

import { formatSimulationDuration } from '@ui';

/**
 * Simulation time is shown in seconds, minutes, hours and days, and rounded
 * only for display (Functional Specification 4.1).
 */
describe('simulation duration', () => {
  it.each([
    [0, '0s'],
    [-1, '0s'],
    [999, '0s'],
    [1_000, '1s'],
    [59_999, '59s'],
    [60_000, '1m 00s'],
    [95_000, '1m 35s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h 00m'],
    [7_500_000, '2h 05m'],
    [86_400_000, '1d 00h'],
    [180_000_000, '2d 02h'],
  ])('shows %i ms as %s [FUNC-4.1]', (milliseconds, expected) => {
    expect(formatSimulationDuration(milliseconds)).toBe(expected);
  });

  it('never shows a fractional second on this surface [FUNC-4.1]', () => {
    expect(formatSimulationDuration(1_500)).toBe('1s');
    expect(formatSimulationDuration(1_999)).toBe('1s');
  });
});
