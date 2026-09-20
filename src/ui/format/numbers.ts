/**
 * Player-facing number formatting (Functional Specification 4.1;
 * Technical Specification 12.5).
 *
 * Authoritative values arrive unrounded and in canonical units: whole credits,
 * whole cubic-decimetre units, fractions for resistances and rates. Rounding
 * and grouping are presentation decisions, so they happen here and only here,
 * and they go through `Intl` so a later locale gets its own separators without
 * a second implementation.
 *
 * @implements FUNC-4.1, TECH-12.5
 */

const CUBIC_DECIMETRES_PER_CUBIC_METRE = 1000;

const integerFormatters = new Map<string, Intl.NumberFormat>();
const decimalFormatters = new Map<string, Intl.NumberFormat>();

/** Whole credits, grouped. Negative values keep their sign; zero has none. */
export function formatCredits(credits: number, locale: string): string {
  return integerFormatter(locale).format(withoutNegativeZero(Math.round(credits)));
}

/** A whole count of units, grouped. */
export function formatQuantity(quantity: number, locale: string): string {
  return integerFormatter(locale).format(withoutNegativeZero(Math.round(quantity)));
}

/**
 * Canonical cubic-decimetre units as cubic metres, which is the unit the
 * functional specification shows cargo in.
 */
export function formatVolume(cubicDecimetres: number, locale: string): string {
  return decimalFormatter(locale, 3).format(
    cubicDecimetres / CUBIC_DECIMETRES_PER_CUBIC_METRE,
  );
}

/** A 0-1 fraction as a whole percentage. */
export function formatPercent(fraction: number, locale: string): string {
  return `${decimalFormatter(locale, 0).format(fraction * 100)}%`;
}

/** A derived statistic, at the precision its magnitude deserves. */
export function formatStat(value: number, locale: string): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  if (Number.isInteger(value)) {
    return integerFormatter(locale).format(withoutNegativeZero(value));
  }
  return decimalFormatter(locale, Math.abs(value) < 10 ? 3 : 1).format(value);
}

/** A signed difference, so a comparison row reads as a change. */
export function formatDifference(value: number, locale: string): string {
  const formatted = formatStat(Math.abs(value), locale);
  if (value === 0) {
    return formatted;
  }
  return value > 0 ? `+${formatted}` : `-${formatted}`;
}

/**
 * Rounding a small negative value produces negative zero, which formats as
 * "-0". Nothing the player sees is a signed zero.
 */
function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function integerFormatter(locale: string): Intl.NumberFormat {
  const existing = integerFormatters.get(locale);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  integerFormatters.set(locale, created);
  return created;
}

function decimalFormatter(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}:${String(digits)}`;
  const existing = decimalFormatters.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Intl.NumberFormat(locale, { maximumFractionDigits: digits });
  decimalFormatters.set(key, created);
  return created;
}
