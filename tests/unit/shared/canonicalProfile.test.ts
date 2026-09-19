import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalJson, CanonicalJsonError, canonicalNumber, canonicalString, sha256Hex } from '@shared';

import { REPO_ROOT } from '../../../config/aliases.mjs';

/**
 * The canonical JSON profile and its digest (Technical Specification 5.3, 6.3).
 *
 * `tests/fixtures/canonical/profile.json` is the cross-language fixture: a
 * future Java engine must reproduce every canonical string and every digest in
 * it, or the two engines would hash the same state differently. The digest is
 * also compared against the platform implementation, which is the independent
 * check that the hand-written SHA-256 is correct.
 */

interface Fixture {
  readonly numbers: readonly { readonly literal: string; readonly canonical: string }[];
  readonly strings: readonly { readonly value: string; readonly canonical: string }[];
  readonly documents: readonly {
    readonly value: unknown;
    readonly canonical: string;
    readonly sha256: string;
  }[];
  readonly digests: readonly { readonly value: string; readonly sha256: string }[];
}

const fixture = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'tests/fixtures/canonical/profile.json'), 'utf8'),
) as Fixture;

describe('canonical numbers', () => {
  it.each(fixture.numbers)('writes $literal as $canonical [TECH-5.3]', ({ literal, canonical }) => {
    expect(canonicalNumber(Number(literal))).toBe(canonical);
  });

  it('normalises negative zero [TECH-5.3]', () => {
    expect(canonicalNumber(-0)).toBe('0');
    expect(canonicalJson({ value: -0 })).toBe('{"value":0}');
  });

  it('never uses exponent notation [TECH-5.3]', () => {
    for (const { literal } of fixture.numbers) {
      expect(canonicalNumber(Number(literal))).not.toMatch(/e/i);
    }
  });

  it('rejects a non-finite number [TECH-5.3, TECH-5.2]', () => {
    expect(() => canonicalNumber(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(CanonicalJsonError);
  });

  it('names the path of the offending value [TECH-5.3]', () => {
    try {
      canonicalJson({ outer: [{ inner: Number.NaN }] });
      expect.unreachable('expected a CanonicalJsonError');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalJsonError);
      expect((error as CanonicalJsonError).path).toBe('outer[0].inner');
    }
  });
});

describe('canonical strings', () => {
  it.each(fixture.strings)('escapes a fixture string the same way [TECH-5.3]', ({ value, canonical }) => {
    expect(canonicalString(value)).toBe(canonical);
  });

  it('escapes an unpaired surrogate so the output is well-formed [TECH-5.3]', () => {
    expect(canonicalString('\ud800')).toBe('"\\ud800"');
    expect(canonicalString('🚀')).toBe('"🚀"');
  });
});

describe('canonical documents', () => {
  it.each(fixture.documents.map((document, index) => ({ index, ...document })))(
    'reproduces fixture document $index and its digest [TECH-5.3, TECH-6.3]',
    ({ value, canonical, sha256 }) => {
      expect(canonicalJson(value)).toBe(canonical);
      expect(sha256Hex(canonical)).toBe(sha256);
    },
  );

  it('orders object keys lexicographically at every depth [TECH-5.3]', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('keeps array order, which carries meaning [TECH-5.3]', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('omits an absent optional field [TECH-5.3]', () => {
    expect(canonicalJson({ present: 1, absent: undefined })).toBe('{"present":1}');
  });

  it('produces the same bytes whichever order the keys were written in [TECH-5.3]', () => {
    const first = canonicalJson({ alpha: 1, beta: { x: 1, y: 2 } });
    const second = canonicalJson({ beta: { y: 2, x: 1 }, alpha: 1 });

    expect(first).toBe(second);
  });

  it('rejects a class instance, which no protocol or save may contain [TECH-5.3]', () => {
    expect(() => canonicalJson(new Map())).toThrow(CanonicalJsonError);
  });
});

describe('digest', () => {
  it.each(fixture.digests)('matches the fixture digest for $value [TECH-6.3]', ({ value, sha256 }) => {
    expect(sha256Hex(value)).toBe(sha256);
  });

  it.each(['', 'abc', 'Galactic Soup', 'ünïcøde ☃', 'x'.repeat(1000), 'y'.repeat(64)])(
    'agrees with the platform implementation [TECH-6.3, TECH-14]',
    (value) => {
      expect(sha256Hex(value)).toBe(createHash('sha256').update(value, 'utf8').digest('hex'));
    },
  );
});
