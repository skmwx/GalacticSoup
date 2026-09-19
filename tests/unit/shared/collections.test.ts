import { describe, expect, it } from 'vitest';

import { compareStable, deepFreeze, indexBy, sortedBy, sortedEntries, sortedKeys } from '@shared';

/**
 * Authoritative logic must not depend on object-property order, and ordering
 * must not depend on a locale, or the same content would iterate differently on
 * two machines (Technical Specification 5.3).
 */
describe('stable ordering', () => {
  it('compares by code unit, not by locale [TECH-5.3]', () => {
    const words = ['ä', 'z', 'a', 'Z'];

    expect([...words].sort(compareStable)).toEqual(['Z', 'a', 'z', 'ä']);
  });

  it('orders items by the key they report [TECH-5.3]', () => {
    const items = [{ id: 'module.b' }, { id: 'module.a' }, { id: 'module.c' }];

    expect(sortedBy(items, (item) => item.id).map((item) => item.id)).toEqual([
      'module.a',
      'module.b',
      'module.c',
    ]);
  });

  it('does not modify the source collection [TECH-5.3]', () => {
    const items = [{ id: 'b' }, { id: 'a' }];
    sortedBy(items, (item) => item.id);

    expect(items.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('orders record keys and entries the same way [TECH-5.3]', () => {
    const record = { zeta: 1, alpha: 2, Mu: 3 };

    expect(sortedKeys(record)).toEqual(['Mu', 'alpha', 'zeta']);
    expect(sortedEntries(record)).toEqual([
      ['Mu', 3],
      ['alpha', 2],
      ['zeta', 1],
    ]);
  });
});

describe('indexing by stable id', () => {
  it('builds an index in id order [TECH-5.3]', () => {
    const result = indexBy([{ id: 'b' }, { id: 'a' }], (item) => item.id);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect([...result.index.keys()]).toEqual(['a', 'b']);
  });

  it('reports a duplicate instead of letting the last one win [TECH-5.3, TECH-6.2]', () => {
    const result = indexBy([{ id: 'a', n: 1 }, { id: 'a', n: 2 }], (item) => item.id);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.duplicateKey).toBe('a');
  });
});

describe('deep freezing', () => {
  it('freezes nested content [TECH-6.3]', () => {
    const value = deepFreeze({ outer: { inner: [{ id: 'a' }] } });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.outer)).toBe(true);
    expect(Object.isFrozen(value.outer.inner)).toBe(true);
    expect(Object.isFrozen(value.outer.inner[0])).toBe(true);
  });

  it('terminates on a value that refers to itself [TECH-6.3]', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;

    expect(Object.isFrozen(deepFreeze(cyclic))).toBe(true);
  });
});
