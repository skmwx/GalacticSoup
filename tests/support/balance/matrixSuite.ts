import process from 'node:process';

import { afterAll, describe, expect, it } from 'vitest';

import { shippedContent } from '../content.ts';

import {
  judgeClaim,
  MATRIX,
  matrixFits,
  measureCell,
  type CellSummary,
  type ClaimVerdict,
} from './matrix.ts';
import { writeBalanceSection } from './report.ts';

/**
 * One site's row of the fit-versus-site matrix, as a test file of its own so
 * that the twelve rows run side by side (v0.2 Implementation Plan phase 6).
 *
 * Every reference fit flies the site over the matrix seeds; the cells and the
 * verdict on every claim declared at this site are written to
 * `reports/balance/matrix-<site>.json` for the balance report. A claim that
 * does not hold fails the file with the figures on both sides.
 *
 * `BALANCE_MATRIX_SEEDS=<n>` flies only the first n seeds and skips the
 * claims: an exploratory pass while tuning, never evidence.
 */

const content = shippedContent();

export function matrixSiteSuite(encounterId: string): void {
  const exploratory = Number(process.env['BALANCE_MATRIX_SEEDS'] ?? 0);
  const seeds = exploratory > 0 ? MATRIX.seeds.slice(0, exploratory) : MATRIX.seeds;
  const short = encounterId.replace('encounter.borrell.', '');
  const cells = new Map<string, CellSummary>();
  const verdicts: ClaimVerdict[] = [];
  const claims = MATRIX.claims.filter((claim) => claim.encounterId === encounterId);

  afterAll(() => {
    if (exploratory > 0) return;
    writeBalanceSection(`matrix-${short}`, {
      kind: 'matrix',
      title: `Fit matrix: ${short}`,
      encounterId,
      cells: matrixFits().map((fitId) => cells.get(fitId)).filter((cell): cell is CellSummary => cell !== undefined),
      verdicts: verdicts.map((verdict) => ({ ...verdict.claim, holds: verdict.holds, evidence: verdict.evidence })),
    });
  });

  describe(`fit matrix: ${short}`, () => {
    it.each(matrixFits())(
      `flies %s over the fixed seeds with its command policy [V02-AC-04, V02-AC-11]`,
      async (fitId) => {
        const cell = await measureCell(fitId, encounterId, content, seeds);
        cells.set(fitId, cell);
        if (exploratory > 0) {
          process.stdout.write(`MATRIX ${JSON.stringify({ ...cell, outcomes: undefined })}\n`);
        }
        expect(cell.outcomes).toHaveLength(seeds.length);
        // A supplied fit always fires: no cell is a comparison against an empty magazine.
        expect(cell.meanRoundsFired, `${fitId} at ${short} never fired`).toBeGreaterThan(0);
      },
      1_200_000,
    );

    if (claims.length > 0 && exploratory === 0) {
      it.each(claims.map((claim) => [claim.id, claim] as const))(
        'holds the declared comparison %s [V02-AC-04, V02-AC-11]',
        (_id, claim) => {
          const better = cells.get(claim.better);
          const worse = cells.get(claim.worse);
          expect(better, `${claim.better} was not measured`).toBeDefined();
          expect(worse, `${claim.worse} was not measured`).toBeDefined();
          const verdict = judgeClaim(claim, better!, worse!);
          verdicts.push(verdict);
          expect(verdict.holds, `${claim.id} (${claim.metric}): ${verdict.evidence}. ${claim.reason}`).toBe(true);
        },
      );
    }
  });
}
