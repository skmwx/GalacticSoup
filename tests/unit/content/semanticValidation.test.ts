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
 * Cross-file content rules (Technical Specification 6.2).
 *
 * Each case changes one thing in the minimal valid pack and asserts the rule
 * that catches it. These are the relationships JSON Schema cannot express:
 * unique ids, resolvable references, the fitting rules of Functional
 * Specification 8.4, the market rules of 11.1-11.2 and complete localization.
 */

function issuesFor(pack: readonly ContentFile[]): readonly ContentIssue[] {
  const result = compilePack(pack);
  expect(result.ok).toBe(false);
  return result.issues;
}

function definitionsOf(document: Record<string, unknown>): Record<string, unknown>[] {
  return document['definitions'] as Record<string, unknown>[];
}

describe('identifier uniqueness', () => {
  it('rejects two definitions that share an id [TECH-6.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/hulls.json', (document) => {
        const definitions = definitionsOf(document);
        (definitions[1] as Record<string, unknown>)['id'] = definitions[0]?.['id'];
      }),
    );

    const issue = issues.find((entry) => entry.reason === 'duplicateId');
    expect(issue?.detail).toContain('hull.test.starter');
    expect(issue?.path).toBe('definitions[1].id');
  });

  it('rejects two sites that share an id [TECH-6.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'universe/systems.json', (document) => {
        const sites = definitionsOf(document)[0]?.['sites'] as Record<string, unknown>[];
        (sites[1] as Record<string, unknown>)['id'] = sites[0]?.['id'];
      }),
    );

    expect(issues.some((entry) => entry.reason === 'duplicateId')).toBe(true);
  });

  it('rejects the same item listed twice at one station [TECH-6.2, FUNC-11.1]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        (listings[3] as Record<string, unknown>)['itemId'] = listings[0]?.['itemId'];
      }),
    );

    expect(issues.some((entry) => entry.reason === 'duplicateId')).toBe(true);
  });
});

describe('references', () => {
  it('rejects an encounter that spawns an unknown NPC profile [TECH-6.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/templates.json', (document) => {
        const spawns = definitionsOf(document)[0]?.['spawns'] as Record<string, unknown>[];
        (spawns[0] as Record<string, unknown>)['npcProfileId'] = 'npc.test.missing';
      }),
    );

    const issue = issues.find((entry) => entry.reason === 'unresolvedReference');
    expect(issue?.detail).toContain('npc.test.missing');
    expect(issue?.path).toBe('definitions[0].spawns[0].npcProfileId');
  });

  it('rejects an NPC profile with an unknown hull [TECH-6.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/npcs.json', (document) => {
        (definitionsOf(document)[0] as Record<string, unknown>)['hullId'] = 'hull.test.missing';
      }),
    );

    expect(issues.some((entry) => entry.reason === 'unresolvedReference')).toBe(true);
  });

  it('rejects loot that is not an item, module or ammunition [TECH-6.2, FUNC-9.11]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/loot.json', (document) => {
        const entries = definitionsOf(document)[0]?.['entries'] as Record<string, unknown>[];
        (entries[0] as Record<string, unknown>)['itemId'] = 'hull.test.starter';
      }),
    );

    expect(
      issues.some(
        (entry) => entry.reason === 'unresolvedReference' && entry.detail.includes('hull.test.starter'),
      ),
    ).toBe(true);
  });

  it('rejects a station placed on a combat site [TECH-6.2, FUNC-5.3]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'universe/stations.json', (document) => {
        (definitionsOf(document)[0] as Record<string, unknown>)['siteId'] = 'site.test.field';
      }),
    );

    expect(
      issues.some((entry) => entry.reason === 'catalogRelationship' && entry.detail.includes('combat site')),
    ).toBe(true);
  });

  it('rejects a combat site that no encounter uses [TECH-6.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'universe/systems.json', (document) => {
        const sites = definitionsOf(document)[0]?.['sites'] as Record<string, unknown>[];
        sites.push({
          id: 'site.test.unused',
          nameKey: 'content.site.test.station.name',
          kind: 'combat',
          position: { xKm: 1000, yKm: 1000 },
        });
      }),
    );

    expect(issues.some((entry) => entry.detail.includes('site.test.unused'))).toBe(true);
  });
});

describe('catalog relationships', () => {
  it('rejects a turret whose family and size no ammunition supplies [TECH-6.2, FUNC-9.4]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/modules.json', (document) => {
        const turret = definitionsOf(document)[0]?.['turret'] as Record<string, unknown>;
        turret['family'] = 'hybrid';
      }),
    );

    expect(
      issues.some(
        (entry) => entry.reason === 'unresolvedReference' && entry.detail.includes('no small hybrid ammunition'),
      ),
    ).toBe(true);
  });

  it('rejects a module that states both a size and the sizes it suits [TECH-6.2, FUNC-8.4, V02-AC-02]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/modules.json', (document) => {
        definitionsOf(document).push({
          id: 'module.test.extender',
          nameKey: 'content.module.test.turret.name',
          descriptionKey: 'content.module.test.turret.description',
          slot: 'engineering',
          size: 'small',
          suitsSizes: ['small'],
          category: 'shieldExtender',
          fitting: { powerUse: 1, processingUse: 1 },
          volumeCubicMetres: 0.005,
          referenceValueCredits: 1000,
          modifiers: [{ operator: 'shieldCapacity', value: 10 }],
        });
      }),
    );

    expect(issues.some((entry) => entry.detail.includes('exactly one of size and suitsSizes'))).toBe(true);
  });

  it('rejects a weapon without its own size [TECH-6.2, FUNC-8.4, V02-AC-02]', () => {
    // The schema itself requires a weapon's size; a weapon cannot list sizes it suits.
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/modules.json', (document) => {
        const turret = definitionsOf(document)[0] as Record<string, unknown>;
        delete turret['size'];
        turret['suitsSizes'] = ['small'];
      }),
    );

    expect(issues.some((entry) => entry.reason === 'schema' && entry.file.endsWith('catalog/modules.json'))).toBe(true);
  });

  it('rejects an NPC loadout whose module size its hull does not accept [TECH-6.2, FUNC-8.4, V02-AC-05]', () => {
    const issues = issuesFor(
      editDocument(
        editDocument(minimalPack(), 'catalog/modules.json', (document) => {
          (definitionsOf(document)[0] as Record<string, unknown>)['size'] = 'medium';
        }),
        'catalog/ammunition.json',
        (document) => {
          (definitionsOf(document)[0] as Record<string, unknown>)['size'] = 'medium';
        },
      ),
    );

    expect(issues.some((entry) => entry.detail.includes('a size "hull.test.pirate" does not accept'))).toBe(true);
  });

  it.each([
    ['an operator its category may not use', [{ operator: 'projectileDamage', value: 0.1 }], 'cannot use the "projectileDamage" operator'],
    ['no primary effect', [{ operator: 'signatureRadius', value: 0.1 }], 'must carry one of shieldCapacity'],
    ['the same operator twice', [{ operator: 'shieldCapacity', value: 10 }, { operator: 'shieldCapacity', value: 10 }], 'is listed twice'],
  ])('rejects a passive module with %s [TECH-6.2, TECH-10.2, V02-AC-05]', (_label, modifiers, detail) => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/modules.json', (document) => {
        definitionsOf(document).push({
          id: 'module.test.extender',
          nameKey: 'content.module.test.turret.name',
          descriptionKey: 'content.module.test.turret.description',
          slot: 'engineering',
          suitsSizes: ['small'],
          category: 'shieldExtender',
          fitting: { powerUse: 1, processingUse: 1 },
          volumeCubicMetres: 0.005,
          referenceValueCredits: 1000,
          modifiers,
        });
      }),
    );

    expect(issues.some((entry) => entry.detail.includes(detail)), JSON.stringify(issues)).toBe(true);
  });

  it('rejects a fractional reduction of one or more [TECH-6.2, TECH-10.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/modules.json', (document) => {
        definitionsOf(document).push({
          id: 'module.test.recharger',
          nameKey: 'content.module.test.turret.name',
          descriptionKey: 'content.module.test.turret.description',
          slot: 'engineering',
          suitsSizes: ['small'],
          category: 'shieldRecharger',
          fitting: { powerUse: 1, processingUse: 1 },
          volumeCubicMetres: 0.005,
          referenceValueCredits: 1000,
          modifiers: [{ operator: 'shieldRechargeTime', value: 1 }],
        });
      }),
    );

    expect(issues.some((entry) => entry.reason === 'invalidValue' && entry.detail.includes('below 1'))).toBe(true);
  });

  it('rejects a turret in the wrong slot [TECH-6.2, FUNC-8.3]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/modules.json', (document) => {
        (definitionsOf(document)[0] as Record<string, unknown>)['slot'] = 'engineering';
      }),
    );

    expect(
      issues.some(
        (entry) => entry.reason === 'catalogRelationship' && entry.detail.includes('weapon slot'),
      ),
    ).toBe(true);
  });

  it('rejects an NPC loadout that exceeds its hull hardpoints [TECH-6.2, FUNC-8.4]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/npcs.json', (document) => {
        const loadout = definitionsOf(document)[0]?.['loadout'] as Record<string, unknown>;
        loadout['modules'] = ['module.test.turret', 'module.test.turret', 'module.test.turret'];
      }),
    );

    expect(
      issues.some(
        (entry) => entry.reason === 'catalogRelationship' && entry.detail.includes('turret hardpoints'),
      ),
    ).toBe(true);
  });

  it('rejects an NPC loadout that exceeds its hull power [TECH-6.2, FUNC-8.4]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/hulls.json', (document) => {
        const fitting = definitionsOf(document)[1]?.['fitting'] as Record<string, unknown>;
        fitting['powerOutput'] = 1;
      }),
    );

    expect(
      issues.some((entry) => entry.reason === 'catalogRelationship' && entry.detail.includes('power')),
    ).toBe(true);
  });

  it.each([
    [
      'a slot the starter hull does not have',
      (values: Record<string, unknown>) => {
        (values['startingFit'] as Record<string, unknown>[])[0]!['index'] = 5;
      },
      'slot',
    ],
    [
      'a module of the wrong slot kind',
      (values: Record<string, unknown>) => {
        (values['startingFit'] as Record<string, unknown>[])[0]!['slot'] = 'engineering';
      },
      'slot',
    ],
    [
      'a module the starting items do not supply',
      (values: Record<string, unknown>) => {
        values['startingItems'] = [{ definitionId: 'ammo.test.charge', quantity: 30 }];
      },
      'starting items do not supply',
    ],
    [
      'a module that is not in the catalogue',
      (values: Record<string, unknown>) => {
        (values['startingFit'] as Record<string, unknown>[])[0]!['moduleId'] = 'module.test.missing';
      },
      'is not a module definition',
    ],
    [
      'a charge from another ammunition group',
      (values: Record<string, unknown>) => {
        (values['startingFit'] as Record<string, unknown>[])[0]!['ammunitionId'] = 'ammo.test.other';
      },
      'is not an ammunition definition',
    ],
  ])(
    'rejects a starting fit with %s [TECH-6.2, FUNC-3.1, FUNC-8.4]',
    (_label, mutate, detail) => {
      const issues = issuesFor(
        editDocument(minimalPack(), 'rules/economy.json', (document) => {
          mutate(document['values'] as Record<string, unknown>);
        }),
      );

      expect(
        issues.some((entry) => entry.detail.includes(detail as string)),
        JSON.stringify(issues),
      ).toBe(true);
    },
  );

  const supply = (loadout: Record<string, unknown>): Record<string, unknown>[] =>
    loadout['ammunition'] as Record<string, unknown>[];

  it('rejects NPC ammunition no weapon in the loadout loads [TECH-6.2, TECH-8.3, FUNC-9.10]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/npcs.json', (document) => {
        const loadout = definitionsOf(document)[0]?.['loadout'] as Record<string, unknown>;
        loadout['modules'] = [];
        (supply(loadout)[0] as Record<string, unknown>)['reserveRounds'] = 10;
      }),
    );

    const issue = issues.find((entry) => entry.path === 'definitions[0].loadout.ammunition[0].ammunitionId');
    expect(issue?.reason).toBe('catalogRelationship');
    expect(issue?.detail).toContain('no weapon in the loadout loads');
  });

  it('rejects an NPC weapon without ammunition for its group [TECH-6.2, TECH-8.3, FUNC-9.10]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/npcs.json', (document) => {
        const loadout = definitionsOf(document)[0]?.['loadout'] as Record<string, unknown>;
        loadout['ammunition'] = [];
      }),
    );

    const issue = issues.find((entry) => entry.path === 'definitions[0].loadout.ammunition');
    expect(issue?.detail).toContain('loads small projectile ammunition, but the loadout names none');
  });

  it('rejects NPC reserve rounds that do not fit the hull\'s hold [TECH-6.2, FUNC-9.4, FUNC-22.2]', () => {
    // 100 m3 of hold at 2 dm3 a round holds 50000 rounds; one more does not fit.
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/npcs.json', (document) => {
        const loadout = definitionsOf(document)[0]?.['loadout'] as Record<string, unknown>;
        (supply(loadout)[0] as Record<string, unknown>)['reserveRounds'] = 50_001;
      }),
    );

    const issue = issues.find((entry) => entry.path === 'definitions[0].loadout.ammunition');
    expect(issue?.reason).toBe('catalogRelationship');
    expect(issue?.detail).toBe('the reserve rounds need 100002 dm3 but "hull.test.pirate" holds 100000 dm3');
  });

  it('accepts NPC reserve rounds that exactly fill the hold [TECH-6.2, FUNC-9.4]', () => {
    const result = compilePack(
      editDocument(minimalPack(), 'encounters/npcs.json', (document) => {
        const loadout = definitionsOf(document)[0]?.['loadout'] as Record<string, unknown>;
        (supply(loadout)[0] as Record<string, unknown>)['reserveRounds'] = 50_000;
      }),
    );

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects a starting fit that needs more power than the hull supplies [TECH-6.2, FUNC-8.4]', () => {
    const pack = editDocument(
      editDocument(minimalPack(), 'rules/economy.json', (document) => {
        const values = document['values'] as Record<string, unknown>;
        values['startingItems'] = [
          { definitionId: 'module.test.turret', quantity: 2 },
          { definitionId: 'ammo.test.charge', quantity: 30 },
        ];
        values['startingFit'] = [
          { slot: 'weapon', index: 0, moduleId: 'module.test.turret', online: true },
          { slot: 'weapon', index: 1, moduleId: 'module.test.turret', online: true },
        ];
      }),
      'catalog/hulls.json',
      (document) => {
        const fitting = definitionsOf(document)[0]?.['fitting'] as Record<string, unknown>;
        fitting['powerOutput'] = 6;
      },
    );

    expect(
      issuesFor(pack).some((entry) => entry.detail.includes('online starting fit draws')),
    ).toBe(true);
  });

  it('rejects turrets loaded with ammunition of another group [TECH-6.2, FUNC-9.4]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/ammunition.json', (document) => {
        (definitionsOf(document)[0] as Record<string, unknown>)['group'] = 'other-group';
      }),
    );

    expect(issues.some((entry) => entry.reason !== 'schema')).toBe(true);
  });

  it('rejects a set with no player-usable hull [TECH-6.2, MVP-AC-02]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'catalog/hulls.json', (document) => {
        for (const definition of definitionsOf(document)) {
          (definition as Record<string, unknown>)['playerUsable'] = false;
        }
      }),
    );

    expect(issues.some((entry) => entry.detail.includes('playerUsable'))).toBe(true);
  });

  it('rejects a set with no tier 1 encounter [TECH-6.2, MVP-AC-07]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/templates.json', (document) => {
        (definitionsOf(document)[0] as Record<string, unknown>)['tier'] = 3;
      }),
    );

    expect(issues.some((entry) => entry.detail.includes('tier 1'))).toBe(true);
  });
});

describe('market and recovery guarantees', () => {
  it('rejects a set with no neutral-access station [TECH-6.2, FUNC-5.1]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'universe/stations.json', (document) => {
        (definitionsOf(document)[0] as Record<string, unknown>)['neutralAccess'] = false;
      }),
    );

    expect(issues.some((entry) => entry.detail.includes('neutral access'))).toBe(true);
  });

  it('rejects a neutral station that does not stock the starter hull [TECH-6.2, FUNC-11.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        document['listings'] = listings.filter((listing) => listing['itemId'] !== 'hull.test.starter');
      }),
    );

    expect(
      issues.some(
        (entry) =>
          entry.reason === 'catalogRelationship' && entry.detail.includes('hull.test.starter'),
      ),
    ).toBe(true);
  });

  it('rejects a neutral station that stocks a turret but no ammunition for it [TECH-6.2, FUNC-11.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        for (const listing of listings) {
          if (listing['itemId'] === 'ammo.test.charge') {
            listing['supply'] = 'dynamic';
            listing['productionPerHour'] = 5;
          }
        }
      }),
    );

    expect(
      issues.some(
        (entry) => entry.reason === 'catalogRelationship' && entry.detail.includes('no ammunition'),
      ),
    ).toBe(true);
  });

  it('rejects a fixed-supply listing that produces or consumes stock [TECH-6.2, FUNC-11.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        (listings[0] as Record<string, unknown>)['consumptionPerHour'] = 2;
      }),
    );

    expect(
      issues.some((entry) => entry.reason === 'invalidValue' && entry.detail.includes('non-scarce')),
    ).toBe(true);
  });

  it('rejects a recovery station that sells the starter hull above its reference value [TECH-6.2, FUNC-9.12, FUNC-22.1]', () => {
    // 10000 x (1 + 0.08 spread) = 10800 credits, above the 10000 reference value.
    const issues = issuesFor(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        (listings[0] as Record<string, unknown>)['basePriceCredits'] = 10_000;
      }),
    );

    const issue = issues.find((entry) => entry.detail.includes('below which recovery grants one'));
    expect(issue?.reason).toBe('catalogRelationship');
    expect(issue?.path).toBe('listings[0].basePriceCredits');
    expect(issue?.detail).toContain('10800');
    expect(issue?.file).toContain('economy/listings.json');
  });

  it('accepts a starter hull quoted at exactly its reference value [TECH-6.2, FUNC-9.12]', () => {
    // 9259 x 1.08 = 9999.72, which the quote rounds to the 10000 reference value.
    const result = compilePack(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        (listings[0] as Record<string, unknown>)['basePriceCredits'] = 9_259;
      }),
    );

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects a recovery station whose starting-fit turret costs more than its reference value [TECH-6.2, FUNC-9.12, FUNC-22.1]', () => {
    // 12000 x 1.08 = 12960 credits for a turret whose reference value is 12000:
    // a pilot holding the starter ship's reference value could buy the hull
    // but not arm it.
    const issues = issuesFor(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        (listings[1] as Record<string, unknown>)['basePriceCredits'] = 12_000;
      }),
    );

    const issue = issues.find((entry) => entry.detail.includes('module.test.turret'));
    expect(issue?.reason).toBe('catalogRelationship');
    expect(issue?.path).toBe('listings[1].basePriceCredits');
    expect(issue?.detail).toContain('12960');
  });

  it('rejects a starter ship part the recovery station does not stock at a fixed price [TECH-6.2, FUNC-9.12, FUNC-11.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        const charge = listings.find((listing) => listing['itemId'] === 'ammo.test.charge') as Record<string, unknown>;
        charge['supply'] = 'dynamic';
        charge['productionPerHour'] = 5;
      }),
    );

    expect(issues.some((entry) =>
      entry.reason === 'catalogRelationship' &&
      entry.detail.includes('"ammo.test.charge" is part of the starter ship'))).toBe(true);
  });

  it('rejects starting stock above twice the target [TECH-6.2, FUNC-11.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'economy/listings.json', (document) => {
        const listings = document['listings'] as Record<string, unknown>[];
        (listings[3] as Record<string, unknown>)['initialStock'] = 500;
      }),
    );

    expect(issues.some((entry) => entry.reason === 'invalidValue')).toBe(true);
  });
});

describe('localization completeness', () => {
  it('rejects a definition whose message key has no text [TECH-6.2, TECH-12.5]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'localization/en.json', (document) => {
        const messages = document['messages'] as Record<string, string>;
        delete messages['content.encounter.test.skirmish.name'];
      }),
    );

    const issue = issues.find((entry) => entry.reason === 'missingLocalization');
    expect(issue?.detail).toContain('content.encounter.test.skirmish.name');
    expect(issue?.file).toContain('encounters/templates.json');
  });

  it('rejects a declared locale with no localization file [TECH-6.2, TECH-12.5]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'manifest.json', (document) => {
        document['locales'] = ['en', 'fr'];
      }),
    );

    expect(
      issues.some((entry) => entry.reason === 'missingLocalization' && entry.detail.includes('fr')),
    ).toBe(true);
  });

  it('rejects a default locale that is not declared [TECH-6.2, TECH-12.5]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'manifest.json', (document) => {
        document['defaultLocale'] = 'de';
        document['locales'] = ['en'];
      }),
    );

    expect(issues.some((entry) => entry.reason === 'invalidValue')).toBe(true);
  });
});

describe('rule consistency', () => {
  it('rejects inverted bounds inside a rule group [TECH-6.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'rules/economy.json', (document) => {
        const values = document['values'] as Record<string, unknown>;
        values['elasticityMinimum'] = 0.6;
        values['elasticityMaximum'] = 0.1;
      }),
    );

    const issue = issues.find((entry) => entry.reason === 'invalidValue');
    expect(issue?.path).toBe('values.elasticityMinimum');
  });

  it('rejects range presets whose closest approach cannot open a wreck [TECH-6.2, FUNC-9.11]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'rules/navigation.json', (document) => {
        (document['values'] as Record<string, unknown>)['rangePresetsKm'] = [1, 5, 10];
      }),
    );

    const issue = issues.find((entry) => entry.path === 'values.rangePresetsKm');
    expect(issue?.reason).toBe('invalidValue');
    expect(issue?.detail).toContain('wreck access range');
  });

  it('rejects a hull resistance above the combat rules maximum [TECH-6.2, FUNC-4.2]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'rules/combat.json', (document) => {
        (document['values'] as Record<string, unknown>)['resistanceMaximum'] = 0.3;
      }),
    );

    expect(
      issues.some(
        (entry) => entry.reason === 'invalidValue' && entry.detail.includes('resistance maximum'),
      ),
    ).toBe(true);
  });
});

describe('encounters the loop can reach and tell apart', () => {
  it('rejects a gap between the easiest and the hardest tier [TECH-6.2, FUNC-18, MVP-AC-07]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'encounters/templates.json', (document) => {
        (definitionsOf(document)[0] as Record<string, unknown>)['tier'] = 3;
      }),
    );

    expect(issues.some((entry) => entry.detail.includes('no tier 2 encounter exists between tier 1 and tier 3'))).toBe(true);
  });

  it('rejects an encounter closer to the starting station than a warp can go [TECH-6.2, FUNC-7.3]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'universe/systems.json', (document) => {
        const sites = definitionsOf(document)[0]?.['sites'] as Record<string, unknown>[];
        (sites[1] as Record<string, unknown>)['position'] = { xKm: 60, yKm: 0 };
      }),
    );

    const issue = issues.find((entry) => entry.detail.includes('closer than'));
    expect(issue?.reason).toBe('catalogRelationship');
    expect(issue?.path).toBe('definitions[0].siteId');
  });

  it('rejects two encounters that differ only in how many opponents they spawn [TECH-6.2, FUNC-21]', () => {
    let pack = editDocument(minimalPack(), 'universe/systems.json', (document) => {
      const sites = definitionsOf(document)[0]?.['sites'] as Record<string, unknown>[];
      sites.push({ ...sites[1], id: 'site.test.lane', position: { xKm: -20_000, yKm: 5_000 } });
    });
    pack = editDocument(pack, 'encounters/templates.json', (document) => {
      const definitions = definitionsOf(document);
      const first = definitions[0] as Record<string, unknown>;
      const spawns = first['spawns'] as Record<string, unknown>[];
      definitions.push({
        ...first,
        id: 'encounter.test.bigger',
        siteId: 'site.test.lane',
        tier: 2,
        spawns: spawns.map((spawn) => ({ ...spawn, count: 3 })),
      });
    });

    const issue = issuesFor(pack).find((entry) => entry.detail.includes('only their numbers differ'));
    expect(issue?.path).toBe('definitions[1].spawns');
    expect(issue?.detail).toContain('encounter.test.skirmish');
  });

  it('rejects a reward summary that states a different bounty, and accepts the authored one [TECH-6.2, MVP-AC-05]', () => {
    const stating = (text: string) => editDocument(minimalPack(), 'localization/en.json', (document) => {
      (document['messages'] as Record<string, string>)['content.encounter.test.skirmish.reward'] = text;
    });

    const issue = issuesFor(stating('About 5,000 credits in bounty.')).find((entry) => entry.reason === 'invalidValue');
    expect(issue?.path).toBe('messages.content.encounter.test.skirmish.reward');
    expect(issue?.detail).toContain('states 5000 credits, but the authored bounties total 3000');

    expect(compilePack(stating('About 3,000 credits for 1 pirate.')).ok).toBe(true);
  });

  it('rejects loot that no station buys and no player hull can use [TECH-6.2, FUNC-9.11, MVP-AC-06]', () => {
    let pack = editDocument(minimalPack(), 'catalog/items.json', (document) => {
      const definitions = definitionsOf(document);
      definitions.push({ ...definitions[0], id: 'item.test.junk' });
    });
    pack = editDocument(pack, 'encounters/loot.json', (document) => {
      const entries = definitionsOf(document)[0]?.['entries'] as Record<string, unknown>[];
      entries.push({ ...entries[0], itemId: 'item.test.junk' });
    });

    const issue = issuesFor(pack).find((entry) => entry.detail.includes('item.test.junk'));
    expect(issue?.reason).toBe('catalogRelationship');
    expect(issue?.path).toBe('definitions[0].entries[1].itemId');
  });

  it('rejects a starting fit that arms no weapon [TECH-6.2, FUNC-3.1]', () => {
    const issues = issuesFor(
      editDocument(minimalPack(), 'rules/economy.json', (document) => {
        const fit = (document['values'] as Record<string, unknown>)['startingFit'] as Record<string, unknown>[];
        delete (fit[0] as Record<string, unknown>)['ammunitionId'];
      }),
    );

    expect(issues.some((entry) => entry.detail.includes('arms no online weapon'))).toBe(true);
  });
});

describe('reference fits (FeatureSpec02 5.3)', () => {
  const fit = {
    kind: 'reference.fits',
    fits: [{
      id: 'fit.test.turret',
      hullId: 'hull.test.starter',
      approach: 'A test turret fit.',
      modules: [{ moduleId: 'module.test.turret', ammunitionId: 'ammo.test.charge' }],
      reserve: [{ ammunitionId: 'ammo.test.charge', quantity: 20 }],
    }],
  };
  const withFit = (edit: (value: typeof fit.fits[number]) => void): ContentFile[] => {
    const copy = JSON.parse(JSON.stringify(fit)) as typeof fit;
    edit(copy.fits[0]!);
    return [...minimalPack(), { path: 'content/balance/fits.json', text: JSON.stringify(copy) }];
  };

  it('accepts a legal, obtainable reference fit [TECH-6.2, V02-AC-04]', () => {
    const result = compilePack(withFit(() => undefined));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each([
    ['an unloaded weapon', (value: typeof fit.fits[number]) => { delete (value.modules[0] as { ammunitionId?: string }).ammunitionId; }, 'is not loaded'],
    ['no reserve for a weapon', (value: typeof fit.fits[number]) => { value.reserve = []; }, 'could not reload'],
    ['more weapons than the hull has slots', (value: typeof fit.fits[number]) => {
      value.modules = Array.from({ length: 9 }, () => ({ moduleId: 'module.test.turret', ammunitionId: 'ammo.test.charge' }));
    }, 'weapon modules exceed'],
    ['an unknown hull', (value: typeof fit.fits[number]) => { value.hullId = 'hull.test.missing'; }, 'is not a player-usable hull'],
  ])('rejects a reference fit with %s [TECH-6.2, V02-AC-04]', (_label, edit, detail) => {
    const issues = issuesFor(withFit(edit));
    expect(issues.some((entry) => entry.detail.includes(detail)), JSON.stringify(issues)).toBe(true);
  });
});

describe('speed control and archetypes (FeatureSpec02 6.3, 7.1)', () => {
  const editWeb = (edit: (web: Record<string, unknown>) => void): ContentFile[] =>
    editDocument(shippedPack(), 'catalog/modules/defense.json', (document) => {
      const web = definitionsOf(document).find((definition) => definition['id'] === 'module.web.small');
      if (web === undefined) throw new Error('The shipped content has no web.');
      edit(web);
    });
  const editProfile = (id: string, edit: (profile: Record<string, unknown>) => void): ContentFile[] =>
    editDocument(shippedPack(), 'encounters/npcs/pirates.json', (document) => {
      const profile = definitionsOf(document).find((definition) => definition['id'] === id);
      if (profile === undefined) throw new Error(`The shipped content has no ${id}.`);
      edit(profile);
    });

  it('accepts the shipped web and roster [FUNC-9.9, V02-AC-07, V02-AC-08]', () => {
    expect(compilePack(shippedPack()).issues).toEqual([]);
  });

  it('keeps the web in a system slot [FUNC-8.3, FUNC-9.9]', () => {
    const issues = issuesFor(editWeb((web) => {
      web['slot'] = 'engineering';
    }));
    expect(issues.some((entry) => entry.detail.includes('a web module occupies a system slot'))).toBe(true);
  });

  it('refuses a web effect shorter than its cycle, which would leave gaps [FUNC-9.9]', () => {
    const issues = issuesFor(editWeb((web) => {
      (web['web'] as Record<string, unknown>)['effectDurationSeconds'] = 2;
    }));
    expect(issues.some((entry) => entry.path.endsWith('.web.effectDurationSeconds'))).toBe(true);
  });

  it('refuses a web that removes all speed or none [FUNC-9.9]', () => {
    for (const fraction of [0, 1]) {
      expect(compilePack(editWeb((web) => {
        (web['web'] as Record<string, unknown>)['speedReductionFraction'] = fraction;
      })).ok).toBe(false);
    }
  });

  it('holds a controller to its web and a tackler role [FUNC-9.10, V02-AC-08]', () => {
    const noWeb = issuesFor(editProfile('npc.pirate.binder', (profile) => {
      const loadout = profile['loadout'] as { modules: string[] };
      loadout.modules = loadout.modules.filter((moduleId) => moduleId !== 'module.web.small');
    }));
    expect(noWeb.some((entry) => entry.detail.includes('lacks the modules that make it one'))).toBe(true);
    expect(noWeb.some((entry) => entry.detail.includes('a tackler positions for its web'))).toBe(true);
  });

  it('holds a brawler to the brawler role, resistance and active repair [FUNC-9.10, V02-AC-08]', () => {
    const wrongRole = issuesFor(editProfile('npc.pirate.warden', (profile) => {
      profile['role'] = 'sniper';
    }));
    expect(wrongRole.some((entry) => entry.detail.includes('takes the brawler role, not sniper'))).toBe(true);

    const noRepair = issuesFor(editProfile('npc.pirate.warden', (profile) => {
      const loadout = profile['loadout'] as { modules: string[] };
      loadout.modules = loadout.modules.filter((moduleId) => moduleId !== 'module.repair.armor.small');
    }));
    expect(noRepair.some((entry) => entry.detail.includes('lacks the modules that make it one'))).toBe(true);
  });
});
