import { describe, expect, it } from 'vitest';

import { findTransportViolation, isTransportValue } from '@protocol';

/**
 * Protocol payloads use the JSON-compatible subset of structured-clone data so
 * the same messages survive a future network transport (Technical
 * Specification 4.2).
 */
describe('transport values', () => {
  it('accepts the JSON-compatible subset [TECH-4.2]', () => {
    const value = {
      requestId: 'r-1',
      nested: { list: [1, 'two', true, null, { deep: -0.5 }] },
      empty: {},
    };

    expect(isTransportValue(value)).toBe(true);
    expect(findTransportViolation(value)).toBeNull();
  });

  it.each([
    ['undefined', { a: undefined }, 'a', 'undefined'],
    ['NaN', { a: Number.NaN }, 'a', 'non-finite-number'],
    ['Infinity', { a: Number.POSITIVE_INFINITY }, 'a', 'non-finite-number'],
    ['a bigint', { a: 1n }, 'a', 'bigint'],
    ['a symbol', { a: Symbol('s') }, 'a', 'symbol'],
    ['a function', { a: () => undefined }, 'a', 'function'],
    ['a Date', { a: new Date(0) }, 'a', 'non-plain-object'],
    ['a Map', { a: new Map() }, 'a', 'non-plain-object'],
    ['a Set', { a: new Set() }, 'a', 'non-plain-object'],
    ['a typed array', { a: new Uint8Array(1) }, 'a', 'non-plain-object'],
  ])('rejects %s and names the path [TECH-4.2]', (_label, value, path, reason) => {
    const violation = findTransportViolation(value);

    expect(violation).not.toBeNull();
    expect(violation?.path).toBe(path);
    expect(violation?.reason).toBe(reason);
  });

  it('names the path inside arrays and nested objects [TECH-4.2]', () => {
    const violation = findTransportViolation({ payload: { items: [{ when: undefined }] } });

    expect(violation).toEqual({ path: 'payload.items[0].when', reason: 'undefined' });
  });

  it('rejects a cyclic structure instead of recursing forever [TECH-4.2]', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;

    expect(findTransportViolation(cyclic)?.reason).toBe('cycle');
  });

  it('accepts a class instance only when it is a plain object [TECH-4.2]', () => {
    class Holder {
      readonly value = 1;
    }

    expect(findTransportViolation(new Holder())?.reason).toBe('non-plain-object');
    expect(findTransportViolation(Object.create(null) as object)).toBeNull();
  });
});
