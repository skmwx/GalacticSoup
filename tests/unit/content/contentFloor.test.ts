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
      'module.shield.booster.medium',
      'module.repair.armor.small',
      'module.repair.armor.medium',
      'module.plating.armor.small',
      'module.amplifier.shield',
      'module.propulsion.afterburner.small',
      'module.propulsion.afterburner.medium',
      'module.capacitor.battery.small',
      'module.capacitor.battery.medium',
    ));
    const details = issues.map((entry) => entry.detail);

    for (const missing of ['active defensive', 'passive resistance', 'propulsion', 'capacitor-support']) {
      expect(details.some((detail) => detail.includes(missing)), missing).toBe(true);
    }
    // The reference fits that use the removed modules also stop being obtainable;
    // every floor finding is about the listings.
    expect(issues
      .filter((entry) => !entry.file.startsWith('content/balance/'))
      .every((entry) => entry.file === 'content/economy/listings/borrell-harbour.json')).toBe(true);
  });

  it('needs a longer-range turret choice and a second damage profile [MVP-AC-04, FUNC-9.5, FUNC-9.7]', () => {
    // Only the starter's autocannon and its fusion rounds stay on sale.
    const pack = shippedPack();
    const sold = JSON.parse(pack.find((file) => file.path === 'content/economy/listings/borrell-harbour.json')!.text) as {
      listings: { itemId: string }[];
    };
    const removed = sold.listings
      .map((listing) => listing.itemId)
      .filter((id) => (id.startsWith('module.turret.') && id !== 'module.turret.autocannon.small') ||
        (id.startsWith('ammo.') && id !== 'ammo.projectile.small.fusion'));
    const details = floorIssues(withoutListings(...removed)).map((entry) => entry.detail);

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
      // The Pirate Base, the only tier 3 site, drops to tier 2.
      const base = definitions.find((definition) => definition['id'] === 'encounter.borrell.pirate-base');
      (base as Record<string, unknown>)['tier'] = 2;
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
    expect(manifest.contentFloor).toBe('v0.2-phase-4');
    expect(compilePack(shippedPack(), { floor: true }).issues).toEqual([]);

    const release = floorIssues(declare('v0.2-release')).map((entry) => entry.detail);
    // Phase 4 completes the catalog, the roster and the reference fits; the
    // twelve-site ladder and the drop coverage follow in phase 5.
    expect(release.some((detail) => detail.includes('combat module definitions'))).toBe(false);
    expect(release.some((detail) => detail.includes('ammunition definitions, fewer than 16'))).toBe(false);
    expect(release.some((detail) => detail.includes('NPC profiles state an archetype, fewer than 10'))).toBe(false);
    expect(release.some((detail) => detail.includes('reference fit'))).toBe(false);
    expect(release.some((detail) => detail.includes('tier 1 encounters, not 4'))).toBe(true);
    expect(release.some((detail) => detail.includes('module definitions can drop, fewer than 10'))).toBe(true);
    expect(release.every((detail) => detail.endsWith('(v0.2 release floor)'))).toBe(true);
  });

  it('holds the phase-4 catalog to 26 modules, every archetype twice and six covering fits [V02-AC-02, V02-AC-04, V02-AC-08]', () => {
    const noWeb = floorIssues(editDocument(shippedPack(), 'catalog/modules/defense.json', (document) => {
      const definitions = document['definitions'] as { id: string }[];
      document['definitions'] = definitions.filter((definition) => definition.id !== 'module.web.small');
    })).map((entry) => entry.detail);
    expect(noWeb.some((detail) => detail.includes('25 combat module definitions, not 26'))).toBe(true);

    const oneController = floorIssues(editDocument(shippedPack(), 'encounters/npcs/pirates.json', (document) => {
      const definitions = document['definitions'] as { id: string }[];
      document['definitions'] = definitions.filter((definition) => definition.id !== 'npc.pirate.snare');
    })).map((entry) => entry.detail);
    expect(oneController.some((detail) => detail.includes('1 profiles field the controller archetype, fewer than 2'))).toBe(true);

    const noWebFit = floorIssues(editDocument(shippedPack(), 'balance/reference-fits.json', (document) => {
      const fits = document['fits'] as { id: string }[];
      document['fits'] = fits.filter((fit) => fit.id !== 'fit.destroyer.blaster-web');
    })).map((entry) => entry.detail);
    expect(noWebFit.some((detail) => detail.includes('1 reference fits for "hull.independent.destroyer", fewer than 2'))).toBe(true);
    expect(noWebFit.some((detail) => detail.includes('no reference fit covers web-assisted turret'))).toBe(true);
  });

  it('holds a manifest that names no profile to the release floor, and refuses an unknown one [TECH-6.2]', () => {
    expect(floorIssues(declare(null)).some((entry) => entry.detail.includes('(v0.2 release floor)'))).toBe(true);
    // The schema refuses an unknown profile before the floor is reached.
    expect(compilePack(declare('v0.2-anything'), { floor: true }).ok).toBe(false);
  });
});
