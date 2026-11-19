import { expect } from 'vitest';

import {
  campaignStateHash,
  captureSnapshot,
  ENGINE_VERSION,
  loadSave,
  validateCampaign,
  type CampaignState,
} from '@engine';
import { runCommand } from '@engine/application';
import { shipFit } from '@engine/domain';
import { PROTOCOL_VERSION, type CommandType } from '@protocol';
import { canonicalJson } from '@shared';

import { shippedContent } from '../content.ts';
import { inSite, stateOf } from '../loss.ts';
import { assembleFit } from '../progression/assemble.ts';
import type { FixtureFit } from '../progression/fixtures.ts';

/**
 * Reopening the ladder fights the release ships, shared by the
 * `tests/integration/v02Persistence*.test.ts` files, which fly one fight each
 * so that they proceed side by side (Test Suite Optimization Plan phase 1).
 *
 * Each fight is flown twice by the same scripted pilot, whose orders depend
 * only on the campaign state. One flight is uninterrupted. The other is
 * written as a save and read back every few seconds of simulation, through
 * the same envelope, checksum and loader the game uses. Both must agree at
 * every reopen and at the end: a reopen may not add, repeat or lose anything.
 */

export const content = shippedContent();
const QUANTUM_MS = content.rules.time.simulationQuantumMs;
export const SEED = 'feed0123feed0123feed0123feed0123';
/** One decision a simulated second, as the balance pilot makes them. */
const DECIDE_EVERY = Math.max(1, Math.round(1_000 / QUANTUM_MS));
/** Reopen every 3.7 s: not a multiple of any cycle, so reopens land mid-cycle and mid-flight. */
const REOPEN_EVERY = Math.max(1, Math.round(3_700 / QUANTUM_MS));

export const SITES = {
  rangeCheck: 'site.borrell.tangle-drift',
  bombardmentLine: 'site.borrell.ashfall-line',
  commandGroup: 'site.borrell.command-relay',
  pirateBase: 'site.borrell.outpost-cradle',
} as const;

/**
 * A cruiser carrying railguns, launchers and a small blaster at once, with a
 * web: every magazine kind and both damage paths in one ship.
 */
export const MIXED_CRUISER: FixtureFit = {
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

export interface Flight {
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

export function start(flight: Flight): CampaignState {
  const docked = assembleFit(flight.fit, SEED, content).state;
  let state = stateOf(inSite(docked, { siteId: flight.siteId as never, content }));
  state = run(state, 'time.set', { paused: false, rate: 1 });
  return state;
}

/** Flies the fight twice and compares; returns what the reopens landed on. */
export function flyBoth(flight: Flight): { readonly coverage: Coverage; readonly final: CampaignState } {
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
