import fs from 'node:fs';
import path from 'node:path';

import type { ContentRepository } from '@engine';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import ladderFile from '../../fixtures/scenarios/ladder.json';

import { fixtureFit, type FixtureFit, type FixtureScenario, type FixtureSlotKind } from './fixtures.ts';

/**
 * The twelve-site ladder's completion fixtures (FeatureSpec02 8.1-8.2; v0.2
 * Implementation Plan phase 5).
 *
 * Each scenario sets one site against a fit a player could have for it - the
 * starter fit for the onboarding site, one of the authored reference fits
 * (`content/balance/reference-fits.json`) everywhere else - and the tactics a
 * competent pilot would fly it with. The fits are bought at the starting
 * station, on the hull they name, through the ordinary commands, so each
 * scenario also proves the fit is obtainable. Phase 6 grows this into the
 * measured fit-versus-site matrix; here it shows that every site can be
 * completed, repeatedly, with the full bounty.
 */

interface ReferenceFit {
  readonly id: string;
  readonly hullId: string;
  readonly approach: string;
  readonly modules: readonly { readonly moduleId: string; readonly ammunitionId?: string }[];
  readonly reserve: readonly { readonly ammunitionId: string; readonly quantity: number }[];
}

export interface LadderFixtures {
  /** Each site against a fit made for it: must complete, repeatedly. */
  readonly scenarios: readonly FixtureScenario[];
  /** Each fit-sensitive site against the fit its briefing says it punishes: must not complete. */
  readonly weakFits: readonly FixtureScenario[];
}

export const LADDER: LadderFixtures = ladderFile as unknown as LadderFixtures;

const REFERENCE_FITS = (JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'content', 'balance', 'reference-fits.json'), 'utf8'),
) as { fits: ReferenceFit[] }).fits;

/** An authored reference fit as the harness flies it: each module in the next slot of its kind. */
export function referenceFixtureFit(id: string, content: ContentRepository): FixtureFit {
  const fit = REFERENCE_FITS.find((candidate) => candidate.id === id);
  if (fit === undefined) throw new Error(`No reference fit "${id}".`);
  const next: Partial<Record<FixtureSlotKind, number>> = {};
  return {
    id: fit.id,
    description: fit.approach,
    hullId: fit.hullId,
    modules: fit.modules.map((entry) => {
      const slot = content.requireModule(entry.moduleId as never).slot as FixtureSlotKind;
      const index = next[slot] ?? 0;
      next[slot] = index + 1;
      return {
        slot,
        index,
        moduleId: entry.moduleId,
        ...(entry.ammunitionId === undefined ? {} : { ammunitionId: entry.ammunitionId }),
      };
    }),
    cargo: fit.reserve.map((entry) => ({ definitionId: entry.ammunitionId, quantity: entry.quantity })),
  };
}

/** The fit a ladder scenario flies: a reference fit, or a progression fixture fit such as the starter. */
export function ladderFit(fitId: string, content: ContentRepository): FixtureFit {
  return fitId.startsWith('fit.') ? referenceFixtureFit(fitId, content) : fixtureFit(fitId);
}

export function ladderScenario(id: string): FixtureScenario {
  const scenario = LADDER.scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`No ladder scenario "${id}".`);
  return scenario;
}
