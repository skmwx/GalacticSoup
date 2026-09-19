import { describe, expect, it } from 'vitest';

import { bundleDigest, createContentRepository, parseContentBundle } from '@adapters/content';
import { ContentIntegrityError, ContentLookupError } from '@engine';
import { asDefinitionId } from '@shared';

import { compilePack, fixtureRepository, minimalPack } from '../../support/contentFixtures.ts';

/**
 * The content port implementation (Technical Specification 6.3, 14).
 *
 * A bundle is untrusted input at its boundary: it is bounded, its digest is
 * checked against its canonical bytes, and its authored units become canonical
 * ones. After that the engine sees only frozen definitions in stable id order.
 */

function compiledBundle(): Record<string, unknown> {
  const result = compilePack(minimalPack());
  if (result.bundle === null) {
    throw new Error('expected a compiled bundle');
  }
  return result.bundle;
}

describe('bundle loading', () => {
  it('accepts the bundle the compiler produced [TECH-6.3]', () => {
    const content = fixtureRepository();

    expect(content.contentVersion).toMatch(/^9\.9\.9\+[0-9a-f]{12}$/);
    expect(content.contentHash).toHaveLength(64);
    expect(content.defaultLocale).toBe('en');
    expect(content.locales).toEqual(['en']);
  });

  it('rejects a bundle whose digest does not match its bytes [TECH-6.3, TECH-14]', () => {
    const tampered = { ...compiledBundle(), defaultLocale: 'fr' };

    expect(() => parseContentBundle(tampered)).toThrow(ContentIntegrityError);
    try {
      parseContentBundle(tampered);
    } catch (error) {
      expect((error as ContentIntegrityError).reason).toBe('digest-mismatch');
    }
  });

  it('rejects a bundle that is missing a definition collection [TECH-14]', () => {
    const bundle = compiledBundle();
    const definitions = { ...(bundle['definitions'] as Record<string, unknown>) };
    delete definitions['hulls'];
    const broken = { ...bundle, definitions };

    expect(() => parseContentBundle({ ...broken, contentHash: bundleDigest(broken) })).toThrow(
      ContentIntegrityError,
    );
  });

  it('rejects a value the structural limits forbid [TECH-14]', () => {
    expect(() => parseContentBundle({ contentHash: Number.NaN })).toThrow(ContentIntegrityError);
  });

  it('converts authored cubic metres to canonical units [TECH-5.2, TECH-6.3]', () => {
    const content = fixtureRepository();
    const hull = content.requireHull(asDefinitionId('hull.test.starter', 'hull'));
    const charge = content.requireAmmunition(asDefinitionId('ammo.test.charge', 'ammo'));

    // 100 m3 and 0.002 m3 as authored.
    expect(hull.cargoCapacityCubicDecimetres).toBe(100_000);
    expect(charge.volumeCubicDecimetres).toBe(2);
    expect(hull).not.toHaveProperty('cargoCapacityCubicMetres');
    expect(charge).not.toHaveProperty('volumeCubicMetres');
  });

  it('freezes definitions so nothing can write to content [TECH-6.3]', () => {
    const hull = fixtureRepository().requireHull(asDefinitionId('hull.test.starter', 'hull'));

    expect(Object.isFrozen(hull)).toBe(true);
    expect(Object.isFrozen(hull.defenses.shield.resistances)).toBe(true);
  });

  it('rejects two definitions that share an id [TECH-6.2, TECH-6.3]', () => {
    const bundle = compiledBundle();
    const definitions = bundle['definitions'] as Record<string, Record<string, unknown>[]>;
    const hulls = definitions['hulls'] as Record<string, unknown>[];
    const duplicated = {
      ...bundle,
      definitions: { ...definitions, hulls: [hulls[0], hulls[0]] },
    };

    expect(() =>
      createContentRepository(
        parseContentBundle({ ...duplicated, contentHash: bundleDigest(duplicated) }),
      ),
    ).toThrow(ContentIntegrityError);
  });
});

describe('lookups', () => {
  const content = fixtureRepository();

  it('resolves each kind by its stable id [TECH-6.3]', () => {
    expect(content.hull('hull.test.starter')?.id).toBe('hull.test.starter');
    expect(content.module('module.test.turret')?.id).toBe('module.test.turret');
    expect(content.ammunition('ammo.test.charge')?.id).toBe('ammo.test.charge');
    expect(content.item('item.test.salvage')?.id).toBe('item.test.salvage');
    expect(content.system('system.test')?.id).toBe('system.test');
    expect(content.station('station.test.dock')?.id).toBe('station.test.dock');
    expect(content.npcProfile('npc.test.pirate')?.id).toBe('npc.test.pirate');
    expect(content.lootTable('loot.test.pirate')?.id).toBe('loot.test.pirate');
    expect(content.encounter('encounter.test.skirmish')?.id).toBe('encounter.test.skirmish');
  });

  it('returns nothing for an unknown id [TECH-6.3]', () => {
    expect(content.hull('hull.test.missing')).toBeUndefined();
    expect(content.tradeable('item.test.missing')).toBeUndefined();
  });

  it('names the kind and id when a required definition is missing [TECH-5.4, TECH-6.3]', () => {
    expect(() =>
      content.requireHull(asDefinitionId('hull.test.missing', 'hull')),
    ).toThrow(ContentLookupError);
    try {
      content.requireEncounter(asDefinitionId('encounter.test.missing', 'encounter'));
    } catch (error) {
      expect((error as ContentLookupError).kind).toBe('encounter');
      expect((error as ContentLookupError).definitionId).toBe('encounter.test.missing');
    }
  });

  it('treats items, modules and ammunition alike as cargo [TECH-6.3, FUNC-6.1]', () => {
    expect(content.tradeable('item.test.salvage')?.id).toBe('item.test.salvage');
    expect(content.tradeable('module.test.turret')?.id).toBe('module.test.turret');
    expect(content.tradeable('ammo.test.charge')?.id).toBe('ammo.test.charge');
    expect(content.tradeable('hull.test.starter')).toBeUndefined();
  });

  it('returns a station listings in item order [TECH-5.3, FUNC-11.1]', () => {
    const listings = content.listings('station.test.dock');
    const ids = listings.map((listing) => listing.itemId);

    expect(ids).toEqual([...ids].sort());
    expect(listings.length).toBeGreaterThan(0);
    expect(content.listings('station.test.missing')).toEqual([]);
  });

  it('finds the ammunition a turret can load [TECH-6.3, FUNC-9.4]', () => {
    const turret = content.requireModule(asDefinitionId('module.test.turret', 'module'));
    if (turret.category !== 'turret') {
      throw new Error('expected a turret');
    }

    expect(content.ammunitionInGroup(turret.turret.ammunitionGroup).map((entry) => entry.id)).toEqual(
      ['ammo.test.charge'],
    );
    expect(content.ammunitionInGroup('no-such-group')).toEqual([]);
  });

  it('serves authored text by key and locale [TECH-12.5]', () => {
    expect(content.message('en', 'content.hull.test.starter.name')).toBe('Test Starter');
    expect(content.message('en', 'content.missing.key')).toBeUndefined();
    expect(content.message('fr', 'content.hull.test.starter.name')).toBeUndefined();
  });

  it('counts definitions per kind in stable order [TECH-6.3]', () => {
    const counts = content.definitionCounts();

    expect(Object.keys(counts)).toEqual([...Object.keys(counts)].sort());
    expect(counts['hulls']).toBe(content.hulls().length);
    expect(counts['market.listings']).toBe(content.listings('station.test.dock').length);
  });

  it('lists every collection in id order [TECH-5.3]', () => {
    for (const list of [
      content.hulls(),
      content.modules(),
      content.ammunitions(),
      content.items(),
      content.systems(),
      content.stations(),
      content.npcProfiles(),
      content.lootTables(),
      content.encounters(),
    ]) {
      const ids = list.map((entry) => entry.id);
      expect(ids).toEqual([...ids].sort());
    }
  });
});
