/**
 * The MVP content floor (MVP Scope 4.1-4.2; MVP Implementation Plan phase 16).
 *
 * Semantic validation holds every content pack to the rules of the game. This
 * holds the shipped bundle to what the current delivery selected: enough
 * catalog at the starting station for two combat approaches, and three
 * repeatable encounters that press the player in different ways. It is a
 * current-state requirement about one bundle, not a rule of the game, so a
 * fixture pack is not held to it and a later delivery replaces it rather than
 * the game rules changing.
 *
 * It applies wherever the shipped content is compiled: the development server,
 * the test run, `npm run validate:content` and the production build.
 */
import { issue } from './issues.mjs';

/** A longer-range turret choice reaches at least this multiple of the shortest. */
const RANGE_SPREAD = 2;

/**
 * @param {import('./compile.mjs').Collected} collected
 * @returns {import('./issues.mjs').ContentIssue[]}
 */
export function validateContentFloor(collected) {
  const economy = collected.rules.economy;
  if (economy === undefined) return [];
  const byId = (kind) => new Map(collected.definitions[kind].map((entry) => [entry.value.id, entry]));
  const modules = byId('modules');
  const ammunition = byId('ammunition');
  const hulls = byId('hulls');
  const profiles = byId('npc.profiles');
  const stationId = economy.values.startingStationId;
  const table = collected.listings.find((candidate) => candidate.stationId === stationId);
  const sold = new Set(table?.listings.map((listing) => listing.itemId) ?? []);
  const where = table?.file ?? economy.file;

  return [
    ...checkHullCount(hulls),
    ...checkCatalog({ modules, ammunition, sold, where, stationId }),
    ...checkEncounters(collected, profiles),
  ];
}

/** MVP Scope 4.1: exactly one player-usable hull. */
function checkHullCount(hulls) {
  const usable = [...hulls.values()].filter((entry) => entry.value.playerUsable);
  return usable.length === 1
    ? []
    : [issue('catalogRelationship', usable[1]?.file ?? '', usable[1]?.path ?? '',
        `the MVP ships exactly one player-usable hull, not ${String(usable.length)}`)];
}

/**
 * MVP Scope 4.1: what the starting station must sell so that at least two
 * combat approaches exist rather than one ordered upgrade path.
 */
function checkCatalog({ modules, ammunition, sold, where, stationId }) {
  const issues = [];
  const missing = (detail) => issues.push(issue('catalogRelationship', where, 'listings',
    `"${stationId}" sells ${detail} (MVP Scope 4.1)`));
  const selling = (category) => [...modules.values()]
    .map((entry) => entry.value)
    .filter((module) => module.category === category && sold.has(module.id));

  // Short-range and longer-range turret choices, through weapons, charges or both.
  const reaches = [];
  for (const turret of selling('turret')) {
    const charges = [...ammunition.values()]
      .map((entry) => entry.value)
      .filter((charge) => charge.group === turret.turret.ammunitionGroup && sold.has(charge.id));
    if (charges.length === 0) missing(`the "${turret.id}" turret but no ammunition for it`);
    for (const charge of charges) reaches.push(turret.turret.optimalRangeKm * charge.optimalRangeMultiplier);
  }
  if (reaches.length === 0) {
    missing('no turret with ammunition');
  } else if (Math.max(...reaches) < RANGE_SPREAD * Math.min(...reaches)) {
    missing(`no longer-range turret choice: the longest optimal range, ${String(Math.max(...reaches))} km, is under ${String(RANGE_SPREAD)} times the shortest`);
  }

  // At least two meaningfully different damage profiles.
  const dominant = new Set(
    [...ammunition.values()]
      .map((entry) => entry.value)
      .filter((charge) => sold.has(charge.id))
      .map((charge) => Object.entries(charge.damagePerShot).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]),
  );
  if (dominant.size < 2) missing('ammunition of only one dominant damage type');

  if (selling('shieldBooster').length + selling('armorRepairer').length === 0) missing('no active defensive module');
  if (selling('resistancePlating').length === 0) missing('no passive resistance module');
  if (selling('propulsion').length === 0) missing('no propulsion module');
  if (selling('capacitorBattery').length === 0) missing('no capacitor-support module');
  return issues;
}

/**
 * MVP Scope 4.2: three repeatable sites, one per tier, that press the player
 * with both single and multiple opponents and at least two different range or
 * movement behaviours.
 */
function checkEncounters(collected, profiles) {
  const issues = [];
  const encounters = collected.definitions.encounters;
  const file = encounters[0]?.file ?? '';
  const fail = (path, detail) => issues.push(issue('catalogRelationship', file, path, `${detail} (MVP Scope 4.2)`));

  const tiers = encounters.map((entry) => entry.value.tier).sort();
  if (tiers.join(',') !== '1,2,3') fail('', `the MVP offers one encounter at each of tiers 1, 2 and 3, not tiers ${tiers.join(', ') || 'none'}`);
  for (const entry of encounters) {
    if (!entry.value.repeatable) fail(`${entry.path}.repeatable`, `"${entry.value.id}" must stay repeatable`);
  }

  const opponents = (entry) => entry.value.spawns.reduce((total, spawn) => total + spawn.count, 0);
  if (!encounters.some((entry) => opponents(entry) === 1)) fail('', 'no encounter presses the player with a single opponent');
  if (!encounters.some((entry) => opponents(entry) > 1)) fail('', 'no encounter presses the player with several opponents');

  const roles = collected.rules.combat?.values.npcRoles ?? {};
  const behaviours = new Set(encounters.flatMap((entry) => entry.value.spawns.map((spawn) => {
    const role = profiles.get(spawn.npcProfileId)?.value.role;
    return role === undefined ? undefined : roles[role]?.movement;
  })).filter((movement) => movement !== undefined));
  if (behaviours.size < 2) fail('', `the opponents use only ${String(behaviours.size)} range or movement behaviour`);
  return issues;
}
