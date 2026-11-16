import type { CampaignState, ContentRepository } from '@engine';
import type {
  AssetsData,
  InventoryData,
  MarketTransactionPreviewData,
  RepairPreviewData,
  ResupplyPreviewData,
  StackData,
} from '@protocol';

import careerFile from '../../fixtures/balance/careers.json';
import { newCampaign } from '../loss.ts';
import { fixtureScenario, PROGRESSION, type FixtureFit, type FixtureScenario } from '../progression/fixtures.ts';
import { LADDER, ladderFit } from '../progression/ladder.ts';
import { flySortie, restUntilCharged, type SortieRecord } from '../progression/scenario.ts';
import { openSession, type ScenarioSession } from '../progression/session.ts';

import { matrixScenario } from './matrix.ts';

/**
 * Careers: whole campaigns flown from their first day
 * (MVP Implementation Plan phase 17; MVP Scope 4.3; Technical Specification 16).
 *
 * A progression scenario proves that a fit can clear a site. A career proves
 * that the loop gets the pilot to that fit: it starts from a new campaign with
 * the starting wallet and nothing else, and follows a plan a player could
 * follow - buy this, fly that site until the next purchase is affordable, buy
 * it, move on. Between sorties the pilot does what the station offers: sells
 * the loot the plan has no use for, repairs, refills the magazines and buys
 * back the reserve rounds the fit carries. Loot the plan can use - a module a
 * later fit names, or its ammunition - is kept and saves that purchase.
 *
 * Nothing is set directly. Every credit comes from bounties, sales and
 * insurance, and every item from the market or a wreck, so a career that
 * reaches the mastery site shows that the loop, not a test, paid for it. A
 * career that loses its ship continues from wherever the recovery rules leave
 * the pilot (Functional Specification 9.12).
 *
 * Each step that flies has a sortie budget. A career that needs more sorties
 * than its budget allows stalls there, and that stall is the finding: the
 * budget is the band a MVP Scope 4.3 objective is held to.
 */

export type CareerGoal =
  | { readonly completions: number }
  | { readonly affords: string }
  | { readonly losses: number };

export type CareerStep =
  | {
      /**
       * A fit to put on the ship of its hull: a progression fixture fit, or an
       * authored reference fit (`fit.*`). A fit for another hull switches to a
       * locally stored ship of that hull, or buys one (FeatureSpec02 4.2).
       */
      readonly equip: string;
      /**
       * Take modules the fit needs off the pilot's other ships at the station
       * before buying them, as a player moving equipment to a new hull does.
       */
      readonly reuse?: boolean;
    }
  | {
      /** A progression scenario: the encounter and the tactics to fly it with. */
      readonly fly: string;
      readonly until: CareerGoal;
      /** The band: the goal must be met within this many sorties. */
      readonly maxSorties: number;
    };

export interface CareerFixture {
  readonly id: string;
  readonly description: string;
  /** The MVP Scope 4.3 objectives this career demonstrates. */
  readonly objectives: readonly string[];
  readonly seeds: readonly string[];
  /**
   * Leave module drops in the wrecks: the conservative no-module-drop income
   * of FeatureSpec02 9, so no purchase in the plan rests on a lucky drop.
   */
  readonly ignoreModuleDrops?: boolean;
  readonly steps: readonly CareerStep[];
}

export interface StartingWalletFixture {
  readonly description: string;
  /** Fits the starting credits buy from a new campaign, each on its own. */
  readonly affordable: readonly string[];
  /** Fits the starting credits do not reach. */
  readonly unaffordable: readonly string[];
}

export interface CareerFixtures {
  readonly startingWallet: StartingWalletFixture;
  /**
   * Scenarios only careers fly: a fit flown at a site a particular way, such
   * as a mistake a career must recover from.
   */
  readonly scenarios?: readonly FixtureScenario[];
  /** Fits only careers equip, such as a poor purchase; legal and bought like any other. */
  readonly fits?: readonly FixtureFit[];
  readonly careers: readonly CareerFixture[];
}

export const CAREERS: CareerFixtures = careerFile as unknown as CareerFixtures;

export function careerFixture(id: string): CareerFixture {
  const career = CAREERS.careers.find((candidate) => candidate.id === id);
  if (career === undefined) throw new Error(`No career "${id}".`);
  return career;
}

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

export interface EquipEntry {
  readonly kind: 'equip';
  readonly step: number;
  readonly fitId: string;
  readonly hullId: string;
  /** Sorties flown before this purchase. */
  readonly afterSorties: number;
  readonly simulationSeconds: number;
  readonly costCredits: number;
  readonly creditsAfter: number;
  readonly purchases: readonly { readonly definitionId: string; readonly quantity: number; readonly credits: number }[];
}

export interface SortieEntry {
  readonly kind: 'sortie';
  readonly step: number;
  readonly scenarioId: string;
  readonly fitId: string;
  readonly hullId: string;
  readonly encounterId: string;
  readonly number: number;
  readonly status: SortieRecord['status'];
  readonly fightSeconds: number;
  /** Simulated seconds from choosing the site to docking again, or to recovery after a loss. */
  readonly sortieSeconds: number;
  readonly hitPointsShare: number;
  readonly roundsFired: number;
  readonly capacitorStarvedSeconds: number;
  /** Share of the capacitor charged when the ship undocked. */
  readonly capacitorAtUndock: number;
  /** Simulated seconds the pilot waited docked for the capacitor to recharge before undocking. */
  readonly restSeconds: number;
  readonly creditsBefore: number;
  readonly bountyCredits: number;
  /** Insurance paid when the ship was lost. */
  readonly insuranceCredits: number;
  readonly lootSaleCredits: number;
  /** Loot kept because a fit in the plan uses it. */
  readonly lootKept: Readonly<Record<string, number>>;
  readonly repairCredits: number;
  /** Magazines and reserve rounds bought back. */
  readonly resupplyCredits: number;
  readonly creditsAfter: number;
  /** Whether the pilot came home with a recovery-grant ship (Functional Specification 9.12). */
  readonly recoveryGrant: boolean;
}

export type CareerEntry = EquipEntry | SortieEntry;

export interface CareerSeedRun {
  readonly careerId: string;
  readonly seed: string;
  readonly finished: boolean;
  /** Why the plan could not go on, or `null` when it finished. */
  readonly stalled: string | null;
  readonly entries: readonly CareerEntry[];
  readonly sorties: number;
  readonly simulationSeconds: number;
  readonly startingCredits: number;
  readonly finalCredits: number;
}

/* -------------------------------------------------------------------------- */
/* Running                                                                     */
/* -------------------------------------------------------------------------- */

export async function runCareer(career: CareerFixture, content: ContentRepository): Promise<CareerSeedRun[]> {
  const runs: CareerSeedRun[] = [];
  for (const seed of career.seeds) runs.push(await runCareerSeed(career, seed, content));
  return runs;
}

class Stall extends Error {}

export interface CareerOptions {
  /**
   * Opens the campaign the career flies. The default writes the starting state
   * as a snapshot and resumes it; a recording opens it its own way so the
   * whole career becomes a replayable log.
   */
  readonly open?: (start: CampaignState, content: ContentRepository) => Promise<ScenarioSession>;
}

export async function runCareerSeed(
  career: CareerFixture,
  seed: string,
  content: ContentRepository,
  options: CareerOptions = {},
): Promise<CareerSeedRun> {
  const start = newCampaign(seed, content);
  const session = await (options.open ?? openSession)(start, content);
  const pilot = new CareerPilot(session, content, keptDefinitions(career, content), career.ignoreModuleDrops !== true);
  const entries: CareerEntry[] = [];
  let sorties = 0;
  let stalled: string | null = null;

  try {
    for (const [index, step] of career.steps.entries()) {
      if ('equip' in step) {
        const fit = careerFit(step.equip, content);
        const bought = await pilot.equip(fit, step.reuse === true);
        entries.push({
          kind: 'equip',
          step: index,
          fitId: fit.id,
          hullId: hullOf(fit, content),
          afterSorties: sorties,
          simulationSeconds: session.simulationTimeMs / 1_000,
          costCredits: bought.reduce((total, purchase) => total + purchase.credits, 0),
          creditsAfter: await pilot.credits(),
          purchases: bought,
        });
        continue;
      }
      const scenario = careerScenario(step.fly);
      if (pilot.fit?.id !== scenario.fitId) {
        throw new Error(`Career "${career.id}" flies ${scenario.id} with fit "${String(pilot.fit?.id)}", not "${scenario.fitId}".`);
      }
      let completions = 0;
      let losses = 0;
      for (let flown = 0; !(await pilot.reached(step.until, completions, losses)); flown += 1) {
        if (flown >= step.maxSorties) {
          throw new Stall(`step ${String(index)} (${scenario.id}) did not reach ${JSON.stringify(step.until)} within ${String(step.maxSorties)} sorties`);
        }
        sorties += 1;
        const entry = await pilot.sortie(index, scenario.id, seed, sorties);
        entries.push(entry);
        if (entry.status === 'completed') completions += 1;
        if (entry.status === 'lost') losses += 1;
        // A step that sets out to lose may end any way; any other step is
        // meant to win, so a loss or an unfinished fight stalls the plan.
        if (entry.status !== 'completed' && !('losses' in step.until)) {
          throw new Stall(`sortie ${String(sorties)} (${scenario.id}) ended ${entry.status}`);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Stall)) throw error;
    stalled = error.message;
  }

  return {
    careerId: career.id,
    seed,
    finished: stalled === null,
    stalled,
    entries,
    sorties,
    simulationSeconds: session.simulationTimeMs / 1_000,
    startingCredits: start.assets.credits,
    finalCredits: await pilot.credits(),
  };
}

/** A fit a career can equip: a progression fixture fit, or an authored reference fit. */
export function careerFit(id: string, content: ContentRepository): FixtureFit {
  return CAREERS.fits?.find((candidate) => candidate.id === id) ?? ladderFit(id, content);
}

/**
 * A scenario a career can fly: a progression or ladder scenario by id, or a
 * reference fit at a site with the matrix policy, written `<fitId>@<encounterId>`.
 */
export function careerScenario(id: string): FixtureScenario {
  const at = id.indexOf('@');
  if (at > 0) return matrixScenario(id.slice(0, at), id.slice(at + 1));
  return PROGRESSION.scenarios.find((candidate) => candidate.id === id) ??
    LADDER.scenarios.find((candidate) => candidate.id === id) ??
    LADDER.weakFits.find((candidate) => candidate.id === id) ??
    CAREERS.scenarios?.find((candidate) => candidate.id === id) ??
    fixtureScenario(id);
}

function hullOf(fit: FixtureFit, content: ContentRepository): string {
  return fit.hullId ?? content.rules.economy.starterHullId;
}

/** Every module and charge a fit in the plan names: loot worth keeping. */
function keptDefinitions(career: CareerFixture, content: ContentRepository): Set<string> {
  const kept = new Set<string>();
  for (const step of career.steps) {
    if (!('equip' in step)) continue;
    const fit = careerFit(step.equip, content);
    for (const entry of fit.modules) {
      kept.add(entry.moduleId);
      if (entry.ammunitionId !== undefined) kept.add(entry.ammunitionId);
    }
    for (const entry of fit.cargo) kept.add(entry.definitionId);
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/* The pilot at the station                                                    */
/* -------------------------------------------------------------------------- */

interface Purchase {
  readonly definitionId: string;
  readonly quantity: number;
  readonly credits: number;
}

/**
 * The station half of a career: buying, fitting, selling and restocking,
 * through the same queries and commands the station screens use.
 */
class CareerPilot {
  fit: FixtureFit | null = null;
  private readonly stationId: string;

  constructor(
    private readonly session: ScenarioSession,
    private readonly content: ContentRepository,
    private readonly kept: ReadonlySet<string>,
    private readonly lootModules: boolean,
  ) {
    this.stationId = content.rules.economy.startingStationId;
  }

  async credits(): Promise<number> {
    return (await this.session.data<AssetsData>('assets.list')).credits;
  }

  /**
   * Buys what a fit lacks, fits it in one draft and loads it for a sortie. A
   * fit for another hull flies a stored ship of that hull, or a new one bought
   * here - a shipless pilot's purchase becomes active by itself; with `reuse`,
   * modules it needs come off the pilot's other ships first (FeatureSpec02 4.2).
   */
  async equip(fit: FixtureFit, reuse = false): Promise<Purchase[]> {
    const bought: Purchase[] = [];
    const hullId = hullOf(fit, this.content);
    let assets = await this.session.data<AssetsData>('assets.list');

    const needed = await this.quote(fit, reuse);
    const total = needed.reduce((sum, purchase) => sum + purchase.credits, 0);
    if (total > assets.credits) {
      throw new Stall(`fit "${fit.id}" costs ${String(total)} and the pilot holds ${String(assets.credits)}`);
    }

    if (this.activeHull(assets) !== hullId) {
      const stored = this.localShips(assets).find((ship) => ship.hullId === hullId);
      let shipId = stored?.id;
      if (shipId === undefined) {
        const before = new Set(assets.ships.map((ship) => ship.id));
        bought.push(await this.buy(hullId, 1));
        assets = await this.session.data<AssetsData>('assets.list');
        shipId = assets.ships.find((ship) => !before.has(ship.id))?.id;
        if (shipId === undefined) throw new Stall(`buying ${hullId} delivered no ship`);
      }
      if (assets.activeShipId !== shipId) await this.session.data('ship.activate', { shipId });
      assets = await this.session.data<AssetsData>('assets.list');
    }
    const shipId = assets.activeShipId;
    if (shipId === null) throw new Stall('no ship after buying a hull');

    if (reuse) await this.strip(fit, shipId);
    for (const purchase of needed) {
      if (purchase.definitionId === hullId) continue;
      bought.push(await this.buy(purchase.definitionId, purchase.quantity));
    }

    await this.session.data('fitting.begin', { shipId });
    const ship = assets.ships.find((entry) => entry.id === shipId);
    const hull = this.content.requireHull((ship?.hullId ?? this.content.rules.economy.starterHullId) as never);
    for (const [slotKind, count] of Object.entries(hull.slots)) {
      for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
        const wanted = fit.modules.find((entry) => entry.slot === slotKind && entry.index === slotIndex);
        await this.session.data(wanted === undefined ? 'fitting.clear' : 'fitting.set', wanted === undefined
          ? { slotKind, slotIndex }
          : {
              slotKind,
              slotIndex,
              moduleId: wanted.moduleId,
              online: true,
              ...(wanted.ammunitionId === undefined ? {} : { ammunitionId: wanted.ammunitionId }),
            });
      }
    }
    await this.session.data('fitting.commit');
    this.fit = fit;
    await this.restock();
    return bought;
  }

  /**
   * What a fit still needs from the market, priced now, the hull included when
   * the pilot has no ship of that hull here; empty when the pilot owns it all.
   */
  async quote(fit: FixtureFit, reuse = false): Promise<Purchase[]> {
    const assets = await this.session.data<AssetsData>('assets.list');
    const hullId = hullOf(fit, this.content);
    const target = this.activeHull(assets) === hullId
      ? assets.activeShipId
      : this.localShips(assets).find((ship) => ship.hullId === hullId)?.id ?? null;
    const owned = new Map<string, number>();
    const count = (stack: StackData): void => {
      owned.set(stack.item.definitionId, (owned.get(stack.item.definitionId) ?? 0) + stack.quantity);
    };
    for (const stack of this.localStacks(assets, target)) count(stack);
    if (reuse) {
      for (const stack of this.storedFittedStacks(assets, target)) count(stack);
    }
    const needed = new Map<string, number>();
    const add = (definitionId: string, quantity: number): void => {
      needed.set(definitionId, (needed.get(definitionId) ?? 0) + quantity);
    };
    if (target === null) add(hullId, 1);
    for (const entry of fit.modules) {
      add(entry.moduleId, 1);
      if (entry.ammunitionId !== undefined) {
        const module = this.content.requireModule(entry.moduleId as never);
        if (module.category === 'turret') add(entry.ammunitionId, module.turret.magazineSize);
        if (module.category === 'launcher') add(entry.ammunitionId, module.launcher.magazineSize);
      }
    }
    for (const entry of fit.cargo) add(entry.definitionId, entry.quantity);

    const purchases: Purchase[] = [];
    for (const [definitionId, quantity] of [...needed.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const missing = quantity - (owned.get(definitionId) ?? 0);
      if (missing <= 0) continue;
      const preview = await this.session.data<MarketTransactionPreviewData>('market.previewBuy', {
        stationId: this.stationId, itemId: definitionId, quantity: missing,
      });
      if (preview.unavailableReason !== null && preview.unavailableReason !== 'market.unavailable.insufficientCredits') {
        throw new Stall(`the market will not sell ${String(missing)} ${definitionId}: ${preview.unavailableReason}`);
      }
      purchases.push({ definitionId, quantity: missing, credits: preview.totalCredits });
    }
    return purchases;
  }

  async reached(goal: CareerGoal, completions: number, losses: number): Promise<boolean> {
    if ('completions' in goal) return completions >= goal.completions;
    if ('losses' in goal) return losses >= goal.losses;
    const needed = await this.quote(careerFit(goal.affords, this.content), true);
    return needed.reduce((sum, purchase) => sum + purchase.credits, 0) <= await this.credits();
  }

  /** One sortie, and everything the station does after it. */
  async sortie(step: number, scenarioId: string, seed: string, number: number): Promise<SortieEntry> {
    const scenario = careerScenario(scenarioId);
    const fitId = this.fit?.id ?? '';
    const hullId = this.fit === null ? '' : hullOf(this.fit, this.content);
    const creditsBefore = await this.credits();
    const restedFromMs = this.session.simulationTimeMs;
    const capacitorAtUndock = await restUntilCharged(this.session);
    const restSeconds = (this.session.simulationTimeMs - restedFromMs) / 1_000;
    const startedMs = this.session.simulationTimeMs;
    const record = await flySortie(this.session, scenario, this.content, seed, number, {
      loot: true,
      lootModules: this.lootModules,
    });
    const sortieSeconds = (this.session.simulationTimeMs - startedMs) / 1_000;
    const afterFlight = await this.credits();
    const assets = await this.session.data<AssetsData>('assets.list');
    const recoveryGrant = assets.ships.some((ship) => ship.id === assets.activeShipId && ship.recoveryGrant);

    let lootSaleCredits = 0;
    let lootKept: Record<string, number> = {};
    let repairCredits = 0;
    let resupplyCredits = 0;
    if (record.status !== 'lost') {
      ({ sold: lootSaleCredits, kept: lootKept } = await this.sellLoot(record.loot));
      repairCredits = await this.repair();
      resupplyCredits = await this.restock();
    }

    return {
      kind: 'sortie',
      step,
      scenarioId,
      fitId,
      hullId,
      encounterId: scenario.encounterId,
      number,
      status: record.status,
      fightSeconds: record.fightSeconds,
      sortieSeconds,
      hitPointsShare: record.hitPointsShare,
      roundsFired: record.roundsFired,
      capacitorStarvedSeconds: record.capacitorStarvedSeconds,
      capacitorAtUndock,
      restSeconds,
      creditsBefore,
      bountyCredits: record.bountyCredits,
      insuranceCredits: record.status === 'lost' ? afterFlight - creditsBefore - record.bountyCredits : 0,
      lootSaleCredits,
      lootKept,
      repairCredits,
      resupplyCredits,
      creditsAfter: await this.credits(),
      recoveryGrant,
    };
  }

  /**
   * Sells every stack at the station the plan has no use for. Recovery-grant
   * units cannot be sold and stay (Functional Specification 9.12).
   */
  private async sellLoot(looted: Readonly<Record<string, number>>): Promise<{ sold: number; kept: Record<string, number> }> {
    let sold = 0;
    const assets = await this.session.data<AssetsData>('assets.list');
    for (const stack of this.localStacks(assets)) {
      if (stack.state.kind !== 'plain' || stack.recoveryGrant || this.kept.has(stack.item.definitionId)) continue;
      const preview = await this.session.data<MarketTransactionPreviewData>('market.previewSell', {
        stationId: this.stationId, stackId: stack.id, quantity: stack.quantity,
      });
      if (!preview.available || preview.token === null) continue;
      await this.session.data('market.confirmSell', { token: preview.token });
      sold += preview.totalCredits;
    }
    const kept = Object.fromEntries(Object.entries(looted).filter(([definitionId]) => this.kept.has(definitionId)));
    return { sold, kept };
  }

  private async repair(): Promise<number> {
    const shipId = (await this.session.data<AssetsData>('assets.list')).activeShipId;
    if (shipId === null) return 0;
    const preview = await this.session.data<RepairPreviewData>('repair.preview', { shipId });
    if (!preview.available || preview.token === null) return 0;
    await this.session.data('repair.confirm', { token: preview.token });
    return preview.totalCredits;
  }

  /**
   * Fills every magazine, then carries the fit's reserve rounds: first what the
   * hangar already holds, then what the market sells. Returns what it spent.
   */
  private async restock(): Promise<number> {
    const fit = this.fit;
    const assets = await this.session.data<AssetsData>('assets.list');
    const ship = assets.ships.find((entry) => entry.id === assets.activeShipId);
    if (fit === null || ship === undefined) return 0;
    let spent = 0;

    const resupply = await this.session.data<ResupplyPreviewData>('resupply.preview', { shipId: ship.id });
    if (resupply.available && resupply.token !== null) {
      await this.session.data('resupply.confirm', { token: resupply.token });
      spent += resupply.totalCredits;
    }

    for (const entry of fit.cargo) {
      const hold = await this.session.data<InventoryData>('inventory.cargo', { shipId: ship.id });
      let missing = entry.quantity - hold.stacks
        .filter((stack) => stack.item.definitionId === entry.definitionId)
        .reduce((total, stack) => total + stack.quantity, 0);
      if (missing <= 0) continue;
      const hangar = await this.session.data<InventoryData>('inventory.hangar', { stationId: this.stationId });
      for (const stack of hangar.stacks) {
        if (missing <= 0) break;
        if (stack.item.definitionId !== entry.definitionId || stack.state.kind !== 'plain') continue;
        const quantity = Math.min(missing, stack.quantity);
        await this.session.data('inventory.transfer', {
          stackId: stack.id, destinationInventoryId: ship.cargoInventoryId, quantity,
        });
        missing -= quantity;
      }
      if (missing <= 0) continue;
      const preview = await this.session.data<MarketTransactionPreviewData>('market.previewBuy', {
        stationId: this.stationId, itemId: entry.definitionId, quantity: missing, destinationInventoryId: ship.cargoInventoryId,
      });
      if (preview.available && preview.token !== null) {
        await this.session.data('market.confirmBuy', { token: preview.token });
        spent += preview.totalCredits;
      }
    }
    return spent;
  }

  private async buy(definitionId: string, quantity: number): Promise<Purchase> {
    const preview = await this.session.data<MarketTransactionPreviewData>('market.previewBuy', {
      stationId: this.stationId, itemId: definitionId, quantity,
    });
    if (!preview.available || preview.token === null) {
      throw new Stall(`cannot buy ${String(quantity)} ${definitionId}: ${String(preview.unavailableReason)}`);
    }
    await this.session.data('market.confirmBuy', { token: preview.token });
    return { definitionId, quantity, credits: preview.totalCredits };
  }

  private activeHull(assets: AssetsData): string | null {
    return assets.ships.find((ship) => ship.id === assets.activeShipId)?.hullId ?? null;
  }

  /** The pilot's ships docked at this station. */
  private localShips(assets: AssetsData): AssetsData['ships'][number][] {
    return assets.ships
      .filter((ship) => ship.owner === 'player' && ship.location.kind === 'station' && ship.location.stationId === this.stationId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** Modules fitted to the pilot's other local ships, which `reuse` may take. */
  private storedFittedStacks(assets: AssetsData, except: string | null): StackData[] {
    const others = new Set(this.localShips(assets)
      .filter((ship) => ship.id !== except && !ship.recoveryGrant)
      .map((ship) => ship.id));
    return assets.inventories
      .filter((inventory) => inventory.location.kind === 'fitting' && others.has(inventory.location.shipId))
      .flatMap((inventory) => inventory.stacks)
      .filter((stack) => stack.state.kind === 'fitted' && !stack.recoveryGrant);
  }

  /**
   * Takes off the other local ships the modules the fit needs beyond what the
   * hangar and the target ship hold, one draft per ship; they land in the
   * hangar, where the new fit's draft finds them.
   */
  private async strip(fit: FixtureFit, shipId: string): Promise<void> {
    const assets = await this.session.data<AssetsData>('assets.list');
    const have = new Map<string, number>();
    for (const stack of this.localStacks(assets, shipId)) {
      have.set(stack.item.definitionId, (have.get(stack.item.definitionId) ?? 0) + stack.quantity);
    }
    const short = new Map<string, number>();
    for (const entry of fit.modules) short.set(entry.moduleId, (short.get(entry.moduleId) ?? 0) + 1);
    for (const [definitionId, quantity] of short) short.set(definitionId, quantity - (have.get(definitionId) ?? 0));

    const bySource = new Map<string, { slotKind: string; slotIndex: number }[]>();
    for (const stack of this.storedFittedStacks(assets, shipId)) {
      const missing = short.get(stack.item.definitionId) ?? 0;
      if (missing <= 0 || stack.state.kind !== 'fitted') continue;
      short.set(stack.item.definitionId, missing - 1);
      const owner = assets.inventories.find((inventory) => inventory.id === stack.inventoryId)?.location;
      if (owner?.kind !== 'fitting') continue;
      const slots = bySource.get(owner.shipId) ?? [];
      slots.push({ slotKind: stack.state.slot.kind, slotIndex: stack.state.slot.index });
      bySource.set(owner.shipId, slots);
    }
    for (const [sourceId, slots] of bySource) {
      await this.session.data('fitting.begin', { shipId: sourceId });
      for (const slot of slots) await this.session.data('fitting.clear', slot);
      await this.session.data('fitting.commit');
    }
  }

  /** Stacks the pilot can use here: the station hangar and a ship's hold and fitting, the active ship's by default. */
  private localStacks(assets: AssetsData, shipId: string | null = assets.activeShipId): StackData[] {
    return assets.inventories
      .filter((inventory) =>
        (inventory.location.kind === 'hangar' && inventory.location.stationId === this.stationId) ||
        ((inventory.location.kind === 'cargo' || inventory.location.kind === 'fitting') && inventory.location.shipId === shipId))
      .flatMap((inventory) => inventory.stacks)
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
