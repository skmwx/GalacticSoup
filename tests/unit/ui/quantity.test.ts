import { describe, expect, it } from 'vitest';

import { readWholeQuantity } from '@ui';

/**
 * A typed quantity is a positive whole number within the stack, or it is
 * refused with a reason; it is never coerced into another amount (FUNC-6.2).
 */
describe('readWholeQuantity [FUNC-6.2]', () => {
  it('accepts a whole number from 1 to the maximum, ignoring surrounding space', () => {
    expect(readWholeQuantity('1', 10)).toEqual({ ok: true, quantity: 1 });
    expect(readWholeQuantity(' 10 ', 10)).toEqual({ ok: true, quantity: 10 });
    expect(readWholeQuantity('007', 10)).toEqual({ ok: true, quantity: 7 });
    expect(readWholeQuantity('5000')).toEqual({ ok: true, quantity: 5000 });
  });

  it('refuses blank input', () => {
    expect(readWholeQuantity('', 10)).toEqual({ ok: false, problem: 'blank' });
    expect(readWholeQuantity('   ', 10)).toEqual({ ok: false, problem: 'blank' });
  });

  it('refuses anything that is not a positive whole number', () => {
    for (const text of ['0', '-3', '2.5', '1e2', '+4', '0x10', 'abc', '9007199254740993']) {
      expect(readWholeQuantity(text, Number.MAX_SAFE_INTEGER), text).toEqual({
        ok: false,
        problem: 'notWhole',
      });
    }
  });

  it('refuses more than the maximum instead of capping it', () => {
    expect(readWholeQuantity('11', 10)).toEqual({ ok: false, problem: 'tooMany' });
  });
});
