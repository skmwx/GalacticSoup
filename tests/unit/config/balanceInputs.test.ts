import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BALANCE_RUN_MANIFEST,
  createBalanceRun,
  readBalanceRun,
  readBalanceRunManifest,
} from '../../../scripts/lib/balanceInputs.mjs';

/**
 * The balance report's inputs (Test Suite Optimization Plan phase 12).
 *
 * The report joins the sections the balance simulations wrote. These tests
 * hold the rules that decide whether a directory of sections is one complete,
 * current measurement: the run and the content it measured, and exactly the
 * scenarios, careers, matrix cells and seeds the fixtures declare, each once.
 */

const IDENTITY = { contentVersion: '0.2.0+abc', contentHash: 'c'.repeat(64), tuningDigest: 't'.repeat(64) };
const RUN = 'run-1';

const FIXTURES = {
  progression: {
    scenarios: [
      { id: 'scout.starter', fitId: 'starter', encounterId: 'encounter.scout', seeds: ['s1', 's2'], sorties: 2 },
      { id: 'base.mastery', fitId: 'mastery', encounterId: 'encounter.base', seeds: ['s1'], sorties: 1 },
    ],
  },
  careers: { careers: [{ id: 'scout-first', seeds: ['k1', 'k2'] }] },
  matrix: {
    seeds: ['m1', 'm2', 'm3'],
    policies: { 'fit.a': {}, 'fit.b': {} },
    sites: { 'encounter.scout': {} },
    claims: [{ id: 'a-beats-b', encounterId: 'encounter.scout' }, { id: 'elsewhere', encounterId: 'encounter.base' }],
  },
};

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function stamp(runId: string | null = RUN, identity = IDENTITY): object {
  return { runId, contentVersion: identity.contentVersion, contentHash: identity.contentHash };
}

function scenario(id: string, fitId: string, encounterId: string, seeds: string[], sorties: number): object {
  return {
    scenarioId: id,
    fitId,
    encounterId,
    planned: seeds.length * sorties,
    outcomes: seeds.flatMap((seed) => Array.from({ length: sorties }, (_, index) => ({ seed, sortie: index + 1 }))),
  };
}

function cell(fitId: string, seeds: string[]): object {
  return { fitId, encounterId: 'encounter.scout', seeds: seeds.length, outcomes: seeds.map((seed) => ({ seed })) };
}

/** A complete, current run: every section the fixtures ask for. */
function completeSections(): Record<string, Record<string, unknown>> {
  return {
    'scenarios-early': {
      kind: 'scenarios',
      run: stamp(),
      scenarios: [scenario('scout.starter', 'starter', 'encounter.scout', ['s1', 's2'], 2)],
    },
    'scenarios-mastery': {
      kind: 'scenarios',
      run: stamp(),
      scenarios: [scenario('base.mastery', 'mastery', 'encounter.base', ['s1'], 1)],
    },
    'career-scout-first': {
      kind: 'careers',
      run: stamp(),
      careers: [{ careerId: 'scout-first', runs: [{ careerId: 'scout-first', seed: 'k1' }, { careerId: 'scout-first', seed: 'k2' }] }],
    },
    'matrix-scout': {
      kind: 'matrix',
      run: stamp(),
      encounterId: 'encounter.scout',
      cells: [cell('fit.a', ['m1', 'm2', 'm3']), cell('fit.b', ['m1', 'm2', 'm3'])],
      verdicts: [{ id: 'a-beats-b' }],
    },
    'selective-kills': { kind: 'figures', run: stamp(), rows: [] },
  };
}

function runDirectory(
  sections: Record<string, unknown>,
  manifest: { runId: string; contentHash?: string } | null = { runId: RUN },
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galactic-soup-balance-'));
  created.push(dir);
  if (manifest !== null) {
    createBalanceRun(dir, {
      runId: manifest.runId,
      sourceDigest: 'd'.repeat(64),
      identity: { ...IDENTITY, contentHash: manifest.contentHash ?? IDENTITY.contentHash },
      createdAt: '2026-11-20T00:00:00.000Z',
    });
  }
  for (const [name, section] of Object.entries(sections)) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(section), 'utf8');
    fs.writeFileSync(path.join(dir, `${name}.md`), `## ${name}\n`, 'utf8');
  }
  return dir;
}

function problemsOf(dir: string, requireRun = true): string[] {
  return readBalanceRun(dir, { identity: IDENTITY, fixtures: FIXTURES, requireRun }).problems;
}

describe('a balance run', () => {
  it('starts empty, with a manifest naming the run, the sources and the content', () => {
    const dir = runDirectory({ leftover: { kind: 'figures', run: stamp('old') } });
    createBalanceRun(dir, { runId: 'run-2', sourceDigest: 'e'.repeat(64), identity: IDENTITY });

    expect(fs.readdirSync(dir)).toEqual([BALANCE_RUN_MANIFEST]);
    expect(readBalanceRunManifest(dir)).toMatchObject({
      runId: 'run-2',
      sourceDigest: 'e'.repeat(64),
      contentHash: IDENTITY.contentHash,
      tuningDigest: IDENTITY.tuningDigest,
    });
  });

  it('joins a complete, current run', () => {
    const dir = runDirectory(completeSections());
    const run = readBalanceRun(dir, { identity: IDENTITY, fixtures: FIXTURES, requireRun: true });

    expect(run.problems).toEqual([]);
    expect([...run.scenarios.keys()]).toEqual(['scout.starter', 'base.mastery']);
    expect([...run.careers.keys()]).toEqual(['scout-first']);
    expect([...run.matrix.keys()]).toEqual(['encounter.scout']);
    expect(run.manifest?.runId).toBe(RUN);
  });

  it('accepts sections without a run id when no run is required, as npm run balance writes them', () => {
    const sections = completeSections();
    for (const section of Object.values(sections)) section['run'] = stamp(null);
    expect(problemsOf(runDirectory(sections, null), false)).toEqual([]);
  });
});

describe('stale inputs', () => {
  it('refuses a section of another run', () => {
    const sections = completeSections();
    sections['career-scout-first']!['run'] = stamp('run-0');
    expect(problemsOf(runDirectory(sections))).toEqual(expect.arrayContaining([
      expect.stringMatching(/^career-scout-first\.json belongs to run run-0, not to this run run-1/),
      expect.stringMatching(/no measurement for scout-first/),
    ]));
  });

  it('refuses a section written before sections were stamped', () => {
    const sections = completeSections();
    delete sections['matrix-scout']!['run'];
    expect(problemsOf(runDirectory(sections))).toEqual(expect.arrayContaining([
      expect.stringMatching(/^matrix-scout\.json carries no run stamp/),
    ]));
  });

  it('refuses a directory that is not a run when a run is required', () => {
    expect(problemsOf(runDirectory(completeSections(), null))).toEqual(expect.arrayContaining([
      expect.stringMatching(/has no run\.json: it is not a balance run directory/),
    ]));
  });
});

describe('the wrong identity', () => {
  it('refuses a section that measured other content', () => {
    const sections = completeSections();
    sections['scenarios-early']!['run'] = stamp(RUN, { ...IDENTITY, contentHash: 'f'.repeat(64) });
    expect(problemsOf(runDirectory(sections))).toEqual(expect.arrayContaining([
      expect.stringMatching(/^scenarios-early\.json measured content .*\(ffffffffffff\), not the current .*it is stale/),
    ]));
  });

  it('refuses a run started for other content', () => {
    expect(problemsOf(runDirectory(completeSections(), { runId: RUN, contentHash: 'f'.repeat(64) }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^the run run-1 was started for content ffffffffffff/)]),
    );
  });
});

describe('duplicates', () => {
  it('refuses a scenario measured in two sections', () => {
    const sections = completeSections();
    sections['scenarios-again'] = {
      kind: 'scenarios',
      run: stamp(),
      scenarios: [scenario('base.mastery', 'mastery', 'encounter.base', ['s1'], 1)],
    };
    expect(problemsOf(runDirectory(sections))).toEqual([
      'scenario base.mastery was measured twice, in scenarios-again.json and scenarios-mastery.json.',
    ]);
  });

  it('refuses a seed flown twice in a career', () => {
    const sections = completeSections();
    sections['career-scout-first']!['careers'] = [{
      careerId: 'scout-first',
      runs: [{ seed: 'k1' }, { seed: 'k2' }, { seed: 'k2' }],
    }];
    expect(problemsOf(runDirectory(sections))).toEqual([
      'career-scout-first.json: career scout-first repeats seeds k2.',
    ]);
  });

  it('refuses a matrix fit measured twice', () => {
    const sections = completeSections();
    sections['matrix-scout']!['cells'] = [
      cell('fit.a', ['m1', 'm2', 'm3']), cell('fit.b', ['m1', 'm2', 'm3']), cell('fit.b', ['m1', 'm2', 'm3']),
    ];
    expect(problemsOf(runDirectory(sections))).toEqual([
      'matrix-scout.json: matrix encounter.scout repeats fits fit.b.',
    ]);
  });
});

describe('missing and partial measurements', () => {
  it('refuses a run without one of the declared sections', () => {
    const sections = completeSections();
    delete sections['scenarios-mastery'];
    expect(problemsOf(runDirectory(sections))).toEqual(['no measurement for base.mastery.']);
  });

  it('refuses a matrix cell flown over an exploratory subset of the seeds', () => {
    const sections = completeSections();
    sections['matrix-scout']!['cells'] = [cell('fit.a', ['m1', 'm2', 'm3']), cell('fit.b', ['m1'])];
    expect(problemsOf(runDirectory(sections))).toEqual([
      "matrix-scout.json: matrix encounter.scout, fit fit.b counts 1 seeds, not the fixture's 3.",
      'matrix-scout.json: matrix encounter.scout, fit fit.b is missing seeds m2, m3.',
    ]);
  });

  it('refuses a matrix site without one of its fits or its declared claims', () => {
    const sections = completeSections();
    sections['matrix-scout']!['cells'] = [cell('fit.a', ['m1', 'm2', 'm3'])];
    sections['matrix-scout']!['verdicts'] = [];
    expect(problemsOf(runDirectory(sections))).toEqual([
      'matrix-scout.json: matrix encounter.scout is missing fits fit.b.',
      'matrix-scout.json: matrix encounter.scout is missing claims a-beats-b.',
    ]);
  });

  it('refuses a scenario short of its sorties or flown over other seeds', () => {
    const sections = completeSections();
    sections['scenarios-early']!['scenarios'] = [scenario('scout.starter', 'starter', 'encounter.scout', ['s1', 'x9'], 2)];
    expect(problemsOf(runDirectory(sections))).toEqual([
      'scenarios-early.json: scenario scout.starter is missing sorties s2#1, s2#2.',
      'scenarios-early.json: scenario scout.starter has sorties the fixture does not declare: x9#1, x9#2.',
    ]);
  });

  it('refuses a career short of a seed, and a measurement no fixture declares', () => {
    const sections = completeSections();
    sections['career-scout-first']!['careers'] = [
      { careerId: 'scout-first', runs: [{ seed: 'k1' }] },
      { careerId: 'retired', runs: [] },
    ];
    expect(problemsOf(runDirectory(sections))).toEqual([
      'career-scout-first.json: career scout-first is missing seeds k2.',
      'career-scout-first.json measured career retired, which no fixture declares.',
    ]);
  });
});
