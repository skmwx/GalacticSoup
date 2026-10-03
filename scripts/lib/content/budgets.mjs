/**
 * Per-site soft budgets (Technical Specification 13).
 *
 * An authored encounter decides how much a site can hold at once: how many
 * ships are in it, and so how many scheduled boundaries the simulation may
 * have queued for them. The budgets below are the loads the performance
 * fixture is measured at or above. Content that goes past one still compiles -
 * a budget is not a rule of the game - but the build says so, because the
 * performance targets are then no longer demonstrated and need a fixture of
 * that size.
 *
 * Only what the delivered systems put in a site is budgeted. Projectiles,
 * containers and asteroids arrive with guided weapons and mining.
 */

export const SITE_SOFT_BUDGETS = Object.freeze({
  /** Ships in one site, the player's included. */
  ships: 8,
  /** Scheduler boundaries that can be queued for one site at once. */
  scheduledBoundaries: 64,
  /** Objects that may need a label: every ship, or the wreck it leaves. */
  labels: 12,
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
 * @param {import('./compile.mjs').Collected} collected
 * @returns {SiteLoad[]}
 */
export function siteLoads(collected) {
  const hulls = new Map(collected.definitions.hulls.map((entry) => [entry.value.id, entry.value]));
  const profiles = new Map(
    collected.definitions['npc.profiles'].map((entry) => [entry.value.id, entry.value]),
  );
  const boundariesOf = (hull) =>
    hull === undefined
      ? 0
      : hull.slots.weapon + hull.slots.system + hull.targeting.maxLockedTargets + 1;
  const playerHull = hulls.get(collected.rules.economy?.values.starterHullId);

  return collected.definitions.encounters.map((entry) => {
    let ships = 1;
    let scheduledBoundaries = 1 + boundariesOf(playerHull);
    for (const spawn of entry.value.spawns) {
      ships += spawn.count;
      scheduledBoundaries +=
        spawn.count * boundariesOf(hulls.get(profiles.get(spawn.npcProfileId)?.hullId));
    }
    return {
      encounterId: entry.value.id,
      siteId: entry.value.siteId,
      file: entry.file,
      path: entry.path,
      ships,
      scheduledBoundaries,
      labels: ships,
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
