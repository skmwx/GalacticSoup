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
 * From v0.2 phase 5 the shipped manifest claims the release profile: the
 * complete v0.2 catalog, roster, reference fits, twelve-site ladder and drop
 * coverage. The development milestones stay honest subsets of it.
 *
 * The shipped bundle must sell enough at the starting station for two combat
 * approaches and offer three repeatable encounters that press the player in
 * different ways. Each case removes one of those things from the shipped
 * content and expects the floor to name it. Fixture packs are held to the
 * game's rules only, so the minimal pack still compiles.
 */

const HARBOUR = 'economy/listings/borrell-harbour.json';
const ENCOUNTERS = 'encounters/templates/borrell.json';

/** Moves the Crossfire from the developed to the advanced band, unbalancing both. */
function moveCrossfireToTier3(document: Record<string, unknown>): void {
  const crossfire = (document['definitions'] as Record<string, unknown>[])
    .find((definition) => definition['id'] === 'encounter.borrell.crossfire');
  if (crossfire === undefined) throw new Error('The shipped content has no Crossfire.');
  crossfire['tier'] = 3;
}

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
      // Every advanced site drops to tier 2.
      for (const definition of definitions) {
        if (definition['tier'] === 3) definition['tier'] = 2;
      }
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

  it('ships the release floor from phase 5, which every development milestone also accepts [V02-AC-02, V02-AC-09, V02-AC-10, TECH-6.2]', () => {
    const manifest = JSON.parse(shippedPack().find((file) => file.path === 'content/manifest.json')!.text) as {
      contentFloor?: string;
    };
    expect(manifest.contentFloor).toBe('v0.2-release');
    expect(compilePack(shippedPack(), { floor: true }).issues).toEqual([]);
    for (const milestone of ['v0.2-phase-1', 'v0.2-phase-3', 'v0.2-phase-4']) {
      expect(compilePack(declare(milestone), { floor: true }).issues, milestone).toEqual([]);
    }

    // A milestone is honest about what it lacks: with the bands out of
    // balance the phase-4 milestone still holds, the release floor does not.
    const unbalanced = editDocument(declare('v0.2-phase-4'), ENCOUNTERS, moveCrossfireToTier3);
    expect(compilePack(unbalanced, { floor: true }).issues).toEqual([]);
  });

  it('holds the release ladder to twelve distinct sites in three bands of four [V02-AC-09, FUNC-21]', () => {
    const unbalanced = floorIssues(editDocument(shippedPack(), ENCOUNTERS, moveCrossfireToTier3))
      .map((entry) => entry.detail);
    expect(unbalanced).toContain('3 tier 2 encounters, not 4 (v0.2 release floor)');
    expect(unbalanced).toContain('5 tier 3 encounters, not 4 (v0.2 release floor)');

    // Range Check re-flown with the Patrol's opponents differs only in numbers
    // and distances: not a distinct encounter.
    const copied = floorIssues(editEncounters((definitions) => {
      const rangeCheck = definitions.find((definition) => definition['id'] === 'encounter.borrell.range-check')!;
      rangeCheck['spawns'] = [
        { npcProfileId: 'npc.pirate.cutter', count: 1, spawnDistanceKm: 8 },
        { npcProfileId: 'npc.pirate.marksman', count: 2, spawnDistanceKm: 25 },
      ];
    })).map((entry) => entry.detail);
    expect(copied.some((detail) =>
      detail.includes('"encounter.borrell.range-check" fields the same opponents as "encounter.borrell.pirate-patrol"'))).toBe(true);
  });

  it('holds the release ladder to three fit-sensitive sites and every archetype profile placed [V02-AC-08, V02-AC-09]', () => {
    const blunt = floorIssues(editEncounters((definitions) => {
      for (const definition of definitions) {
        if (definition['id'] !== 'encounter.borrell.range-check') definition['fitSensitive'] = false;
      }
    })).map((entry) => entry.detail);
    expect(blunt.some((detail) => detail.includes('1 encounters expose an inappropriate-fit weakness, fewer than 3'))).toBe(true);

    const unplaced = floorIssues(editEncounters((definitions) => {
      const command = definitions.find((definition) => definition['id'] === 'encounter.borrell.command-group')!;
      command['spawns'] = [
        { npcProfileId: 'npc.pirate.binder', count: 1, spawnDistanceKm: 10 },
        { npcProfileId: 'npc.pirate.bruiser', count: 1, spawnDistanceKm: 12 },
        { npcProfileId: 'npc.pirate.gunlayer', count: 1, spawnDistanceKm: 36 },
      ];
    })).map((entry) => entry.detail);
    expect(unplaced.some((detail) => detail.includes('the controller profile "npc.pirate.snare" flies in no encounter'))).toBe(true);
  });

  it('counts only the drops the ladder can produce, across every module group and band [V02-AC-10]', () => {
    // A loot table no encounter's opponents use drops nothing.
    const stranded = floorIssues(editDocument(shippedPack(), 'encounters/npcs/pirates.json', (document) => {
      for (const definition of document['definitions'] as Record<string, unknown>[]) {
        if (['npc.pirate.bombard', 'npc.pirate.snare'].includes(String(definition['id']))) {
          definition['lootTableId'] = 'loot.pirate.scout';
        }
      }
    })).map((entry) => entry.detail);
    expect(stranded).toContain('no medium module can drop (FeatureSpec02 7.2) (v0.2 release floor)');

    const noControl = floorIssues(editDocument(shippedPack(), 'encounters/loot/pirates.json', (document) => {
      for (const table of document['definitions'] as { entries: { itemId: string }[] }[]) {
        table.entries = table.entries.filter((entry) =>
          !entry.itemId.startsWith('module.propulsion.') && entry.itemId !== 'module.web.small');
      }
    })).map((entry) => entry.detail);
    expect(noControl).toContain('no propulsion or control module can drop (FeatureSpec02 7.2) (v0.2 release floor)');

    // The entry band must pay in equipment the starter hull can use.
    const entryCargoOnly = floorIssues(editDocument(shippedPack(), 'encounters/loot/pirates.json', (document) => {
      for (const table of document['definitions'] as { id: string; entries: { itemId: string }[] }[]) {
        if (['loot.pirate.cutter', 'loot.pirate.patrol', 'loot.pirate.lancer'].includes(table.id)) {
          table.entries = table.entries.filter((entry) => !entry.itemId.startsWith('module.'));
        }
      }
    })).map((entry) => entry.detail);
    expect(entryCargoOnly.some((detail) =>
      detail.includes('no tier 1 encounter can drop a module the starter hull can fit'))).toBe(true);
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
    const unnamed = editDocument(declare(null), ENCOUNTERS, moveCrossfireToTier3);
    expect(floorIssues(unnamed).some((entry) => entry.detail.includes('(v0.2 release floor)'))).toBe(true);
    // The schema refuses an unknown profile before the floor is reached.
    expect(compilePack(declare('v0.2-anything'), { floor: true }).ok).toBe(false);
  });
});
