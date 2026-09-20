import { describe, expect, it } from 'vitest';

import {
  formatCredits,
  formatDifference,
  formatPercent,
  formatQuantity,
  formatStat,
  formatVolume,
} from '@ui';

/**
 * Player-facing number formatting (Functional Specification 4.1).
 *
 * Authoritative values arrive unrounded and in canonical units. Rounding and
 * grouping happen here and only here, and they go through `Intl`, so a later
 * locale gets its own separators without a second implementation.
 */

const EN = 'en';

describe('credits and quantities', () => {
  it('groups whole credits [FUNC-4.1]', () => {
    expect(formatCredits(20_000, EN)).toBe('20,000');
    expect(formatCredits(0, EN)).toBe('0');
    expect(formatCredits(-4_428, EN)).toBe('-4,428');
  });

  it('never shows a signed zero [FUNC-4.1]', () => {
    expect(formatCredits(-0, EN)).toBe('0');
    expect(formatCredits(-0.4, EN)).toBe('0');
    expect(formatQuantity(-0, EN)).toBe('0');
    expect(formatStat(-0, EN)).toBe('0');
  });

  it('rounds a quantity to whole units [FUNC-4.1]', () => {
    expect(formatQuantity(40, EN)).toBe('40');
    expect(formatQuantity(1_500, EN)).toBe('1,500');
  });
});

describe('volumes', () => {
  it('shows canonical cubic-decimetre units as cubic metres [FUNC-4.1, TECH-5.2]', () => {
    expect(formatVolume(1_000, EN)).toBe('1');
    expect(formatVolume(5, EN)).toBe('0.005');
    expect(formatVolume(0, EN)).toBe('0');
  });
});

describe('statistics', () => {
  it('shows a fraction as a whole percentage [FUNC-4.1]', () => {
    expect(formatPercent(0.5, EN)).toBe('50%');
    expect(formatPercent(0, EN)).toBe('0%');
  });

  it('keeps precision where the magnitude needs it [FUNC-4.1]', () => {
    expect(formatStat(350, EN)).toBe('350');
    expect(formatStat(1.875, EN)).toBe('1.875');
    expect(formatStat(1234.56, EN)).toBe('1,234.6');
    expect(formatStat(Number.NaN, EN)).toBe('-');
  });

  it('signs a difference so a comparison reads as a change [FUNC-19.6]', () => {
    expect(formatDifference(12, EN)).toBe('+12');
    expect(formatDifference(-12, EN)).toBe('-12');
    expect(formatDifference(0, EN)).toBe('0');
  });
});
