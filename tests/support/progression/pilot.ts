import type {
  CombatData,
  EncounterData,
  EncounterNpcData,
  ModuleRuntimeData,
  SiteData,
  WeaponRuntimeData,
} from '@protocol';

import type { PilotTactics } from './fixtures.ts';
import type { ScenarioSession } from './session.ts';

/**
 * A scripted pilot for headless scenarios (Functional Specification 7.1, 9.2-9.8,
 * 9.10; MVP Scope 4.2).
 *
 * It plays one encounter the way a competent player would with the ordinary
 * controls: pick the next opponent by an authored priority, hold a movement
 * order against it, keep it locked, keep the guns on it, burn toward it when it
 * is far, repair when a layer runs low and, optionally, leave when the hull is
 * failing. It decides once per simulated second from the same projections the
 * interface reads - encounter, site and combat state - and acts only through
 * protocol commands, so a scenario can never win by doing something the player
 * could not.
 *
 * It knows nothing an opponent's fit would hide, and nothing about the random
 * streams. What it produces is a sequence of commands; the engine decides
 * everything else.
 */

export type FightStatus = 'completed' | 'lost' | 'retreated' | 'timedOut';

export interface FightResult {
  readonly status: FightStatus;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** The smallest share of the ship's total hit points seen at a decision, or zero after a loss. */
  readonly lowestHitPointsShare: number;
}

/** Real time between decisions; the pilot reconsiders once a simulated second at 1x. */
export const DECISION_MS = 1_000;

export async function fightEncounter(
  session: ScenarioSession,
  tactics: PilotTactics,
  budgetSeconds: number,
): Promise<FightResult> {
  const startedAtMs = session.simulationTimeMs;
  let lowest = 1;
  const result = (status: FightStatus): FightResult => ({
    status, startedAtMs, endedAtMs: session.simulationTimeMs, lowestHitPointsShare: status === 'lost' ? 0 : lowest,
  });
  for (let step = 0; step < budgetSeconds * (1_000 / DECISION_MS); step += 1) {
    const site = await session.data<SiteData>('navigation.site');
    if (site.location.kind !== 'site') {
      // The ship is no longer in the site: destroyed and recovered, since the
      // pilot never orders a warp before the fight is decided.
      return result('lost');
    }
    const encounter = await session.data<EncounterData>('encounter.state');
    const combat = await session.data<CombatData>('combat.state');
    lowest = Math.min(lowest, hitPointsShare(combat));
    if (encounter.instance?.status === 'completed') return result('completed');

    const hull = layerFraction(combat, 'hull');
    if (tactics.retreatBelowHullFraction !== undefined && hull < tactics.retreatBelowHullFraction) {
      await session.data('navigation.retreat');
      return result('retreated');
    }

    const alive = (encounter.instance?.npcs ?? []).filter((npc) => !npc.destroyed);
    const engaged = combat.weapons.find((weapon) => weapon.repeating)?.targetId ?? null;
    const target = chooseTarget(alive, tactics, combat.maxLockRangeKm, engaged);
    if (target !== null) {
      await holdMovement(session, site, tactics, target.shipId);
      await keepLocks(session, combat, alive, tactics, target.shipId);
      await keepFiring(session, combat, target.shipId);
      await runPropulsion(session, combat, tactics, target);
    }
    await runRepairs(session, combat, tactics);

    await session.advance(DECISION_MS);
  }
  return result('timedOut');
}

/**
 * The first opponent in priority order that can be locked now; failing that,
 * the first in priority order, to close on. An opponent the guns are already
 * on is kept until it dies unless a higher-priority one can be locked, so the
 * pilot does not abandon a cycle for a target that is merely a little nearer.
 */
function chooseTarget(
  alive: readonly EncounterNpcData[],
  tactics: PilotTactics,
  maxLockRangeKm: number,
  engagedId: string | null,
): EncounterNpcData | null {
  const ordered = [...alive].sort((left, right) => {
    const rank = priority(left, tactics) - priority(right, tactics);
    if (rank !== 0) return rank;
    return (left.rangeFromPlayerKm ?? Infinity) - (right.rangeFromPlayerKm ?? Infinity) ||
      left.spawnOrdinal - right.spawnOrdinal;
  });
  const best = ordered.find((npc) => (npc.rangeFromPlayerKm ?? Infinity) <= maxLockRangeKm) ?? ordered[0] ?? null;
  const engaged = alive.find((npc) => npc.shipId === engagedId);
  return engaged !== undefined && best !== null && priority(engaged, tactics) <= priority(best, tactics)
    ? engaged
    : best;
}

function priority(npc: EncounterNpcData, tactics: PilotTactics): number {
  const index = tactics.targetPriority.indexOf(npc.profileId);
  return index === -1 ? tactics.targetPriority.length : index;
}

async function holdMovement(
  session: ScenarioSession,
  site: SiteData,
  tactics: PilotTactics,
  targetId: string,
): Promise<void> {
  const order = site.movementOrder;
  const wanted = tactics.movement;
  if (
    order !== null &&
    order.kind === wanted.kind &&
    order.targetId === targetId &&
    order.distanceKm === wanted.distanceKm
  ) return;
  await session.ask(`movement.${wanted.kind}`, { targetId, distanceKm: wanted.distanceKm });
}

/** Locks the target, and the next opponents in priority while slots remain. */
async function keepLocks(
  session: ScenarioSession,
  combat: CombatData,
  alive: readonly EncounterNpcData[],
  tactics: PilotTactics,
  targetId: string,
): Promise<void> {
  const held = new Set(combat.locks.map((lock) => lock.targetId));
  const wanted = [targetId, ...alive
    .filter((npc) => npc.shipId !== targetId)
    .sort((left, right) => priority(left, tactics) - priority(right, tactics))
    .map((npc) => npc.shipId)];
  let slots = combat.maxLockedTargets - held.size;
  for (const shipId of wanted) {
    if (held.has(shipId)) continue;
    if (slots <= 0) break;
    if (!lockable(combat, shipId)) continue;
    const response = await session.ask('targeting.lock', { targetId: shipId });
    if (response.ok) slots -= 1;
  }
}

function lockable(combat: CombatData, shipId: string): boolean {
  return combat.lockCommands
    .find((entry) => entry.objectId === shipId)
    ?.commands.some((command) => command.command === 'targeting.lock' && command.available) === true;
}

/** Every weapon cycles on the target once it is locked. */
async function keepFiring(session: ScenarioSession, combat: CombatData, targetId: string): Promise<void> {
  const locked = combat.locks.some((lock) => lock.targetId === targetId && lock.status === 'locked');
  if (!locked) return;
  for (const weapon of combat.weapons) {
    if (!weapon.online || firingAt(weapon, targetId)) continue;
    if (weapon.loadedRounds === 0 && weapon.reload === null) {
      await session.ask('weapon.reload', { slotKind: weapon.slot.kind, slotIndex: weapon.slot.index });
      continue;
    }
    await session.ask('weapon.activate', {
      slotKind: weapon.slot.kind,
      slotIndex: weapon.slot.index,
      targetId,
    });
  }
}

function firingAt(weapon: WeaponRuntimeData, targetId: string): boolean {
  return weapon.repeating && weapon.targetId === targetId;
}

/** Burns toward a far target, or always, or never, as the tactics say. */
async function runPropulsion(
  session: ScenarioSession,
  combat: CombatData,
  tactics: PilotTactics,
  target: EncounterNpcData,
): Promise<void> {
  const range = target.rangeFromPlayerKm ?? 0;
  const far = range > tactics.movement.distanceKm + Math.max(2, tactics.movement.distanceKm * 0.5);
  const wanted =
    tactics.propulsion === 'always' ? true :
    tactics.propulsion === 'closing' ? far :
    false;
  for (const module of combat.modules.filter((entry) => entry.category === 'propulsion')) {
    await operate(session, module, wanted);
  }
}

/**
 * Runs each repairer while its layer is below the threshold, stops it once the
 * layer is full, and rests it while the capacitor is below the tactics' floor.
 */
async function runRepairs(session: ScenarioSession, combat: CombatData, tactics: PilotTactics): Promise<void> {
  const capacitor = combat.capacitor;
  const charge = capacitor === null || capacitor.capacity <= 0 ? 1 : capacitor.charge / capacitor.capacity;
  const resting = charge < (tactics.repairCapacitorFloor ?? 0);
  for (const module of combat.modules) {
    if (module.category !== 'shieldBooster' && module.category !== 'armorRepairer') continue;
    const layer = module.effect.layer ?? (module.category === 'shieldBooster' ? 'shield' : 'armor');
    const fraction = layerFraction(combat, layer);
    // A threshold above 1 means "leave it running", the simplest thing a
    // player can do with a repairer.
    const always = tactics.repairBelowFraction > 1;
    if (resting || (!always && fraction >= 0.999)) await operate(session, module, false);
    else if (always || fraction < tactics.repairBelowFraction) await operate(session, module, true);
  }
}

async function operate(session: ScenarioSession, module: ModuleRuntimeData, wanted: boolean): Promise<void> {
  if (!module.online || module.passive) return;
  const payload = { slotKind: module.slot.kind, slotIndex: module.slot.index };
  if (wanted && !module.repeating) await session.ask('module.activate', payload);
  if (!wanted && module.repeating) await session.ask('module.deactivate', payload);
}

/** Share of the ship's total hit points it has now. */
function hitPointsShare(combat: CombatData): number {
  const layers = combat.defenses?.layers ?? [];
  const maximum = layers.reduce((total, entry) => total + entry.maximumHitPoints, 0);
  return maximum > 0 ? layers.reduce((total, entry) => total + entry.currentHitPoints, 0) / maximum : 1;
}

function layerFraction(combat: CombatData, layer: string): number {
  return combat.defenses?.layers.find((entry) => entry.layer === layer)?.fractionRemaining ?? 1;
}
