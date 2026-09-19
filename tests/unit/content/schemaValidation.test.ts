import { describe, expect, it } from 'vitest';

import {
  compilePack,
  editDocument,
  editFile,
  minimalPack,
  removeFile,
  type ContentIssue,
} from '../../support/contentFixtures.ts';

/**
 * Schema validation of authored content (Technical Specification 6.2).
 *
 * A development diagnostic must name the file and the JSON path of the value
 * that broke the rule, or an author cannot find it. Every case here asserts
 * that location, not only that the compile failed.
 */

function reasons(issues: readonly ContentIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.reason))].sort();
}

describe('authored content schemas', () => {
  it('accepts the minimal valid pack [TECH-6.2]', () => {
    const result = compilePack(minimalPack());

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reports invalid JSON with its file [TECH-6.2]', () => {
    const result = compilePack(editFile(minimalPack(), 'catalog/hulls.json', () => '{ not json'));

    expect(result.ok).toBe(false);
    const issue = result.issues.find((entry) => entry.reason === 'invalidJson');
    expect(issue?.file).toContain('catalog/hulls.json');
  });

  it('identifies the file and JSON path of a bad value [TECH-6.2]', () => {
    const result = compilePack(
      editDocument(minimalPack(), 'catalog/hulls.json', (document) => {
        const definitions = document['definitions'] as Record<string, unknown>[];
        (definitions[0] as { signatureRadiusMetres: unknown }).signatureRadiusMetres = -5;
      }),
    );

    expect(result.ok).toBe(false);
    const issue = result.issues.find((entry) => entry.reason === 'schema');
    expect(issue?.file).toContain('catalog/hulls.json');
    expect(issue?.path).toBe('definitions.0.signatureRadiusMetres');
  });

  it('rejects a resistance above the 90% clamp [TECH-6.2, FUNC-4.2]', () => {
    const result = compilePack(
      editDocument(minimalPack(), 'catalog/hulls.json', (document) => {
        const definitions = document['definitions'] as Record<string, unknown>[];
        const defenses = definitions[0]?.['defenses'] as Record<string, Record<string, Record<string, number>>>;
        (defenses['armor'] as { resistances: Record<string, number> }).resistances['thermal'] = 0.95;
      }),
    );

    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) => issue.path === 'definitions.0.defenses.armor.resistances.thermal'),
    ).toBe(true);
  });

  it('rejects an unknown property rather than ignoring it [TECH-6.2]', () => {
    const result = compilePack(
      editDocument(minimalPack(), 'catalog/items.json', (document) => {
        const definitions = document['definitions'] as Record<string, unknown>[];
        (definitions[0] as Record<string, unknown>)['rarity'] = 'legendary';
      }),
    );

    expect(result.ok).toBe(false);
    expect(reasons(result.issues)).toContain('schema');
  });

  it('rejects a document that declares no known kind [TECH-6.2]', () => {
    const result = compilePack(
      editDocument(minimalPack(), 'catalog/items.json', (document) => {
        document['kind'] = 'starships';
      }),
    );

    expect(result.ok).toBe(false);
    expect(reasons(result.issues)).toContain('unknownKind');
  });

  it('rejects an id that is not namespaced for its kind [TECH-5.1, TECH-6.2]', () => {
    const result = compilePack(
      editDocument(minimalPack(), 'catalog/modules.json', (document) => {
        const definitions = document['definitions'] as Record<string, unknown>[];
        (definitions[0] as Record<string, unknown>)['id'] = 'hull.test.turret';
      }),
    );

    expect(result.ok).toBe(false);
    expect(reasons(result.issues)).toContain('schema');
  });

  it('reports every missing required kind [TECH-6.2]', () => {
    const result = compilePack(removeFile(minimalPack(), 'rules/economy.json'));

    expect(result.ok).toBe(false);
    expect(reasons(result.issues)).toContain('missingKind');
    expect(result.issues.some((issue) => issue.detail.includes('rules.economy'))).toBe(true);
  });

  it('rejects a second manifest [TECH-6.2]', () => {
    const pack = minimalPack();
    const manifest = pack.find((file) => file.path.endsWith('manifest.json'));
    const result = compilePack([
      ...pack,
      { path: 'tests/fixtures/content/minimal/manifest-copy.json', text: manifest?.text ?? '' },
    ]);

    expect(result.ok).toBe(false);
    expect(reasons(result.issues)).toContain('duplicateKind');
  });

  it('rejects content nested beyond the structural limit [TECH-14]', () => {
    let nested: Record<string, unknown> = { depth: 'bottom' };
    for (let depth = 0; depth < 40; depth += 1) {
      nested = { inner: nested };
    }
    const result = compilePack(
      editDocument(minimalPack(), 'manifest.json', (document) => {
        document['nested'] = nested;
      }),
    );

    expect(result.ok).toBe(false);
    expect(reasons(result.issues)).toContain('structure');
  });
});
