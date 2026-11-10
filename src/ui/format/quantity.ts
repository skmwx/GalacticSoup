/**
 * Reading a quantity the player typed (Functional Specification 6.2, 11.3).
 *
 * A quantity is a positive whole number of units no larger than what is
 * there. Anything else - blank, fractional, negative, exponent notation or too
 * many - is refused rather than coerced, because quietly turning "2.5" or ""
 * into some other amount would move or sell units the player did not ask for.
 * The engine still validates every command; this only decides whether the
 * interface offers one.
 *
 * @implements FUNC-6.2
 */

export type QuantityReading =
  | { readonly ok: true; readonly quantity: number }
  | { readonly ok: false; readonly problem: 'blank' | 'notWhole' | 'tooMany' };

export function readWholeQuantity(text: string, maximum?: number): QuantityReading {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, problem: 'blank' };
  }
  const value = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(value) || value < 1) {
    return { ok: false, problem: 'notWhole' };
  }
  if (maximum !== undefined && value > maximum) {
    return { ok: false, problem: 'tooMany' };
  }
  return { ok: true, quantity: value };
}
