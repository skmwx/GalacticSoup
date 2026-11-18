import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import {
  campaignStateHash,
  captureSnapshot,
  createSaveService,
  ENGINE_VERSION,
  loadSave,
  validateCampaign,
  type CampaignState,
} from '@engine';
import { runCommand } from '@engine/application';
import { shipFit } from '@engine/domain';
import { PROTOCOL_VERSION, type CommandType } from '@protocol';
import { canonicalJson } from '@shared';

import { shippedContent } from '../support/content.ts';
import { command, inSite, stateOf } from '../support/loss.ts';
import { assembleFit } from '../support/progression/assemble.ts';
import type { FixtureFit } from '../support/progression/fixtures.ts';
import { referenceFixtureFit } from '../support/progression/ladder.ts';

/**
 * Current-v0.2 persistence across the whole combat state
 * (v0.2 Implementation Plan phase 7, work item 1; FeatureSpec02 10;
 * Technical Specification 9.5, 11.4).
 *
 * The phase 3 and phase 4 suites reopen one projectile and one web effect in
 * a two-ship fixture. This suite reopens the authored ladder fights the
 * release ships, with the reference fits and a mixed turret-and-launcher fit,
 * while both sides use everything they carry: volleys in flight on both
 * sides, speed effects from player and opponent webs, reserved rounds in
 * mixed magazines, reloads, repairs, destructions, bounties and wrecks.
 *
 * Each fight is flown twice by the same scripted pilot, whose orders depend
 * only on the campaign state. One flight is uninterrupted. The other is
 * written as a save and read back every few seconds of simulation, through
 * the same envelope, checksum and loader the game uses. Both must agree at
 * every reopen and at the end: a reopen may not add, repeat or lose anything.
 */

const content = shippedContent();
const QUANTUM_MS = content.rules.time.simulationQuantumMs;
const SEED = 'feed0123feed0123feed0123feed0123';
/** One decision a simulated second, as the balance pilot makes them. */
const DECIDE_EVERY = Math.max(1, Math.round(1_000 / QUANTUM_MS));
/** Reopen every 3.7 s: not a multiple of any cycle, so reopens land mid-cycle and mid-flight. */
const REOPEN_EVERY = Math.max(1, Math.round(3_700 / QUANTUM_MS));

const SITES = {
  rangeCheck: 'site.borrell.tangle-drift',
  bombardmentLine: 'site.borrell.ashfall-line',
  commandGroup: 'site.borrell.command-relay',
  pirateBase: 'site.borrell.outpost-cradle',
} as const;

/**
 * A cruiser carrying railguns, launchers and a small blaster at once, with a
 * web: every magazine kind and both damage paths in one ship.
 */
const MIXED_CRUISER: FixtureFit = {
  id: 'fit.persistence.mixed-cruiser',
  description: 'Medium railguns, medium launchers and a small blaster, with a web, booster and battery.',
  hullId: 'hull.independent.cruiser',
  modules: [
    { slot: 'weapon', index: 0, moduleId: 'module.turret.railgun.medium', ammunitionId: 'ammo.hybrid.medium.iron' },
    { slot: 'weapon', index: 1, moduleId: 'module.turret.railgun.medium', ammunitionId: 'ammo.hybrid.medium.plasma' },
    { slot: 'weapon', index: 2, moduleId: 'module.launcher.guided.medium', ammunitionId: 'ammo.guided.medium.kinetic' },
    { slot: 'weapon', index: 3, moduleId: 'module.launcher.guided.medium', ammunitionId: 'ammo.guided.medium.thermal' },
    { slot: 'weapon', index: 4, moduleId: 'module.turret.blaster.small', ammunitionId: 'ammo.hybrid.small.plasma' },
    { slot: 'system', index: 0, moduleId: 'module.web.small' },
    { slot: 'system', index: 1, moduleId: 'module.shield.booster.medium' },
    { slot: 'system', index: 2, moduleId: 'module.propulsion.afterburner.medium' },
    { slot: 'engineering', index: 0, moduleId: 'module.capacitor.battery.medium' },
    { slot: 'engineering', index: 1, moduleId: 'module.capacitor.recharger' },
  ],
  cargo: [
    { definitionId: 'ammo.hybrid.medium.iron', quantity: 60 },
    { definitionId: 'ammo.hybrid.medium.plasma', quantity: 60 },
    { definitionId: 'ammo.guided.medium.kinetic', quantity: 24 },
    { definitionId: 'ammo.guided.medium.thermal', quantity: 24 },
    { definitionId: 'ammo.hybrid.small.plasma', quantity: 60 },
  ],
};

interface Flight {
  readonly fit: FixtureFit;
  readonly siteId: string;
  /** The orbit the pilot holds around its target. */
  readonly orbitKm: number;
  readonly seconds: number;
}

interface Coverage {
  mostProjectilesAtReopen: number;
  mostSpeedEffectsAtReopen: number;
  playerProjectilesAtReopen: number;
  opponentProjectilesAtReopen: number;
  reservedAtReopen: number;
  destroyedBeforeLastReopen: number;
  reopens: number;
}

function run(state: CampaignState, type: string, payload: unknown): CampaignState {
  const result = runCommand({ campaign: state, content, type: type as CommandType, payload, invariantChecks: 'lightweight' });
  return result.kind === 'committed' && result.campaign !== null ? result.campaign : state;
}

/** The pilot: its orders are a function of the state alone, so both flights give the same ones. */
function decide(state: CampaignState, flight: Flight): CampaignState {
  const active = state.encounter.active;
  const playerId = state.assets.activeShipId;
  if (active === null || playerId === null || state.assets.location.kind !== 'site') return state;
  const living = active.npcs.filter((npc) => npc.destroyedAtMs === null);
  const target = living[0]?.shipId;
  if (target === undefined) return state;
  let next = state;
  for (const npc of living) next = run(next, 'targeting.lock', { targetId: npc.shipId });
  next = run(next, 'movement.orbit', { targetId: target, distanceKm: flight.orbitKm });
  for (const fitted of shipFit(next.assets, playerId)) {
    const definition = content.module(fitted.moduleId);
    if (definition === undefined) continue;
    const slot = { slotKind: fitted.slot.kind, slotIndex: fitted.slot.index };
    if (fitted.slot.kind === 'weapon') next = run(next, 'weapon.activate', { ...slot, targetId: target });
    else if (definition.category === 'web') next = run(next, 'module.activate', { ...slot, targetId: target });
    else if (fitted.slot.kind === 'system') next = run(next, 'module.activate', slot);
  }
  return next;
}

function reopen(state: CampaignState, sequence: number): CampaignState {
  const envelope = captureSnapshot({
    campaign: state,
    content,
    engineVersion: ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    slotId: 'slot-1',
    kind: 'auto',
    sequence,
    savedAtRealMs: 1_700_000_000_000 + sequence,
  });
  const loaded = loadSave(JSON.parse(JSON.stringify(envelope)) as unknown, { content });
  if (!loaded.ok) throw new Error(`The save did not reopen: ${JSON.stringify(loaded.error)}`);
  return loaded.state;
}

function reservedRounds(state: CampaignState): number {
  const ships = Object.values(state.combat.ships) as { weapons?: Record<string, { cycle: { reservedRounds: number } | null }> }[];
  return ships.reduce((total, ship) => total + Object.values(ship.weapons ?? {})
    .reduce((rounds, weapon) => rounds + (weapon.cycle?.reservedRounds ?? 0), 0), 0);
}

function start(flight: Flight): CampaignState {
  const docked = assembleFit(flight.fit, SEED, content).state;
  let state = stateOf(inSite(docked, { siteId: flight.siteId as never, content }));
  state = run(state, 'time.set', { paused: false, rate: 1 });
  return state;
}

/** Flies the fight twice and compares; returns what the reopens landed on. */
function flyBoth(flight: Flight): { readonly coverage: Coverage; readonly final: CampaignState } {
  const quanta = Math.round((flight.seconds * 1_000) / QUANTUM_MS);
  let straight = start(flight);
  let reopened = straight;
  const playerId = straight.assets.activeShipId;
  const coverage: Coverage = {
    mostProjectilesAtReopen: 0,
    mostSpeedEffectsAtReopen: 0,
    playerProjectilesAtReopen: 0,
    opponentProjectilesAtReopen: 0,
    reservedAtReopen: 0,
    destroyedBeforeLastReopen: 0,
    reopens: 0,
  };

  for (let quantum = 0; quantum < quanta; quantum += 1) {
    if (quantum % DECIDE_EVERY === 0) {
      straight = decide(straight, flight);
      reopened = decide(reopened, flight);
    }
    straight = run(straight, 'time.advance', { elapsedRealMs: QUANTUM_MS });
    reopened = run(reopened, 'time.advance', { elapsedRealMs: QUANTUM_MS });

    if (quantum % REOPEN_EVERY === REOPEN_EVERY - 1) {
      const projectiles = reopened.combat.projectiles;
      coverage.mostProjectilesAtReopen = Math.max(coverage.mostProjectilesAtReopen, projectiles.length);
      coverage.mostSpeedEffectsAtReopen = Math.max(coverage.mostSpeedEffectsAtReopen, reopened.combat.speedEffects.length);
      const sources = projectiles.map((projectile) => (projectile as unknown as { sourceShipId: string }).sourceShipId);
      if (sources.includes(playerId ?? '')) coverage.playerProjectilesAtReopen += 1;
      if (sources.some((source) => source !== playerId)) coverage.opponentProjectilesAtReopen += 1;
      coverage.reservedAtReopen += reservedRounds(reopened);
      coverage.destroyedBeforeLastReopen = reopened.encounter.active?.npcs.filter((npc) => npc.destroyedAtMs !== null).length ??
        coverage.destroyedBeforeLastReopen;
      coverage.reopens += 1;

      reopened = reopen(reopened, coverage.reopens);
      expect(campaignStateHash(reopened), `reopen ${String(coverage.reopens)} at ${String(reopened.time.simulationTimeMs)} ms`)
        .toBe(campaignStateHash(straight));
    }
  }

  expect(campaignStateHash(reopened)).toBe(campaignStateHash(straight));
  expect(canonicalJson(reopened)).toBe(canonicalJson(straight));
  expect(validateCampaign(reopened, content)).toEqual([]);
  return { coverage, final: reopened };
}

describe('reopening the ladder fights the release ships', () => {
  it('reopens the Bombardment Line with guided volleys in flight on both sides and matches the uninterrupted fight [V02-AC-13, V02-AC-06, FUNC-9.6, TECH-9.5, TECH-11.4]', () => {
    const { coverage } = flyBoth({
      fit: referenceFixtureFit('fit.cruiser.guided', content),
      siteId: SITES.bombardmentLine,
      orbitKm: 20,
      seconds: 150,
    });
    expect(coverage.playerProjectilesAtReopen).toBeGreaterThan(0);
    expect(coverage.opponentProjectilesAtReopen).toBeGreaterThan(0);
    expect(coverage.mostProjectilesAtReopen).toBeGreaterThanOrEqual(3);
  }, 240_000);

  it('reopens Range Check under the player\'s and the binder\'s webs and matches the uninterrupted fight [V02-AC-13, V02-AC-07, FUNC-9.9, TECH-9.5, TECH-11.4]', () => {
    const { coverage } = flyBoth({
      fit: referenceFixtureFit('fit.destroyer.blaster-web', content),
      siteId: SITES.rangeCheck,
      orbitKm: 4,
      seconds: 150,
    });
    expect(coverage.mostSpeedEffectsAtReopen).toBeGreaterThanOrEqual(2);
    expect(coverage.destroyedBeforeLastReopen).toBeGreaterThan(0);
  }, 240_000);

  it('reopens the Command Group with a mixed turret-and-launcher cruiser: reserved rounds, reloads, kills and bounties paid once [V02-AC-13, V02-AC-06, V02-AC-10, FUNC-9.4, FUNC-9.11, TECH-11.4]', () => {
    const before = start({ fit: MIXED_CRUISER, siteId: SITES.commandGroup, orbitKm: 8, seconds: 0 }).assets.credits;
    const { coverage, final } = flyBoth({ fit: MIXED_CRUISER, siteId: SITES.commandGroup, orbitKm: 8, seconds: 180 });
    expect(coverage.playerProjectilesAtReopen).toBeGreaterThan(0);
    expect(coverage.mostSpeedEffectsAtReopen).toBeGreaterThan(0);
    expect(coverage.destroyedBeforeLastReopen).toBeGreaterThan(0);
    // Every bounty paid was paid once: the wallet grew by exactly the bounties of the destroyed opponents.
    const destroyed = final.encounter.active?.npcs.filter((npc) => npc.destroyedAtMs !== null) ?? [];
    const bounties = destroyed.reduce((total, npc) => total + npc.bountyCredits, 0);
    expect(final.assets.credits - before).toBe(bounties);
    expect(final.encounter.active?.bountyCreditsPaid).toBe(bounties);
    expect(coverage.reservedAtReopen).toBeGreaterThan(0);
  }, 240_000);
});

describe('station state that must survive a reopen', () => {
  it('resumes a damaged, insured inactive ship and an open draft for it, which still commits to that ship alone [V02-AC-13, V02-AC-03, FUNC-6.3, FUNC-8.4, TECH-11.4]', async () => {
    // A damaged destroyer, insured and stored, beside an active frigate.
    let state = assembleFit(referenceFixtureFit('fit.destroyer.blaster-web', content), SEED, content).state;
    const destroyerId = state.assets.activeShipId!;
    const frigateId = Object.keys(state.assets.ships).find((id) => id !== destroyerId)!;
    const destroyer = state.assets.ships[destroyerId]!;
    state = {
      ...state,
      assets: {
        ...state.assets,
        ships: {
          ...state.assets.ships,
          [destroyerId]: { ...destroyer, condition: { ...destroyer.condition, damage: { ...destroyer.condition.damage, armor: 120, hull: 40 } } },
        },
      },
    };
    state = command(state, 'ship.activate', { shipId: frigateId }, content).state;
    const insured = state.assets.ships[destroyerId]!.insurance;

    // A draft open on the stored destroyer, one blaster taken out.
    state = command(state, 'fitting.begin', { shipId: destroyerId }, content).state;
    state = command(state, 'fitting.clear', { slotKind: 'weapon', slotIndex: 3 }, content).state;

    const store = createMemorySaveStore();
    const service = () => createSaveService({ store, content, engineVersion: ENGINE_VERSION, protocolVersion: PROTOCOL_VERSION });
    const saves = service();
    await saves.save(state, 'auto', 1_700_000_000_000);
    await saves.drain();
    const resumed = await service().resume();
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    let reopened = resumed.loaded.state;
    expect(canonicalJson(reopened)).toBe(canonicalJson(state));
    expect(reopened.assets.activeShipId).toBe(frigateId);
    expect(reopened.assets.ships[destroyerId]!.condition.damage).toMatchObject({ armor: 120, hull: 40 });
    expect(reopened.assets.ships[destroyerId]!.insurance).toEqual(insured);

    // The resumed draft is still bound to the destroyer: switching is refused
    // while it is open, and committing changes only the destroyer.
    const refused = runCommand({ campaign: reopened, content, type: 'ship.activate', payload: { shipId: destroyerId } });
    expect(refused.kind).toBe('failed');
    const frigateFit = canonicalJson(shipFit(reopened.assets, frigateId));
    reopened = command(reopened, 'fitting.commit', {}, content).state;
    expect(canonicalJson(shipFit(reopened.assets, frigateId))).toBe(frigateFit);
    expect(shipFit(reopened.assets, destroyerId).filter((slot) => slot.slot.kind === 'weapon')).toHaveLength(3);
    expect(validateCampaign(reopened, content)).toEqual([]);
  });
});
