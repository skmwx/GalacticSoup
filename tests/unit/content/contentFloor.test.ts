import { describe, expect, it } from 'vitest';

import {
  compilePack,
  editDocument,
  minimalPack,
  shippedPack,
  type ContentFile,
  type ContentIssue,
} from '../../support/contentFixtures.ts';

/**
 * The delivery content floor (MVP Scope 4.1-4.2, as carried into v0.2;
 * FeatureSpec02 4-8; v0.2 Implementation Plan phase 0).
 *
 * The shipped manifest names a development milestone profile; the release
 * profile adds the complete v0.2 quantities and must refuse the content until
 * the catalog and ladder phases have delivered it.
 *
 * The shipped bundle must sell enough at the starting station for two combat
 * approaches and offer three repeatable encounters that press the player in
 * different ways. Each case removes one of those things from the shipped
 * content and expects the floor to name it. Fixture packs are held to the
 * game's rules only, so the minimal pack still compiles.
 */

const HARBOUR = 'economy/listings/borrell-harbour.json';
const ENCOUNTERS = 'encounters/templates/borrell.json';

function floorIssues(pack: readonly ContentFile[]): readonly ContentIssue[] {
  const result = compilePack(pack, { floor: true });
  expect(result.ok).toBe(false);
  return result.issues;
}

function withoutListings(...itemIds: string[]): ContentFile[] {
  return editDocument(shippedPack(), HARBOUR, (document) => {
    document['listings'] = (document['listings'] as { itemId: string }[])
      .filter((listing) => !itemIds.includes(listing.itemId));
  });
}

function editEncounters(edit: (definitions: Record<string, unknown>[]) => void): ContentFile[] {
  return editDocument(shippedPack(), ENCOUNTERS, (document) => {
    edit(document['definitions'] as Record<string, unknown>[]);
  });
}

describe('the MVP content floor', () => {
  it('holds for the shipped content, and only the shipped content is held to it [MVP-AC-05, MVP-AC-07, TECH-6.2]', () => {
    expect(compilePack(shippedPack(), { floor: true }).issues).toEqual([]);
    // The minimal pack has one encounter and one turret; the game's rules
    // allow that, the MVP selection does not.
    expect(compilePack(minimalPack()).ok).toBe(true);
    expect(compilePack(minimalPack(), { floor: true }).ok).toBe(false);
  });

  it('needs an active defence, passive resistance, propulsion and capacitor support on sale [MVP-AC-02, FUNC-8.3]', () => {
    const issues = floorIssues(withoutListings(
      'module.shield.booster.small',
      'module.repair.armor.small',
      'module.plating.armor.small',
      'module.propulsion.afterburner.small',
      'module.capacitor.battery.small',
    ));
    const details = issues.map((entry) => entry.detail);

    for (const missing of ['active defensive', 'passive resistance', 'propulsion', 'capacitor-support']) {
      expect(details.some((detail) => detail.includes(missing))).toBe(true);
    }
    expect(issues.every((entry) => entry.file === 'content/economy/listings/borrell-harbour.json')).toBe(true);
  });

  it('needs a longer-range turret choice and a second damage profile [MVP-AC-04, FUNC-9.5, FUNC-9.7]', () => {
    const details = floorIssues(withoutListings(
      'module.turret.railgun.small',
      'ammo.projectile.small.phased',
      'ammo.hybrid.small.iron',
      'ammo.hybrid.small.plasma',
    )).map((entry) => entry.detail);

    expect(details.some((detail) => detail.includes('no longer-range turret choice'))).toBe(true);
    expect(details.some((detail) => detail.includes('only one dominant damage type'))).toBe(true);
  });

  it('needs ammunition on sale for every turret on sale [MVP-AC-02, FUNC-9.4]', () => {
    const details = floorIssues(withoutListings('ammo.hybrid.small.iron', 'ammo.hybrid.small.plasma'))
      .map((entry) => entry.detail);

    expect(details.some((detail) => detail.includes('"module.turret.railgun.small" turret but no ammunition'))).toBe(true);
  });

  it('needs repeatable encounters covering tiers 1, 2 and 3 [MVP-AC-07, MVP-AC-09]', () => {
    const tiers = floorIssues(editEncounters((definitions) => {
      (definitions[2] as Record<string, unknown>)['tier'] = 2;
    }));
    expect(tiers.some((entry) => entry.detail.includes('cover tiers 1, 2 and 3 and no other, not tiers 1, 2'))).toBe(true);

    const repeatable = floorIssues(editEncounters((definitions) => {
      (definitions[0] as Record<string, unknown>)['repeatable'] = false;
    }));
    expect(repeatable.find((entry) => entry.detail.includes('must stay repeatable'))?.path)
      .toBe('definitions[0].repeatable');
  });

  it('needs single and multiple opponents, and two range or movement behaviours [MVP-AC-05, FUNC-9.10]', () => {
    const single = floorIssues(editEncounters((definitions) => {
      for (const definition of definitions) {
        definition['spawns'] = [{ npcProfileId: 'npc.pirate.gunner', count: 1, spawnDistanceKm: 9 }];
      }
    })).map((entry) => entry.detail);

    expect(single.some((detail) => detail.includes('no encounter presses the player with several opponents'))).toBe(true);
    expect(single.some((detail) => detail.includes('only 1 range or movement behaviour'))).toBe(true);
  });

  it('holds the v0.2 lineup to exactly one frigate, destroyer and cruiser, each on sale [V02-AC-02, FUNC-8.1]', () => {
    const extra = floorIssues(editDocument(shippedPack(), 'catalog/hulls/pirate.json', (document) => {
      (document['definitions'] as Record<string, unknown>[])[0]!['playerUsable'] = true;
    }));
    expect(extra.some((entry) => entry.detail.includes('exactly 3 player-usable hulls, not 4'))).toBe(true);
    expect(extra.some((entry) => entry.detail.includes('one player-usable frigate, not 2'))).toBe(true);

    const unsold = floorIssues(withoutListings('hull.independent.cruiser'));
    expect(unsold.some((entry) => entry.detail.includes('does not sell the player hull "hull.independent.cruiser"'))).toBe(true);
  });
});

describe('content floor profiles', () => {
  const declare = (profile: string | null): ContentFile[] =>
    editDocument(shippedPack(), 'content/manifest.json', (document) => {
      if (profile === null) delete document['contentFloor'];
      else document['contentFloor'] = profile;
    });

  it('ships a development milestone, which the release profile refuses as incomplete [V02-AC-02, TECH-6.2]', () => {
    const manifest = JSON.parse(shippedPack().find((file) => file.path === 'content/manifest.json')!.text) as {
      contentFloor?: string;
    };
    expect(manifest.contentFloor).toBe('v0.2-phase-1');

    const release = floorIssues(declare('v0.2-release')).map((entry) => entry.detail);
    expect(release.some((detail) => detail.includes('combat module definitions, not 26'))).toBe(true);
    expect(release.some((detail) => detail.includes('ammunition definitions, fewer than 16'))).toBe(true);
    expect(release.some((detail) => detail.includes('NPC profiles, fewer than 10'))).toBe(true);
    expect(release.some((detail) => detail.includes('tier 1 encounters, not 4'))).toBe(true);
    expect(release.some((detail) => detail.includes('module definitions can drop, fewer than 10'))).toBe(true);
    expect(release.every((detail) => detail.endsWith('(v0.2 release floor)'))).toBe(true);
  });

  it('holds a manifest that names no profile to the release floor, and refuses an unknown one [TECH-6.2]', () => {
    expect(floorIssues(declare(null)).some((entry) => entry.detail.includes('(v0.2 release floor)'))).toBe(true);
    // The schema refuses an unknown profile before the floor is reached.
    expect(compilePack(declare('v0.2-anything'), { floor: true }).ok).toBe(false);
  });
});
