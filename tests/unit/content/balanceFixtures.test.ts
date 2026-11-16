import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import { tuningDigest } from '../../../scripts/lib/content/tuning.mjs';
import { CAREERS, careerFit, careerScenario } from '../../support/balance/career.ts';
import { MATRIX, matrixFits } from '../../support/balance/matrix.ts';
import { shippedContent } from '../../support/content.ts';
import { compilePack, shippedPack } from '../../support/contentFixtures.ts';
import {
  fixtureFit,
  fixtureScenario,
  PROGRESSION,
  scenarioFor,
  type Band,
  type DominanceMeasure,
} from '../../support/progression/fixtures.ts';

/**
 * The balance fixtures hold together (MVP Implementation Plan phase 17).
 *
 * The simulations measure; these checks make sure what they measure adds up
 * to the claims made from it, without flying a sortie:
 *
 * - every representative fit is set against every scoped encounter;
 * - no representative fit is universally dominant: each is strictly
 *   outperformed somewhere, and that follows from the bands alone, which the
 *   simulations hold the measurements to;
 * - every career is a plan a player could follow with the fixtures' fits and
 *   scenarios;
 * - the recorded candidate tuning bundle is the one installed, so a tuning
 *   change cannot leave the release-candidate comparison stale unnoticed.
 */

const LOWER_IS_BETTER: ReadonlySet<DominanceMeasure> = new Set(['medianFightSeconds', 'hitPointsLost', 'damageTaken']);

function bandOf(scenarioId: string, measure: DominanceMeasure): Band {
  const band = fixtureScenario(scenarioId).band[measure];
  if (band === undefined) throw new Error(`${scenarioId} has no ${measure} band.`);
  return band;
}

describe('balance fixtures', () => {
  it('sets every representative fit against every scoped encounter, with well-formed bands [MVP-AC-05, MVP-AC-07, TECH-15.1]', () => {
    const encounters = [...new Set(PROGRESSION.scenarios.map((scenario) => scenario.encounterId))].sort();
    expect(encounters).toHaveLength(3);
    for (const fitId of PROGRESSION.dominance.fits) {
      fixtureFit(fitId);
      for (const encounterId of encounters) {
        expect(scenarioFor(fitId, encounterId), `${fitId} at ${encounterId}`).toBeDefined();
      }
    }
    for (const scenario of PROGRESSION.scenarios) {
      fixtureFit(scenario.fitId);
      expect(scenario.seeds.length, scenario.id).toBeGreaterThan(0);
      for (const [measure, band] of Object.entries(scenario.band)) {
        expect(band[0], `${scenario.id} ${measure}`).toBeLessThanOrEqual(band[1]);
      }
      const [low, high] = scenario.band.completedShare;
      // A fit meant for its site must clear it; one meant to fall short must sometimes fail.
      if (scenario.expect === 'completed') expect(low, scenario.id).toBeGreaterThan(0);
      else expect(high, scenario.id).toBeLessThan(1);
    }
  });

  it('leaves no representative fit universally dominant across the scoped encounters [MVP-AC-05, MVP-AC-07, FUNC-8.1, FUNC-21]', () => {
    for (const fitId of PROGRESSION.dominance.fits) {
      const witnesses = PROGRESSION.dominance.witnesses.filter((witness) => witness.fitId === fitId);
      expect(witnesses.length, `${fitId} has no witness that another fit outperforms it somewhere`).toBeGreaterThan(0);
    }
    for (const witness of PROGRESSION.dominance.witnesses) {
      expect(PROGRESSION.dominance.fits).toContain(witness.outperformedBy);
      const own = scenarioFor(witness.fitId, witness.encounterId);
      const other = scenarioFor(witness.outperformedBy, witness.encounterId);
      if (own === undefined || other === undefined) throw new Error(`No scenario for a witness of ${witness.fitId}.`);
      const [ownLow, ownHigh] = bandOf(own.id, witness.measure);
      const [otherLow, otherHigh] = bandOf(other.id, witness.measure);
      // Strictly better across the whole band, so any measurement inside the
      // bands proves the ordering.
      if (LOWER_IS_BETTER.has(witness.measure)) {
        expect(otherHigh, `${other.id} against ${own.id} on ${witness.measure}`).toBeLessThan(ownLow);
      } else {
        expect(otherLow, `${other.id} against ${own.id} on ${witness.measure}`).toBeGreaterThan(ownHigh);
      }
    }
  });

  it('describes careers a player could follow with the fixtures\' fits and scenarios [MVP-AC-07, MVP-AC-08, V02-AC-11]', () => {
    const content = shippedContent();
    for (const fitId of [...CAREERS.startingWallet.affordable, ...CAREERS.startingWallet.unaffordable]) fixtureFit(fitId);
    const objectives = new Set<string>();
    for (const career of CAREERS.careers) {
      career.objectives.forEach((objective) => objectives.add(objective));
      expect(career.seeds.length, career.id).toBeGreaterThan(0);
      const first = career.steps[0];
      expect(first !== undefined && 'equip' in first, `${career.id} starts at the station`).toBe(true);
      let equipped: string | null = null;
      for (const step of career.steps) {
        if ('equip' in step) {
          equipped = careerFit(step.equip, content).id;
          continue;
        }
        expect(careerScenario(step.fly).fitId, `${career.id} flies ${step.fly} with ${String(equipped)}`).toBe(equipped);
        expect(step.maxSorties, `${career.id} ${step.fly}`).toBeGreaterThan(0);
        if ('affords' in step.until) careerFit(step.until.affords, content);
      }
    }
    // Together the careers stand for every MVP Scope 4.3 objective the
    // starting-wallet test does not.
    for (const objective of ['4.3.1', '4.3.3', '4.3.4', '4.3.5', '4.3.6']) expect(objectives).toContain(objective);
  });

  it('declares the fit matrix\'s comparisons in advance, with at least two same-hull reversals and both hull steps [V02-AC-04, V02-AC-11]', () => {
    const content = shippedContent();
    const fits = matrixFits();
    // Every authored reference fit has a policy, and every ladder site a priority.
    const reference = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'balance', 'reference-fits.json'), 'utf8')) as { fits: { id: string }[] };
    expect([...fits].sort()).toEqual(reference.fits.map((fit) => fit.id).sort());
    expect(Object.keys(MATRIX.sites).sort()).toEqual(content.encounters().map((encounter) => encounter.id).sort());
    expect(MATRIX.seeds.length).toBeGreaterThanOrEqual(10);
    expect(new Set(MATRIX.seeds).size).toBe(MATRIX.seeds.length);

    const hullOf = (fitId: string): string => careerFit(fitId, content).hullId ?? content.rules.economy.starterHullId;
    const ids = new Set<string>();
    for (const claim of MATRIX.claims) {
      expect(ids.has(claim.id), claim.id).toBe(false);
      ids.add(claim.id);
      expect(fits, claim.id).toContain(claim.better);
      expect(fits, claim.id).toContain(claim.worse);
      expect(Object.keys(MATRIX.sites), claim.id).toContain(claim.encounterId);
      expect(['outcome', 'medianFightSeconds', 'repairBurden', 'runningCost'], claim.id).toContain(claim.metric);
      expect(claim.reason.length, claim.id).toBeGreaterThan(20);
    }
    const claim = (id: string) => {
      const found = MATRIX.claims.find((entry) => entry.id === id);
      if (found === undefined) throw new Error(`No claim ${id}.`);
      return found;
    };

    // Same-hull reversals: two claims on one hull, opposite winners, different sites.
    expect(MATRIX.reversals.length).toBeGreaterThanOrEqual(2);
    for (const reversal of MATRIX.reversals) {
      const [first, second] = reversal.claims.map(claim);
      expect(first!.kind).toBe('preference');
      expect(second!.kind).toBe('preference');
      for (const fitId of reversal.fits) expect(hullOf(fitId)).toBe(reversal.hullId);
      expect([first!.better, first!.worse].sort()).toEqual([...reversal.fits].sort());
      expect(second!.better).toBe(first!.worse);
      expect(second!.worse).toBe(first!.better);
      expect(second!.encounterId).not.toBe(first!.encounterId);
    }

    // Both hull steps, each the larger hull over the smaller one at a fixed site...
    const steps = MATRIX.claims.filter((entry) => entry.kind === 'hullStep');
    const step = (from: string, to: string) => steps.some((entry) => hullOf(entry.worse) === from && hullOf(entry.better) === to);
    expect(step('hull.independent.starter', 'hull.independent.destroyer')).toBe(true);
    expect(step('hull.independent.destroyer', 'hull.independent.cruiser')).toBe(true);
    // ...and the larger hull's disadvantage against small targets or in what it costs to run.
    const disadvantages = MATRIX.claims.filter((entry) => entry.kind === 'smallTarget' || entry.kind === 'operatingCost');
    expect(disadvantages.some((entry) => hullOf(entry.worse) === 'hull.independent.cruiser')).toBe(true);
    for (const entry of disadvantages) {
      const sizes = ['hull.independent.starter', 'hull.independent.destroyer', 'hull.independent.cruiser'];
      expect(sizes.indexOf(hullOf(entry.worse)), entry.id).toBeGreaterThan(sizes.indexOf(hullOf(entry.better)));
    }
  });

  it('records the installed tuning as the release-candidate balance bundle [TECH-15.1, TECH-16]', () => {
    const file = path.join(REPO_ROOT, 'tests', 'fixtures', 'balance', 'candidate.json');
    const candidate = JSON.parse(fs.readFileSync(file, 'utf8')) as { tuningDigest: string; seeds: string[] };
    const compiled = compilePack(shippedPack(), { floor: true });
    expect(compiled.ok).toBe(true);
    expect(
      candidate.tuningDigest,
      'The tuning changed since the balance candidate was recorded: run npm run balance:record and review reports/balance.md.',
    ).toBe(tuningDigest(compiled.bundle as never));
    // Every seed a simulation uses is recorded with it.
    const seeds = new Set([
      ...PROGRESSION.scenarios.flatMap((scenario) => scenario.seeds),
      ...CAREERS.careers.flatMap((career) => career.seeds),
      ...MATRIX.seeds,
    ]);
    expect([...seeds].sort()).toEqual(candidate.seeds);
  });
});
