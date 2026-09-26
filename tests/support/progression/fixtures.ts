import scenarioFile from '../../fixtures/scenarios/progression.json';

/**
 * The representative fits and the encounters they are meant for
 * (MVP Implementation Plan phase 16; MVP Scope 4.1-4.3).
 *
 * `tests/fixtures/scenarios/progression.json` is data, not code, so the fits a
 * progression claim rests on can be read and changed without reading a test.
 * Each fit names only definitions and quantities; how it is bought, fitted and
 * loaded is the ordinary station flow, performed by `assemble.ts`.
 */

export type FixtureSlotKind = 'weapon' | 'system' | 'engineering' | 'utility';

export interface FixtureFitSlot {
  readonly slot: FixtureSlotKind;
  readonly index: number;
  readonly moduleId: string;
  /** The charge a turret is loaded with. */
  readonly ammunitionId?: string;
}

export interface FixtureCargo {
  readonly definitionId: string;
  readonly quantity: number;
}

export interface FixtureFit {
  readonly id: string;
  /** Why this fit represents its stage of progression. */
  readonly description: string;
  readonly modules: readonly FixtureFitSlot[];
  /** Reserve ammunition carried in the hold. */
  readonly cargo: readonly FixtureCargo[];
}

export type MovementKind = 'orbit' | 'keepRange' | 'approach';

/**
 * How the scripted pilot commands the ship. Each value is a decision a player
 * makes with the ordinary controls; none of them reaches past the protocol.
 */
export interface PilotTactics {
  readonly arrivalDistanceKm: number;
  /** Opponent profiles in the order they are engaged; the rest follow, nearest first. */
  readonly targetPriority: readonly string[];
  /** The movement order held against the current target. */
  readonly movement: { readonly kind: MovementKind; readonly distanceKm: number };
  /** `closing` burns only while the target is well outside the chosen distance. */
  readonly propulsion: 'always' | 'never' | 'closing';
  /**
   * Active repair runs while its layer is below this share of its maximum and
   * stops once the layer is full; above 1 it simply keeps running.
   */
  readonly repairBelowFraction: number;
  /**
   * Repair pauses while the capacitor is below this share, keeping charge for
   * propulsion and guns that need it. Absent spends every unit on repair.
   */
  readonly repairCapacitorFloor?: number;
  /** Retreat once the hull falls below this share; absent fights to the end. */
  readonly retreatBelowHullFraction?: number;
}

export type ScenarioExpectation = 'completed' | 'notCompleted';

/** An inclusive range a measured value must fall in. */
export type Band = readonly [minimum: number, maximum: number];

/**
 * What the listed seeds must measure (MVP Implementation Plan phase 17).
 *
 * The bands are deterministic: a seed fixes every random stream, so a band
 * that moves means the content or the rules moved. They are also the facts the
 * dominance witnesses below reason from.
 */
export interface ScenarioBand {
  /** Share of planned sorties that complete; a loss ends a seed, so unflown sorties count against it. */
  readonly completedShare: Band;
  /** Median seconds from arrival to the last opponent's destruction, over completed sorties. */
  readonly medianFightSeconds?: Band;
  /** Mean share of the ship's hit points missing when each sortie ends; a loss counts as 1. */
  readonly hitPointsLost?: Band;
  /** Mean damage the ship took per sortie after resistances, whatever its repairers put back. */
  readonly damageTaken?: Band;
}

export interface FixtureScenario {
  readonly id: string;
  readonly description: string;
  readonly encounterId: string;
  readonly fitId: string;
  readonly tactics: PilotTactics;
  /**
   * What the fit is meant to do here: clear the site, repeatably, with the full
   * bounty (`completed`), or fall short of it (`notCompleted`).
   */
  readonly expect: ScenarioExpectation;
  readonly band: ScenarioBand;
  readonly seeds: readonly string[];
  /** Consecutive sorties per seed; a completed site must stay repeatable (MVP-AC-09). */
  readonly sorties: number;
}

export type DominanceMeasure = keyof ScenarioBand;

/**
 * Why one representative fit is not the best choice everywhere: at this
 * encounter another fit's band on this measure is strictly better than its
 * own. One witness per fit proves that no fit is universally dominant across
 * the scoped encounters (MVP Implementation Plan phase 17).
 */
export interface DominanceWitness {
  readonly fitId: string;
  readonly outperformedBy: string;
  readonly encounterId: string;
  readonly measure: DominanceMeasure;
  readonly reason: string;
}

export interface DominanceFixtures {
  /** The fits that stand for the ways to play the loop; the poor purchase is not one. */
  readonly fits: readonly string[];
  readonly witnesses: readonly DominanceWitness[];
}

export interface ProgressionFixtures {
  readonly fits: readonly FixtureFit[];
  readonly scenarios: readonly FixtureScenario[];
  readonly dominance: DominanceFixtures;
}

export const PROGRESSION: ProgressionFixtures = scenarioFile as unknown as ProgressionFixtures;

export function fixtureFit(id: string): FixtureFit {
  const fit = PROGRESSION.fits.find((candidate) => candidate.id === id);
  if (fit === undefined) throw new Error(`No representative fit "${id}".`);
  return fit;
}

export function fixtureScenario(id: string): FixtureScenario {
  const scenario = PROGRESSION.scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`No progression scenario "${id}".`);
  return scenario;
}

/** The scenario that sets a fit against an encounter, when the fixtures hold one. */
export function scenarioFor(fitId: string, encounterId: string): FixtureScenario | undefined {
  return PROGRESSION.scenarios.find((candidate) => candidate.fitId === fitId && candidate.encounterId === encounterId);
}
