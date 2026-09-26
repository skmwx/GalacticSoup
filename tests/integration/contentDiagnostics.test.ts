import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../config/aliases.mjs';
import { shippedContent } from '../support/content.ts';
import { assembleFit } from '../support/progression/assemble.ts';
import {
  describeDiagnosis,
  diagnoseEncounter,
  renderDiagnosticsMarkdown,
  type DiagnosedScenario,
} from '../support/progression/diagnostics.ts';
import { fixtureFit, PROGRESSION } from '../support/progression/fixtures.ts';

/**
 * Content diagnostics for every progression scenario
 * (MVP Implementation Plan phase 16; Technical Specification 6.2, 16).
 *
 * `npm run diagnose:content` runs this file. It sets each representative fit
 * against its encounter with the engine's own formulas and writes the result
 * to `reports/content-diagnostics.md` (and `.json`), so a failing progression
 * scenario can be read against the numbers that explain it.
 *
 * The assertions keep the explanation honest: a fit expected to clear its
 * encounter must not be diagnosed as unable to, and a fit expected to fail
 * must be diagnosed with a cause. When content drifts so that one of these
 * disagrees, the report says which number moved.
 */

const content = shippedContent();

function diagnoseAll(): DiagnosedScenario[] {
  return PROGRESSION.scenarios.map((scenario) => {
    const fit = fixtureFit(scenario.fitId);
    return {
      scenarioId: scenario.id,
      expect: scenario.expect,
      costCredits: assembleFit(fit, scenario.seeds[0] ?? '', content).costCredits,
      diagnosis: diagnoseEncounter(content, scenario.encounterId, fit, scenario.tactics),
    };
  });
}

describe('content diagnostics', () => {
  it('explains every representative fit against its encounter and writes the report [MVP-AC-05, MVP-AC-07, TECH-6.2, TECH-16]', () => {
    const diagnosed = diagnoseAll();

    const reports = path.join(REPO_ROOT, 'reports');
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, 'content-diagnostics.md'), renderDiagnosticsMarkdown(diagnosed), 'utf8');
    fs.writeFileSync(
      path.join(reports, 'content-diagnostics.json'),
      `${JSON.stringify({ generatedFor: 'Galactic Soup', scenarios: diagnosed }, null, 2)}\n`,
      'utf8',
    );

    for (const { scenarioId, expect: expected, diagnosis } of diagnosed) {
      const scenario = PROGRESSION.scenarios.find((candidate) => candidate.id === scenarioId);
      const causes = diagnosis.findings.filter((finding) => finding.severity !== 'note');
      if (expected === 'completed') {
        // A scenario that must win every fight may carry no cause for losing
        // one. A band - an approach that wins most fights - may carry a
        // warning, but never a cause that makes the site impossible.
        const disqualifying = (scenario?.band.completedShare[0] ?? 1) < 1
          ? causes.filter((finding) => finding.severity === 'blocking')
          : causes;
        expect(disqualifying, `${scenarioId}: ${describeDiagnosis(diagnosis)}`).toEqual([]);
        expect(diagnosis.secondsToDestroyAll, scenarioId).not.toBeNull();
      } else {
        expect(causes.length, `${scenarioId} should be diagnosed with a cause: ${describeDiagnosis(diagnosis)}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('diagnoses an opponent no fitted weapon can reach as a blocking cause [TECH-16]', () => {
    // The marksman keeps its range; a fit whose only gun is short-ranged and
    // whose ship is slower cannot land anything there.
    const diagnosis = diagnoseEncounter(content, 'encounter.borrell.pirate-patrol', {
      id: 'probe',
      description: 'One autocannon on fusion rounds, nothing else.',
      modules: [{
        slot: 'weapon', index: 0, moduleId: 'module.turret.autocannon.small', ammunitionId: 'ammo.projectile.small.fusion',
      }],
      cargo: [],
    }, {
      arrivalDistanceKm: 10,
      targetPriority: ['npc.pirate.marksman'],
      movement: { kind: 'orbit', distanceKm: 1 },
      propulsion: 'never',
      repairBelowFraction: 0.8,
    });
    const marksman = diagnosis.opponents.find((opponent) => opponent.profileId === 'npc.pirate.marksman');

    expect(marksman?.engagementRangeKm).toBe(marksman?.preferredRangeKm);
    expect(diagnosis.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['outpaced', 'ammunition']),
    );
    expect(diagnosis.player.repairPerSecond).toBe(0);
  });
});
