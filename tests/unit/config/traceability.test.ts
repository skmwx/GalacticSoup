import { describe, expect, it } from 'vitest';

import { buildTraceability, readRegistry, renderMarkdown } from '../../../scripts/lib/traceability.mjs';

/**
 * The traceability source and its report (Technical Specification 15.2; MVP
 * Scope 9.2; MVP Implementation Plan phase 20).
 *
 * `npm run traceability` writes the report. These tests hold the join to its
 * rules, and hold the repository to the result: no included requirement is
 * uncovered.
 */

interface Entry {
  readonly id: string;
  readonly title: string;
  readonly scope: 'included' | 'deferred';
  readonly reason?: string;
  readonly evidence?: 'tests';
  content?: string[];
  requests?: string[];
}

const registry = readRegistry() as { requirements: Entry[] };

function reportFor(entries: readonly Entry[], claims: Record<string, string[]>, tests: Record<string, string[]>) {
  const asMap = (source: Record<string, string[]>): Map<string, Set<string>> =>
    new Map(Object.entries(source).map(([id, files]) => [id, new Set(files)]));
  return buildTraceability({
    registry: { requirements: [...entries] },
    claims: asMap(claims),
    tests: asMap(tests),
  });
}

describe('the requirement registry', () => {
  it('lists every MVP acceptance criterion as included [TECH-15.2]', () => {
    const acceptance = registry.requirements.filter((entry) => entry.id.startsWith('MVP-AC-'));

    expect(acceptance.map((entry) => entry.id)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => `MVP-AC-${String(index + 1).padStart(2, '0')}`),
    );
    expect(acceptance.every((entry) => entry.scope === 'included')).toBe(true);
  });

  it('gives every requirement a title, and every deferred one the reason it is deferred [TECH-15.2]', () => {
    const ids = registry.requirements.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of registry.requirements) {
      expect(entry.title.length, entry.id).toBeGreaterThan(0);
      if (entry.scope === 'deferred') expect(entry.reason ?? '', entry.id).toMatch(/MVP (Scope|Implementation Plan)/);
    }
  });

  it('includes the sections MVP Scope 3 selects and defers the systems MVP Scope 8 lists [TECH-15.2]', () => {
    const scopeOf = (id: string): string | undefined =>
      registry.requirements.find((entry) => entry.id === id)?.scope;

    for (const id of [
      'FUNC-3.1', 'FUNC-3.3', 'FUNC-3.4', 'FUNC-5.2', 'FUNC-5.3', 'FUNC-6.1', 'FUNC-6.2', 'FUNC-7.1', 'FUNC-7.2',
      'FUNC-7.3', 'FUNC-7.4', 'FUNC-8.2', 'FUNC-8.3', 'FUNC-8.4', 'FUNC-8.5', 'FUNC-9.1', 'FUNC-9.2', 'FUNC-9.3',
      'FUNC-9.4', 'FUNC-9.5', 'FUNC-9.7', 'FUNC-9.8', 'FUNC-9.10', 'FUNC-9.11', 'FUNC-9.12', 'FUNC-10',
      'FUNC-11.1', 'FUNC-11.2', 'FUNC-11.3', 'FUNC-19.1', 'FUNC-19.2', 'FUNC-19.3', 'FUNC-19.5', 'FUNC-19.6',
      'FUNC-19.7', 'FUNC-20', 'TECH-9.1', 'TECH-10.1', 'TECH-10.2', 'TECH-10.3', 'TECH-10.4', 'TECH-10.9',
      'TECH-11.1', 'TECH-11.2', 'TECH-11.3', 'TECH-11.4', 'TECH-12.3', 'TECH-15.3', 'TECH-18',
      // v0.2 phase 1: several ships and local switching.
      'FUNC-6.3',
    ]) {
      expect(scopeOf(id), id).toBe('included');
    }
    for (const id of [
      'FUNC-9.6', 'FUNC-9.9', 'FUNC-11.4', 'FUNC-12.2', 'FUNC-13.1', 'FUNC-14.3', 'FUNC-15.2',
      'FUNC-16.3', 'FUNC-17.2', 'FUNC-19.4', 'TECH-8.4', 'TECH-10.5', 'TECH-10.7', 'TECH-10.8',
    ]) {
      expect(scopeOf(id), id).toBe('deferred');
    }
  });
});

describe('the v0.2 acceptance criteria', () => {
  it('records V02-AC-01 to V02-AC-15, each planned or included with the phases that deliver it [TECH-15.2]', () => {
    const v02 = registry.requirements.filter((entry) => entry.id.startsWith('V02-AC-'));
    expect(v02.map((entry) => entry.id)).toEqual(
      Array.from({ length: 15 }, (_unused, index) => `V02-AC-${String(index + 1).padStart(2, '0')}`),
    );
    for (const entry of v02) {
      expect(['planned', 'included'], entry.id).toContain(entry.scope);
      expect((entry as { phases?: number[] }).phases?.length ?? 0, entry.id).toBeGreaterThan(0);
    }
    // Phases 0 and 1 are delivered; the criteria they complete are included.
    const included = v02.filter((entry) => entry.scope === 'included').map((entry) => entry.id);
    expect(included).toEqual(['V02-AC-01', 'V02-AC-03', 'V02-AC-12', 'V02-AC-13']);
  });

  it('holds a planned criterion to no coverage, but an included one to an integration or browser test [TECH-15.2]', () => {
    const planned = buildTraceability({
      registry: { requirements: [{ id: 'V02-AC-06', title: 'Guided', scope: 'planned' } as never] },
      claims: new Map([['V02-AC-06', new Set(['src/engine/domain/combat/formulas.ts'])]]),
      tests: new Map(),
    });
    expect(planned.problems).toEqual([]);
    expect(planned.requirements[0]?.status).toBe('planned');
    expect(planned.summary.planned).toBe(1);

    const included = buildTraceability({
      registry: { requirements: [{ id: 'V02-AC-03', title: 'Switch', scope: 'included' }] },
      claims: new Map([['V02-AC-03', new Set(['src/engine/application/shipCommands.ts'])]]),
      tests: new Map([['V02-AC-03', new Set(['tests/unit/engine/ships.test.ts'])]]),
    });
    expect(included.problems).toEqual(['V02-AC-03: no integration or browser test names it']);
  });
});

describe('the traceability join', () => {
  const included: Entry = { id: 'FUNC-9.2', title: 'Locking', scope: 'included' };

  it('covers a requirement that code claims and a test names [TECH-15.2]', () => {
    const report = reportFor(
      [included],
      { 'FUNC-9.2': ['src/engine/domain/combat/types.ts', 'src/engine/projections/combat.ts', 'src/ui/space/Locks.tsx'] },
      { 'FUNC-9.2': ['tests/unit/engine/combat.test.ts', 'tests/browser/combat.spec.ts'] },
    );

    expect(report.problems).toEqual([]);
    const [entry] = report.requirements;
    expect(entry?.status).toBe('covered');
    expect(entry?.implementation['engine']).toEqual(['src/engine/domain/combat/types.ts']);
    expect(entry?.implementation['projections']).toEqual(['src/engine/projections/combat.ts']);
    expect(entry?.implementation['interface']).toEqual(['src/ui/space/Locks.tsx']);
    expect(entry?.tests['unit']).toEqual(['tests/unit/engine/combat.test.ts']);
    expect(entry?.tests['browser']).toEqual(['tests/browser/combat.spec.ts']);
  });

  it('reports an included requirement no test names, or nothing implements [TECH-15.2]', () => {
    const untested = reportFor([included], { 'FUNC-9.2': ['src/engine/domain/combat/types.ts'] }, {});
    expect(untested.problems).toEqual(['FUNC-9.2: no test names it']);
    expect(untested.summary.uncovered).toBe(1);

    const unimplemented = reportFor([included], {}, { 'FUNC-9.2': ['tests/unit/engine/combat.test.ts'] });
    expect(unimplemented.problems).toEqual(['FUNC-9.2: no production code claims it and no content carries it']);
  });

  it('accepts tests alone only where the registry says tests are the evidence [TECH-15.2]', () => {
    const report = reportFor(
      [{ id: 'TECH-17', title: 'Future Java-server migration', scope: 'included', evidence: 'tests' }],
      {},
      { 'TECH-17': ['tests/unit/shared/canonical.test.ts'] },
    );
    expect(report.problems).toEqual([]);
  });

  it('asks an acceptance criterion for a test of the played loop [TECH-15.2, MVP-AC-01]', () => {
    const criterion: Entry = { id: 'MVP-AC-01', title: 'Start and resume', scope: 'included' };
    const claims = { 'MVP-AC-01': ['src/ui/campaign/CampaignPanel.tsx'] };

    expect(reportFor([criterion], claims, { 'MVP-AC-01': ['tests/unit/engine/saveLoad.test.ts'] }).problems)
      .toEqual(['MVP-AC-01: no integration or browser test names it']);
    expect(reportFor([criterion], claims, { 'MVP-AC-01': ['tests/browser/campaign.spec.ts'] }).problems).toEqual([]);
  });

  it('reports an id the registry does not list, and a deferred one that code claims [TECH-15.2]', () => {
    const deferred: Entry = { id: 'FUNC-9.6', title: 'Guided-weapon accuracy', scope: 'deferred', reason: 'MVP Scope 8.' };
    const report = reportFor(
      [deferred],
      { 'FUNC-9.6': ['src/engine/domain/combat/formulas.ts'], 'FUNC-99.9': ['src/engine/domain/formula.ts'] },
      {},
    );

    expect(report.problems).toEqual([
      'FUNC-99.9: used in code or tests but not in the registry',
      'FUNC-9.6: deferred, yet claimed by src/engine/domain/combat/formulas.ts',
    ]);
  });

  it('reports content and requests the registry names that do not exist [TECH-15.2]', () => {
    const report = reportFor(
      [{ ...included, content: ['content/nowhere'], requests: ['targeting.lock', 'targeting.summon'] }],
      { 'FUNC-9.2': ['src/engine/domain/combat/types.ts'] },
      { 'FUNC-9.2': ['tests/unit/engine/combat.test.ts'] },
    );

    expect(report.problems).toEqual([
      'FUNC-9.2: content "content/nowhere" does not exist',
      'FUNC-9.2: "targeting.summon" is not a protocol request',
    ]);
  });
});

describe('the traceability report for this repository', () => {
  const report = buildTraceability();

  it('has no uncovered included requirement [TECH-15.2, MVP-AC-01, MVP-AC-02, MVP-AC-03, MVP-AC-04, MVP-AC-05, MVP-AC-06, MVP-AC-07, MVP-AC-08, MVP-AC-09, MVP-AC-10]', () => {
    expect(report.problems).toEqual([]);
    expect(report.summary.uncovered).toBe(0);
    expect(report.summary.covered).toBe(report.summary.included);
  });

  it('maps every acceptance criterion to engine code, content or requests, and played tests [TECH-15.2]', () => {
    for (const entry of report.requirements.filter((requirement) => requirement.id.startsWith('MVP-AC-'))) {
      const implemented = Object.values(entry.implementation).flat();
      expect(implemented.length, entry.id).toBeGreaterThan(0);
      expect(entry.requests.length, entry.id).toBeGreaterThan(0);
      const played = [...(entry.tests['integration'] ?? []), ...(entry.tests['browser'] ?? [])];
      expect(played.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('renders every included and every deferred requirement [TECH-15.2]', () => {
    const markdown = renderMarkdown(report);
    for (const entry of report.requirements) expect(markdown).toContain(`**${entry.id}**`);
    expect(markdown).not.toContain('UNCOVERED');
  });
});
