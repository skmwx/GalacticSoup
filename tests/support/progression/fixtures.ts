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

export interface FixtureScenario {
  readonly id: string;
  readonly description: string;
  readonly encounterId: string;
  readonly fitId: string;
  readonly tactics: PilotTactics;
  /** What the listed seeds must produce. */
  readonly expect: ScenarioExpectation;
  /**
   * For `completed`, the share of sorties that must complete; absent means
   * every one. A band, not a promise, for an approach that wins most fights
   * rather than all of them.
   */
  readonly minimumCompletedShare?: number;
  readonly seeds: readonly string[];
  /** Consecutive sorties per seed; a completed site must stay repeatable (MVP-AC-09). */
  readonly sorties: number;
}

export interface ProgressionFixtures {
  readonly fits: readonly FixtureFit[];
  readonly scenarios: readonly FixtureScenario[];
}

export const PROGRESSION: ProgressionFixtures = scenarioFile as ProgressionFixtures;

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
