/**
 * Per-site soft budgets (Technical Specification 13).
 *
 * An authored encounter decides how much a site can hold at once: how many
 * ships are in it, how many guided projectiles and speed effects they can have
 * in play, and so how many scheduled boundaries the simulation may have queued
 * for them. The budgets below are the loads the performance fixtures are
 * measured at or above. Content that goes past one still compiles - a budget
 * is not a rule of the game - but the build says so, because the performance
 * targets are then no longer demonstrated and need a fixture of that size.
 *
 * The player is counted in the largest ship it can buy, with every weapon slot
 * a launcher and every system slot a web where the hull allows, so a budget
 * holds whichever ship and fit the player brings. Containers and asteroids
 * arrive with mining.
 */

import { hullAcceptsSize } from './semantic.mjs';

export const SITE_SOFT_BUDGETS = Object.freeze({
  /** Ships in one site, the player's included. */
  ships: 8,
  /** Scheduler boundaries that can be queued for one site at once. */
  scheduledBoundaries: 96,
  /** Objects that may need a label: every ship, or the wreck it leaves. */
  labels: 12,
  /** Guided projectiles that can be in flight in one site at once. */
  projectiles: 24,
  /** Speed effects that can be held in one site at once. */
  speedEffects: 12,
});

/**
 * @typedef {object} SiteLoad
 * @property {string} encounterId
 * @property {string} siteId
 * @property {string} file
 * @property {string} path
 * @property {number} ships
 * @property {number} scheduledBoundaries
 * @property {number} labels
 * @property {number} projectiles
 * @property {number} speedEffects
 */

/**
 * The most each authored encounter can hold at once.
 *
 * A ship can have one boundary queued per weapon slot (a cycle or a reload),
 * one per system slot (an active-module cycle), one per lock it may be
 * attempting, and one more: the player's travel timer, or an opponent's next
 * decision. A destroyed opponent trades all of those for the one boundary that
 * expires its wreck, so the living ship is the upper bound. The market's
 * hourly boundary is the one that belongs to no ship.
 *
 * A launcher launches once a cycle and each projectile lives for its charge's
 * flight time, so one launcher has at most `floor(flight / cycle) + 1` in the
 * air, each with an impact and an expiry boundary queued. A web keeps one
 * effect per target it has held within its effect duration, so it holds at
 * most `floor(duration / cycle) + 1`, each with its expiry boundary. A
 * launched projectile outlives its source (Technical Specification 10.1), so
 * these are counted alongside the ship that fired them.
 *
 * @param {import('./compile.mjs').Collected} collected
 * @returns {SiteLoad[]}
 */
export function siteLoads(collected) {
  const hulls = new Map(collected.definitions.hulls.map((entry) => [entry.value.id, entry.value]));
  const modules = new Map(collected.definitions.modules.map((entry) => [entry.value.id, entry.value]));
  const charges = collected.definitions.ammunition.map((entry) => entry.value);
  const profiles = new Map(
    collected.definitions['npc.profiles'].map((entry) => [entry.value.id, entry.value]),
  );
  const boundariesOf = (hull) =>
    hull === undefined
      ? 0
      : hull.slots.weapon + hull.slots.system + hull.targeting.maxLockedTargets + 1;
  /** The most projectiles one launcher can have in flight. */
  const inFlightPer = (launcher) => {
    const flight = Math.max(0, ...charges
      .filter((charge) => charge.family === 'guided' && charge.size === launcher.size && charge.guided !== undefined)
      .map((charge) => charge.guided.flightTimeSeconds));
    return Math.floor(flight / launcher.activation.cycleSeconds) + 1;
  };
  /** The most effects one web can hold. */
  const effectsPer = (web) =>
    Math.floor((web.web.effectDurationSeconds ?? web.activation.cycleSeconds) / web.activation.cycleSeconds) + 1;
  const launchers = [...modules.values()].filter((module) => module.category === 'launcher');
  const webs = [...modules.values()].filter((module) => module.category === 'web');

  // The worst the player can bring: the player-usable hull and fit with the
  // most of each, counted independently so each is an upper bound.
  const playerHulls = [...hulls.values()].filter((hull) => hull.playerUsable);
  const player = {
    boundaries: Math.max(0, ...playerHulls.map(boundariesOf)),
    projectiles: Math.max(0, ...playerHulls.flatMap((hull) => launchers
      .filter((launcher) => hullAcceptsSize(hull, launcher))
      .map((launcher) => Math.min(hull.slots.weapon, hull.hardpoints.launcher ?? 0) * inFlightPer(launcher)))),
    speedEffects: Math.max(0, ...playerHulls.flatMap((hull) => webs
      .filter((web) => hullAcceptsSize(hull, web))
      .map((web) => hull.slots.system * effectsPer(web)))),
  };

  return collected.definitions.encounters.map((entry) => {
    let ships = 1;
    let scheduledBoundaries = 1 + player.boundaries;
    let projectiles = player.projectiles;
    let speedEffects = player.speedEffects;
    for (const spawn of entry.value.spawns) {
      const profile = profiles.get(spawn.npcProfileId);
      const fitted = (profile?.loadout.modules ?? []).map((id) => modules.get(id)).filter((module) => module !== undefined);
      ships += spawn.count;
      scheduledBoundaries += spawn.count * boundariesOf(hulls.get(profile?.hullId));
      projectiles += spawn.count * fitted
        .filter((module) => module.category === 'launcher')
        .reduce((total, launcher) => total + inFlightPer(launcher), 0);
      speedEffects += spawn.count * fitted
        .filter((module) => module.category === 'web')
        .reduce((total, web) => total + effectsPer(web), 0);
    }
    scheduledBoundaries += 2 * projectiles + speedEffects;
    return {
      encounterId: entry.value.id,
      siteId: entry.value.siteId,
      file: entry.file,
      path: entry.path,
      ships,
      scheduledBoundaries,
      labels: ships,
      projectiles,
      speedEffects,
    };
  });
}

/**
 * @typedef {object} ContentWarning
 * @property {string} file
 * @property {string} path
 * @property {string} detail
 */

/**
 * @param {import('./compile.mjs').Collected} collected
 * @returns {ContentWarning[]}
 */
export function budgetWarnings(collected) {
  /** @type {ContentWarning[]} */
  const warnings = [];
  for (const load of siteLoads(collected)) {
    for (const [budget, limit] of Object.entries(SITE_SOFT_BUDGETS)) {
      if (load[budget] > limit) {
        warnings.push({
          file: load.file,
          path: load.path,
          detail:
            `"${load.encounterId}" can hold ${String(load[budget])} ${budget}, over the soft budget of ` +
            `${String(limit)}; it needs a performance fixture of that size (Technical Specification 13)`,
        });
      }
    }
  }
  return warnings;
}

/** @param {ContentWarning} warning */
export function formatWarning(warning) {
  return `${[warning.file || '(bundle)', warning.path].filter(Boolean).join(' ')}: [softBudget] ${warning.detail}`;
}
