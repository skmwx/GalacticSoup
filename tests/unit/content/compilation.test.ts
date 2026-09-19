import { describe, expect, it } from 'vitest';

import { bundleDigest } from '@adapters/content';
import { canonicalJson } from '@shared';

import { compilePack, editDocument, minimalPack } from '../../support/contentFixtures.ts';

/**
 * Content compilation (Technical Specification 6.3).
 *
 * The bundle must be a function of the content, not of the order the files
 * happened to be read in: the same content always produces the same canonical
 * bytes, the same digest and the same `contentVersion`, and any change to the
 * content changes all three.
 */

function bundleOf(pack = minimalPack()): Record<string, unknown> {
  const result = compilePack(pack);
  expect(result.issues).toEqual([]);
  if (result.bundle === null) {
    throw new Error('expected a compiled bundle');
  }
  return result.bundle;
}

describe('canonical output', () => {
  it('is identical whichever order the files arrive in [TECH-6.3]', () => {
    const forwards = bundleOf(minimalPack());
    const backwards = bundleOf([...minimalPack()].reverse());

    expect(canonicalJson(backwards)).toBe(canonicalJson(forwards));
  });

  it('is identical when definitions are authored in another order [TECH-5.3, TECH-6.3]', () => {
    const reordered = editDocument(minimalPack(), 'catalog/hulls.json', (document) => {
      document['definitions'] = (document['definitions'] as unknown[]).reverse();
    });

    expect(canonicalJson(bundleOf(reordered))).toBe(canonicalJson(bundleOf()));
  });

  it('sorts every definition collection by stable id [TECH-5.3]', () => {
    const definitions = bundleOf()['definitions'] as Record<string, { id: string }[]>;

    for (const [kind, entries] of Object.entries(definitions)) {
      const ids = entries.map((entry) => entry.id);
      expect(ids, kind).toEqual([...ids].sort());
    }
  });

  it('sorts listings by station then item [TECH-5.3, FUNC-11.1]', () => {
    const listings = bundleOf()['listings'] as { stationId: string; itemId: string }[];
    const keys = listings.map((listing) => `${listing.stationId}\u0000${listing.itemId}`);

    expect(keys).toEqual([...keys].sort());
  });

  it('strips authoring-only metadata [TECH-6.3]', () => {
    const withComments = editDocument(minimalPack(), 'catalog/items.json', (document) => {
      document['$comment'] = 'authoring note';
      const definitions = document['definitions'] as Record<string, unknown>[];
      (definitions[0] as Record<string, unknown>)['$comment'] = 'another note';
    });

    expect(canonicalJson(bundleOf(withComments))).toBe(canonicalJson(bundleOf()));
    expect(canonicalJson(bundleOf(withComments))).not.toContain('authoring note');
  });
});

describe('content identity', () => {
  it('derives the version from the manifest and the digest [TECH-6.3]', () => {
    const bundle = bundleOf();
    const hash = bundle['contentHash'] as string;

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle['contentVersion']).toBe(`9.9.9+${hash.slice(0, 12)}`);
  });

  it('hashes the canonical bytes of everything except the identity [TECH-6.3]', () => {
    const bundle = bundleOf();

    expect(bundleDigest(bundle)).toBe(bundle['contentHash']);
  });

  it('changes the digest when any authored value changes [TECH-6.3]', () => {
    const changed = editDocument(minimalPack(), 'catalog/items.json', (document) => {
      const definitions = document['definitions'] as Record<string, unknown>[];
      (definitions[0] as Record<string, unknown>)['referenceValueCredits'] = 2001;
    });

    expect(bundleOf(changed)['contentHash']).not.toBe(bundleOf()['contentHash']);
  });

  it('keeps the digest when only the authoring order changes [TECH-6.3]', () => {
    expect(bundleOf([...minimalPack()].reverse())['contentHash']).toBe(bundleOf()['contentHash']);
  });
});

describe('compiled bundle contract', () => {
  it('carries every definition kind the engine expects [TECH-6.3]', () => {
    const definitions = bundleOf()['definitions'] as Record<string, unknown[]>;

    expect(Object.keys(definitions).sort()).toEqual([
      'ammunition',
      'encounters',
      'hulls',
      'items',
      'loot.tables',
      'modules',
      'npc.profiles',
      'stations',
      'systems',
    ]);
  });

  it('reports what it compiled [TECH-6.3]', () => {
    const result = compilePack(minimalPack());

    expect(result.stats.files).toBe(minimalPack().length);
    expect(result.stats.definitions).toBeGreaterThan(0);
    expect(result.stats.messages).toBeGreaterThan(0);
  });
});
