import type { ContentRepository } from '@engine';
import type {
  AssetsData,
  MarketTransactionPreviewData,
  RepairPreviewData,
  StackData,
} from '@protocol';

import matrixFile from '../../fixtures/balance/matrix.json';
import { assembleFit } from '../progression/assemble.ts';
import { median, totalBounty } from '../progression/expectations.ts';
import type { FixtureScenario, PilotTactics } from '../progression/fixtures.ts';
import { referenceFixtureFit } from '../progression/ladder.ts';
import { flySortie, type SortieRecord } from '../progression/scenario.ts';
import { openSession, type ScenarioSession } from '../progression/session.ts';

/**
 * The seeded fit-versus-site matrix (v0.2 Implementation Plan phase 6;
 * FeatureSpec02 5.3, 11).
 *
 * Every authored reference fit (`content/balance/reference-fits.json`) is set
 * against every site of the twelve-site ladder with the same fixed seeds and a
 * fixed command policy: the fit's own movement, propulsion, repair and web
 * habits, the site's own target priority, and one retreat rule shared by all.
 * Each seed is a fresh campaign that buys the complete, supplied fit at the
 * station - loaded magazines and reserve rounds included - and flies one
 * sortie through the protocol alone. No fit is ever compared empty or with
 * its defences switched off.
 *
 * A cell records what the fight cost and paid as well as how it ended: win,
 * retreat or loss, fight time, damage taken by layer, capacitor starvation,
 * rounds and their price, the repair bill, the loot's sale value and the net
 * credits. A loss counts the whole package, less the insurance paid, against
 * the sortie.
 *
 * The comparisons the release rests on are declared in
 * `tests/fixtures/balance/matrix.json` before they are measured: which fit is
 * expected to be preferable at which site, by which metric, and why.
 */

export type ClaimMetric = 'outcome' | 'medianFightSeconds' | 'repairBurden' | 'runningCost';

export type ClaimKind = 'preference' | 'hullStep' | 'smallTarget' | 'operatingCost';

/**
 * A declared comparison at one site: `better` must beat `worse` by `metric`
 * (FeatureSpec02 11: a consistent outcome improvement, or a reduction of at
 * least 30% in median completion time or repair burden over the fixed seeds).
 */
export interface MatrixClaim {
  readonly id: string;
  readonly kind: ClaimKind;
  readonly encounterId: string;
  readonly better: string;
  readonly worse: string;
  readonly metric: ClaimMetric;
  readonly reason: string;
}

/** Two claims on the same hull that prefer opposite fits at different sites. */
export interface MatrixReversal {
  readonly hullId: string;
  readonly fits: readonly [string, string];
  readonly claims: readonly [string, string];
}

export type MatrixPolicy = Omit<PilotTactics, 'targetPriority' | 'retreatBelowHullFraction'>;

export interface MatrixFixture {
  readonly seeds: readonly string[];
  /** The retreat rule every policy shares: leave once the hull falls below this share. */
  readonly retreatBelowHullFraction: number;
  /** The command policy each reference fit is flown with, at every site. */
  readonly policies: Readonly<Record<string, MatrixPolicy>>;
  /** Each site's target priority, the same for every fit. */
  readonly sites: Readonly<Record<string, { readonly targetPriority: readonly string[] }>>;
  readonly claims: readonly MatrixClaim[];
  readonly reversals: readonly MatrixReversal[];
}

export const MATRIX: MatrixFixture = matrixFile as unknown as MatrixFixture;

/** A competent improvement: this much shorter or cheaper (FeatureSpec02 11). */
export const MATERIAL_REDUCTION = 0.3;
/** A consistent outcome improvement: the better fit clears at least this share... */
export const CONSISTENT_COMPLETION = 0.9;
/** ...and at least this much more often than the worse one. */
export const OUTCOME_MARGIN = 0.3;

export function matrixFits(): string[] {
  return Object.keys(MATRIX.policies);
}

export function matrixTactics(fitId: string, encounterId: string): PilotTactics {
  const policy = MATRIX.policies[fitId];
  const site = MATRIX.sites[encounterId];
  if (policy === undefined) throw new Error(`No matrix policy for "${fitId}".`);
  if (site === undefined) throw new Error(`No matrix site "${encounterId}".`);
  return { ...policy, targetPriority: site.targetPriority, retreatBelowHullFraction: MATRIX.retreatBelowHullFraction };
}

/** The fit at the site as a scenario a career can fly: `<fitId>@<encounterId>`. */
export function matrixScenario(fitId: string, encounterId: string, seeds: readonly string[] = MATRIX.seeds): FixtureScenario {
  return {
    id: `${fitId}@${encounterId}`,
    description: `${fitId} at ${encounterId}, flown with the matrix policy.`,
    encounterId,
    fitId,
    tactics: matrixTactics(fitId, encounterId),
    expect: 'completed',
    band: { completedShare: [0, 1] },
    seeds,
    sorties: 1,
  };
}

/* -------------------------------------------------------------------------- */
/* Measuring a cell                                                            */
/* -------------------------------------------------------------------------- */

export interface CellOutcome {
  readonly seed: string;
  readonly status: SortieRecord['status'];
  readonly fightSeconds: number;
  readonly damageTaken: Readonly<Record<'shield' | 'armor' | 'hull', number>>;
  readonly capacitorStarvedSeconds: number;
  readonly lowestCapacitorShare: number;
  readonly roundsFired: number;
  readonly bountyCredits: number;
  readonly lootCredits: number;
  readonly repairCredits: number;
  readonly ammunitionCredits: number;
  /** Insurance paid after a loss. */
  readonly insuranceCredits: number;
  readonly netCredits: number;
}

export interface CellSummary {
  readonly fitId: string;
  readonly hullId: string;
  readonly encounterId: string;
  /** What the complete, supplied package costs at the station from a new campaign. */
  readonly packageCredits: number;
  readonly seeds: number;
  readonly completed: number;
  readonly retreated: number;
  readonly lost: number;
  readonly timedOut: number;
  readonly completedShare: number;
  readonly medianFightSeconds: number | null;
  /** Median repair bill over completed sorties. */
  readonly repairBurden: number | null;
  /** Median repair bill plus rounds over completed sorties. */
  readonly runningCost: number | null;
  readonly meanDamageTaken: Readonly<Record<'shield' | 'armor' | 'hull', number>>;
  readonly starvedSorties: number;
  readonly meanCapacitorStarvedSeconds: number;
  readonly meanRoundsFired: number;
  readonly meanNetCredits: number;
  readonly outcomes: readonly CellOutcome[];
}

export async function measureCell(
  fitId: string,
  encounterId: string,
  content: ContentRepository,
  seeds: readonly string[] = MATRIX.seeds,
): Promise<CellSummary> {
  const fit = referenceFixtureFit(fitId, content);
  const scenario = matrixScenario(fitId, encounterId, seeds);
  const outcomes: CellOutcome[] = [];
  let packageCredits = 0;
  for (const seed of seeds) {
    const assembled = assembleFit(fit, seed, content);
    packageCredits = assembled.costCredits;
    const session = await openSession(assembled.state, content);
    const ammunition = ammunitionOf(fit);
    const before = await countHeld(session, ammunition);
    const creditsBefore = await credits(session);
    const record = await flySortie(session, scenario, content, seed, 1, { loot: true });
    outcomes.push(await costOutcome(session, record, ammunition, before, creditsBefore, packageCredits));
  }

  const completed = outcomes.filter((outcome) => outcome.status === 'completed');
  const count = (status: SortieRecord['status']): number => outcomes.filter((outcome) => outcome.status === status).length;
  const mean = (pick: (outcome: CellOutcome) => number): number =>
    outcomes.length === 0 ? 0 : outcomes.reduce((total, outcome) => total + pick(outcome), 0) / outcomes.length;
  return {
    fitId,
    hullId: fit.hullId ?? content.rules.economy.starterHullId,
    encounterId,
    packageCredits,
    seeds: seeds.length,
    completed: completed.length,
    retreated: count('retreated'),
    lost: count('lost'),
    timedOut: count('timedOut'),
    completedShare: completed.length / seeds.length,
    medianFightSeconds: median(completed.map((outcome) => outcome.fightSeconds)),
    repairBurden: median(completed.map((outcome) => outcome.repairCredits)),
    runningCost: median(completed.map((outcome) => outcome.repairCredits + outcome.ammunitionCredits)),
    meanDamageTaken: {
      shield: round(mean((outcome) => outcome.damageTaken.shield)),
      armor: round(mean((outcome) => outcome.damageTaken.armor)),
      hull: round(mean((outcome) => outcome.damageTaken.hull)),
    },
    starvedSorties: outcomes.filter((outcome) => outcome.capacitorStarvedSeconds > 0).length,
    meanCapacitorStarvedSeconds: round(mean((outcome) => outcome.capacitorStarvedSeconds)),
    meanRoundsFired: round(mean((outcome) => outcome.roundsFired)),
    meanNetCredits: Math.round(mean((outcome) => outcome.netCredits)),
    outcomes,
  };
}

/**
 * What one sortie cost and paid, priced at the station it returned to. The
 * campaign is not changed: every figure is a preview.
 */
async function costOutcome(
  session: ScenarioSession,
  record: SortieRecord,
  ammunition: readonly string[],
  before: ReadonlyMap<string, number>,
  creditsBefore: number,
  packageCredits: number,
): Promise<CellOutcome> {
  const damageTaken = {
    shield: round(record.opponents.reduce((total, opponent) => total + opponent.damageToPlayer.shield, 0)),
    armor: round(record.opponents.reduce((total, opponent) => total + opponent.damageToPlayer.armor, 0)),
    hull: round(record.opponents.reduce((total, opponent) => total + opponent.damageToPlayer.hull, 0)),
  };
  const shared = {
    seed: record.seed,
    status: record.status,
    fightSeconds: round(record.fightSeconds),
    damageTaken,
    capacitorStarvedSeconds: record.capacitorStarvedSeconds,
    lowestCapacitorShare: round(record.lowestCapacitorShare, 3),
    roundsFired: record.roundsFired,
    bountyCredits: record.bountyCredits,
  };
  if (record.status === 'lost') {
    const insuranceCredits = (await credits(session)) - creditsBefore - record.bountyCredits;
    return {
      ...shared,
      lootCredits: 0,
      repairCredits: 0,
      ammunitionCredits: 0,
      insuranceCredits,
      netCredits: record.bountyCredits + insuranceCredits - packageCredits,
    };
  }

  const assets = await session.data<AssetsData>('assets.list');
  const shipId = assets.activeShipId ?? '';
  const repair = await session.data<RepairPreviewData>('repair.preview', { shipId });
  const repairCredits = repair.available ? repair.totalCredits : 0;

  // Rounds spent: what the ship held before, plus what it looted, less what it holds now.
  const after = await countHeld(session, ammunition);
  let ammunitionCredits = 0;
  for (const definitionId of ammunition) {
    const spent = (before.get(definitionId) ?? 0) + (record.loot[definitionId] ?? 0) - (after.get(definitionId) ?? 0);
    if (spent > 0) ammunitionCredits += await buyPrice(session, definitionId, spent);
  }

  // Loot is valued at what the station pays for it; looted rounds the fit
  // fires are counted above instead, as rounds not bought back.
  let lootCredits = 0;
  for (const [definitionId, quantity] of Object.entries(record.loot)) {
    if (ammunition.includes(definitionId)) continue;
    lootCredits += await sellPrice(session, assets, definitionId, quantity);
  }

  return {
    ...shared,
    lootCredits,
    repairCredits,
    ammunitionCredits,
    insuranceCredits: 0,
    netCredits: record.bountyCredits + lootCredits - repairCredits - ammunitionCredits,
  };
}

function ammunitionOf(fit: ReturnType<typeof referenceFixtureFit>): string[] {
  return [...new Set([
    ...fit.modules.flatMap((entry) => entry.ammunitionId === undefined ? [] : [entry.ammunitionId]),
    ...fit.cargo.map((entry) => entry.definitionId),
  ])].sort();
}

/** Units of each definition in the active ship's hold and magazines. */
async function countHeld(session: ScenarioSession, definitions: readonly string[]): Promise<Map<string, number>> {
  const assets = await session.data<AssetsData>('assets.list');
  const shipId = assets.activeShipId;
  const held = new Map<string, number>();
  for (const stack of shipStacks(assets, shipId)) {
    if (!definitions.includes(stack.item.definitionId)) continue;
    held.set(stack.item.definitionId, (held.get(stack.item.definitionId) ?? 0) + stack.quantity);
  }
  return held;
}

function shipStacks(assets: AssetsData, shipId: string | null): StackData[] {
  return assets.inventories
    .filter((inventory) =>
      (inventory.location.kind === 'cargo' || inventory.location.kind === 'fitting') && inventory.location.shipId === shipId)
    .flatMap((inventory) => inventory.stacks);
}

async function credits(session: ScenarioSession): Promise<number> {
  return (await session.data<AssetsData>('assets.list')).credits;
}

async function buyPrice(session: ScenarioSession, itemId: string, quantity: number): Promise<number> {
  const preview = await session.data<MarketTransactionPreviewData>('market.previewBuy', {
    stationId: (await session.data<AssetsData>('assets.list')).lastDockedStationId, itemId, quantity,
  });
  return Math.abs(preview.totalCredits);
}

async function sellPrice(session: ScenarioSession, assets: AssetsData, definitionId: string, quantity: number): Promise<number> {
  let remaining = quantity;
  let total = 0;
  const local = assets.inventories
    .filter((inventory) => inventory.location.kind === 'cargo' || inventory.location.kind === 'hangar')
    .flatMap((inventory) => inventory.stacks)
    .filter((stack) => stack.item.definitionId === definitionId && stack.state.kind === 'plain');
  for (const stack of local) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, stack.quantity);
    const preview = await session.data<MarketTransactionPreviewData>('market.previewSell', {
      stationId: assets.lastDockedStationId, stackId: stack.id, quantity: take,
    });
    if (preview.available) total += Math.abs(preview.totalCredits);
    remaining -= take;
  }
  return total;
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/* -------------------------------------------------------------------------- */
/* Judging a claim                                                             */
/* -------------------------------------------------------------------------- */

export interface ClaimVerdict {
  readonly claim: MatrixClaim;
  readonly holds: boolean;
  /** The measured figures, better first, in words. */
  readonly evidence: string;
}

export function judgeClaim(claim: MatrixClaim, better: CellSummary, worse: CellSummary): ClaimVerdict {
  const share = (cell: CellSummary): string => `${String(cell.completed)}/${String(cell.seeds)}`;
  if (claim.metric === 'outcome') {
    const holds = better.completedShare >= CONSISTENT_COMPLETION &&
      better.completedShare - worse.completedShare >= OUTCOME_MARGIN - 1e-9;
    return { claim, holds, evidence: `cleared ${share(better)} against ${share(worse)}` };
  }
  const pick = (cell: CellSummary): number | null =>
    claim.metric === 'medianFightSeconds' ? cell.medianFightSeconds :
    claim.metric === 'repairBurden' ? cell.repairBurden :
    cell.runningCost;
  const unit = claim.metric === 'medianFightSeconds' ? ' s' : ' cr';
  const ours = pick(better);
  const theirs = pick(worse);
  // A fit that clears where the other mostly does not is better on time and cost too.
  if (worse.completedShare < CONSISTENT_COMPLETION) {
    const holds = better.completedShare >= CONSISTENT_COMPLETION &&
      better.completedShare - worse.completedShare >= OUTCOME_MARGIN - 1e-9;
    return { claim, holds, evidence: `cleared ${share(better)} against ${share(worse)} (the other fit does not complete reliably)` };
  }
  const holds = better.completedShare >= CONSISTENT_COMPLETION && ours !== null && theirs !== null &&
    (claim.metric === 'runningCost' ? ours < theirs : ours <= (1 - MATERIAL_REDUCTION) * theirs);
  const ratio = ours !== null && theirs !== null && theirs > 0 ? ` (${((1 - ours / theirs) * 100).toFixed(0)}% lower)` : '';
  return {
    claim,
    holds,
    evidence: `${claim.metric} ${String(ours)}${unit} against ${String(theirs)}${unit}${ratio}; cleared ${share(better)} and ${share(worse)}`,
  };
}

/** Bounty a site pays when every opponent dies. */
export function siteBounty(encounterId: string, content: ContentRepository): number {
  return totalBounty(encounterId, content);
}
