import type { ContentRepository } from '@engine';
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
import { fixtureFit, fixtureScenario, type FixtureFit } from '../progression/fixtures.ts';
import { flySortie, restUntilCharged, type SortieRecord } from '../progression/scenario.ts';
import { openSession, type ScenarioSession } from '../progression/session.ts';

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
  | { readonly equip: string }
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
  readonly careers: readonly CareerFixture[];
}

export const CAREERS: CareerFixtures = careerFile as CareerFixtures;

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
  readonly number: number;
  readonly status: SortieRecord['status'];
  readonly fightSeconds: number;
  /** Simulated seconds from choosing the site to docking again, or to recovery after a loss. */
  readonly sortieSeconds: number;
  readonly hitPointsShare: number;
  readonly roundsFired: number;
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

export async function runCareerSeed(
  career: CareerFixture,
  seed: string,
  content: ContentRepository,
): Promise<CareerSeedRun> {
  const start = newCampaign(seed, content);
  const session = await openSession(start, content);
  const pilot = new CareerPilot(session, content, keptDefinitions(career));
  const entries: CareerEntry[] = [];
  let sorties = 0;
  let stalled: string | null = null;

  try {
    for (const [index, step] of career.steps.entries()) {
      if ('equip' in step) {
        const fit = fixtureFit(step.equip);
        const bought = await pilot.equip(fit);
        entries.push({
          kind: 'equip',
          step: index,
          fitId: fit.id,
          afterSorties: sorties,
          simulationSeconds: session.simulationTimeMs / 1_000,
          costCredits: bought.reduce((total, purchase) => total + purchase.credits, 0),
          creditsAfter: await pilot.credits(),
          purchases: bought,
        });
        continue;
      }
      const scenario = fixtureScenario(step.fly);
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

/** Every module and charge a fit in the plan names: loot worth keeping. */
function keptDefinitions(career: CareerFixture): Set<string> {
  const kept = new Set<string>();
  for (const step of career.steps) {
    if (!('equip' in step)) continue;
    const fit = fixtureFit(step.equip);
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
  ) {
    this.stationId = content.rules.economy.startingStationId;
  }

  async credits(): Promise<number> {
    return (await this.session.data<AssetsData>('assets.list')).credits;
  }

  /** Buys what a fit lacks, fits it in one draft and loads it for a sortie. */
  async equip(fit: FixtureFit): Promise<Purchase[]> {
    const bought: Purchase[] = [];
    let assets = await this.session.data<AssetsData>('assets.list');
    if (assets.activeShipId === null) {
      // A pilot who lost their ship and was owed no grant buys a hull first.
      bought.push(await this.buy(this.content.rules.economy.starterHullId, 1));
      assets = await this.session.data<AssetsData>('assets.list');
    }
    const shipId = assets.activeShipId;
    if (shipId === null) throw new Stall('no ship after buying a hull');

    const needed = await this.quote(fit);
    const total = needed.reduce((sum, purchase) => sum + purchase.credits, 0);
    if (total > assets.credits) {
      throw new Stall(`fit "${fit.id}" costs ${String(total)} and the pilot holds ${String(assets.credits)}`);
    }
    for (const purchase of needed) bought.push(await this.buy(purchase.definitionId, purchase.quantity));

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

  /** What a fit still needs from the market, priced now; empty when the pilot owns it all. */
  async quote(fit: FixtureFit): Promise<Purchase[]> {
    const assets = await this.session.data<AssetsData>('assets.list');
    const owned = new Map<string, number>();
    for (const stack of this.localStacks(assets)) {
      owned.set(stack.item.definitionId, (owned.get(stack.item.definitionId) ?? 0) + stack.quantity);
    }
    const needed = new Map<string, number>();
    const add = (definitionId: string, quantity: number): void => {
      needed.set(definitionId, (needed.get(definitionId) ?? 0) + quantity);
    };
    for (const entry of fit.modules) {
      add(entry.moduleId, 1);
      if (entry.ammunitionId !== undefined) {
        const module = this.content.requireModule(entry.moduleId as never);
        if (module.category === 'turret') add(entry.ammunitionId, module.turret.magazineSize);
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
    const needed = await this.quote(fixtureFit(goal.affords));
    return needed.reduce((sum, purchase) => sum + purchase.credits, 0) <= await this.credits();
  }

  /** One sortie, and everything the station does after it. */
  async sortie(step: number, scenarioId: string, seed: string, number: number): Promise<SortieEntry> {
    const scenario = fixtureScenario(scenarioId);
    const fitId = this.fit?.id ?? '';
    const creditsBefore = await this.credits();
    const restedFromMs = this.session.simulationTimeMs;
    const capacitorAtUndock = await restUntilCharged(this.session);
    const restSeconds = (this.session.simulationTimeMs - restedFromMs) / 1_000;
    const startedMs = this.session.simulationTimeMs;
    const record = await flySortie(this.session, scenario, this.content, seed, number, { loot: true });
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
      number,
      status: record.status,
      fightSeconds: record.fightSeconds,
      sortieSeconds,
      hitPointsShare: record.hitPointsShare,
      roundsFired: record.roundsFired,
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

  /** Stacks the pilot can use here: the station hangar and the active ship's hold and fitting. */
  private localStacks(assets: AssetsData): StackData[] {
    const shipId = assets.activeShipId;
    return assets.inventories
      .filter((inventory) =>
        (inventory.location.kind === 'hangar' && inventory.location.stationId === this.stationId) ||
        ((inventory.location.kind === 'cargo' || inventory.location.kind === 'fitting') && inventory.location.shipId === shipId))
      .flatMap((inventory) => inventory.stacks)
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
