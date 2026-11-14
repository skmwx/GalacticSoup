/**
 * The delivery content floor (FeatureSpec02 sections 4-8; v0.2 Implementation
 * Plan phase 0, item 7).
 *
 * Semantic validation holds every content pack to the rules of the game. This
 * holds the shipped bundle to what the current delivery selected. It is a
 * current-state requirement about one bundle, not a rule of the game, so a
 * fixture pack is not held to it.
 *
 * The content manifest names the floor profile it claims:
 *
 *   - a development milestone profile (`v0.2-phase-1`, ...) holds what the
 *     completed implementation phases deliver and is honest that the rest of
 *     the v0.2 catalog and ladder are not there yet;
 *   - `v0.2-release` holds the complete v0.2 floor: three hulls, 26 combat
 *     modules, the ammunition floor, ten NPC profiles, twelve sites in three
 *     bands and the drop coverage.
 *
 * Every profile includes the checks that kept the MVP loop honest (two combat
 * approaches for sale, varied encounters, danger and guidance coverage), with
 * the MVP's single-hull limit replaced by the v0.2 lineup. The release gate
 * refuses any profile but `v0.2-release`, so placeholder content can never be
 * presented as meeting the final floor.
 *
 * It applies wherever the shipped content is compiled: the development server,
 * the test run, `npm run validate:content` and the production build.
 */
import { issue } from './issues.mjs';

/** A longer-range turret choice reaches at least this multiple of the shortest. */
const RANGE_SPREAD = 2;

/** The profile the release gate requires. */
export const RELEASE_FLOOR_PROFILE = 'v0.2-release';

/** Development milestones, in delivery order, then the release profile. */
export const FLOOR_PROFILES = ['v0.2-phase-1', RELEASE_FLOOR_PROFILE];

/** The v0.2 player lineup (FeatureSpec02 4.1), one hull per class. */
const PLAYER_HULL_CLASSES = ['frigate', 'destroyer', 'cruiser'];

/** The complete v0.2 floor (FeatureSpec02 5.1, 6.1, 7.1, 7.2, 8.1). */
const RELEASE_FLOOR = {
  combatModules: 26,
  ammunition: 16,
  npcProfiles: 10,
  encountersPerTier: { 1: 4, 2: 4, 3: 4 },
  droppableModules: 10,
};

/** The floor profile a manifest claims; an unnamed one is held to the release floor. */
export function floorProfileOf(collected) {
  return collected.manifest?.value.contentFloor ?? RELEASE_FLOOR_PROFILE;
}

/**
 * @param {import('./compile.mjs').Collected} collected
 * @returns {import('./issues.mjs').ContentIssue[]}
 */
export function validateContentFloor(collected) {
  const economy = collected.rules.economy;
  if (economy === undefined) return [];
  const profile = floorProfileOf(collected);
  const manifestFile = collected.manifest?.file ?? '';
  if (!FLOOR_PROFILES.includes(profile)) {
    return [issue('catalogRelationship', manifestFile, 'contentFloor',
      `unknown content floor profile "${String(profile)}"; expected one of ${FLOOR_PROFILES.join(', ')}`)];
  }
  const byId = (kind) => new Map(collected.definitions[kind].map((entry) => [entry.value.id, entry]));
  const modules = byId('modules');
  const ammunition = byId('ammunition');
  const hulls = byId('hulls');
  const profiles = byId('npc.profiles');
  const stationId = economy.values.startingStationId;
  const table = collected.listings.find((candidate) => candidate.stationId === stationId);
  const sold = new Set(table?.listings.map((listing) => listing.itemId) ?? []);
  const where = table?.file ?? economy.file;

  const issues = [
    ...checkHullLineup(hulls, sold, where, stationId),
    ...checkCatalog({ modules, ammunition, sold, where, stationId }),
    ...checkEncounters(collected, profiles),
    ...checkDangerCoverage(collected),
    ...checkGuidanceCoverage(collected),
  ];
  if (profile === RELEASE_FLOOR_PROFILE) {
    issues.push(...checkReleaseFloor({ collected, modules, ammunition, profiles, sold, where, stationId }));
  }
  return issues;
}

/**
 * FeatureSpec02 4.1-4.2: exactly three player-usable hulls, one of each class
 * of the combat lineup, each sold at the starting station so a hull upgrade is
 * earned through the market rather than granted.
 */
function checkHullLineup(hulls, sold, where, stationId) {
  const usable = [...hulls.values()].filter((entry) => entry.value.playerUsable);
  const issues = [];
  const file = usable[0]?.file ?? '';
  if (usable.length !== PLAYER_HULL_CLASSES.length) {
    issues.push(issue('catalogRelationship', file, 'definitions',
      `v0.2 ships exactly ${String(PLAYER_HULL_CLASSES.length)} player-usable hulls, not ${String(usable.length)} (FeatureSpec02 4.1)`));
  }
  for (const hullClass of PLAYER_HULL_CLASSES) {
    const found = usable.filter((entry) => entry.value.hullClass === hullClass);
    if (found.length !== 1) {
      issues.push(issue('catalogRelationship', file, 'definitions',
        `v0.2 ships one player-usable ${hullClass}, not ${String(found.length)} (FeatureSpec02 4.1)`));
    }
  }
  for (const entry of usable) {
    if (!sold.has(entry.value.id)) {
      issues.push(issue('catalogRelationship', where, 'listings',
        `"${stationId}" does not sell the player hull "${entry.value.id}" (FeatureSpec02 4.2)`));
    }
  }
  return issues;
}

/**
 * FeatureSpec02 5.1, 6.1, 7.1-7.2, 8.1: the complete v0.2 quantities. Size,
 * family and archetype coverage join this list as the phases that introduce
 * those fields complete.
 */
function checkReleaseFloor({ collected, modules, ammunition, profiles, sold, where, stationId }) {
  const issues = [];
  const fail = (file, path, detail) => issues.push(issue('catalogRelationship', file, path, `${detail} (v0.2 release floor)`));
  const anyFile = (map) => [...map.values()][0]?.file ?? '';

  if (modules.size !== RELEASE_FLOOR.combatModules) {
    fail(anyFile(modules), 'definitions',
      `${String(modules.size)} combat module definitions, not ${String(RELEASE_FLOOR.combatModules)}`);
  }
  if (ammunition.size < RELEASE_FLOOR.ammunition) {
    fail(anyFile(ammunition), 'definitions',
      `${String(ammunition.size)} ammunition definitions, fewer than ${String(RELEASE_FLOOR.ammunition)}`);
  }
  if (profiles.size < RELEASE_FLOOR.npcProfiles) {
    fail(anyFile(profiles), 'definitions',
      `${String(profiles.size)} NPC profiles, fewer than ${String(RELEASE_FLOOR.npcProfiles)}`);
  }
  const encounters = collected.definitions.encounters;
  const expectedTotal = Object.values(RELEASE_FLOOR.encountersPerTier).reduce((a, b) => a + b, 0);
  for (const [tier, count] of Object.entries(RELEASE_FLOOR.encountersPerTier)) {
    const found = encounters.filter((entry) => entry.value.tier === Number(tier)).length;
    if (found !== count) fail(encounters[0]?.file ?? '', '', `${String(found)} tier ${tier} encounters, not ${String(count)}`);
  }
  if (encounters.length !== expectedTotal) {
    fail(encounters[0]?.file ?? '', '', `${String(encounters.length)} encounters in total, not ${String(expectedTotal)}`);
  }
  const lootTables = collected.definitions['loot.tables'];
  const dropped = new Set(lootTables
    .flatMap((entry) => JSON.stringify(entry.value).match(/"itemId":"[^"]+"/g) ?? [])
    .map((match) => match.slice('"itemId":"'.length, -1))
    .filter((id) => modules.has(id)));
  if (dropped.size < RELEASE_FLOOR.droppableModules) {
    fail(lootTables[0]?.file ?? '', 'definitions',
      `${String(dropped.size)} module definitions can drop, fewer than ${String(RELEASE_FLOOR.droppableModules)}`);
  }
  for (const id of [...modules.keys(), ...ammunition.keys()].sort()) {
    if (!sold.has(id)) fail(where, 'listings', `"${stationId}" does not sell "${id}", so it has no dependable purchase path`);
  }
  return issues;
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

  // v0.2 uses tiers 1-3 as its three bands (FeatureSpec02 8.1); each band
  // offers at least one site, and tiers 4-5 stay free for later content.
  const tiers = [...new Set(encounters.map((entry) => entry.value.tier))].sort();
  if (tiers.join(',') !== '1,2,3') fail('', `the encounters cover tiers 1, 2 and 3 and no other, not tiers ${tiers.join(', ') || 'none'}`);
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

/**
 * Functional Specification 19.7 as the MVP includes it: every immediate-danger
 * event the included systems can produce raises an audible danger
 * notification, and ship destruction is reported and cannot be hidden. Warp
 * disruption is deferred with electronic warfare (MVP Scope 8).
 */
function checkDangerCoverage(collected) {
  const entries = collected.definitions.notifications;
  const file = entries[0]?.file ?? '';
  const danger = entries.map((entry) => entry.value).filter((value) => value.severity === 'danger');
  const has = (predicate) => danger.some((value) => predicate(value.trigger));
  const required = [
    ['the first hostile lock', (trigger) => trigger.kind === 'hostileLock'],
    ['shield falling to its danger threshold',
      (trigger) => trigger.kind === 'playerLayerBelow' && trigger.layer === 'shield'],
    ['armour first taking damage', (trigger) => trigger.kind === 'playerLayerDamaged' && trigger.layer === 'armor'],
    ['hull first taking damage', (trigger) => trigger.kind === 'playerLayerDamaged' && trigger.layer === 'hull'],
    ['capacitor too low to run an active defence', (trigger) => trigger.kind === 'playerModuleStarved' &&
      (trigger.categories.includes('shieldBooster') || trigger.categories.includes('armorRepairer'))],
  ];
  const issues = [];
  for (const [event, predicate] of required) {
    if (!has(predicate)) {
      issues.push(issue('catalogRelationship', file, 'definitions',
        `no danger notification reports ${event} (Functional Specification 19.7)`));
    }
  }
  if (!entries.some((entry) => entry.value.trigger.kind === 'shipLost' && !entry.value.hideable)) {
    issues.push(issue('catalogRelationship', file, 'definitions',
      'no unhideable notification reports the loss of the ship (Functional Specification 19.7)'));
  }
  return issues;
}

/**
 * MVP Scope 3 and MVP-AC-10: the guidance leads through the whole loop -
 * choose a site, undock, command the ship, fight, loot, return, sell, refit
 * and try a harder site - so a first-time player needs no external guide.
 */
function checkGuidanceCoverage(collected) {
  const chains = collected.definitions.guidance;
  const file = chains[0]?.file ?? '';
  const kinds = new Set(chains.flatMap((entry) => entry.value.steps.map((step) => step.predicate.kind)));
  const harder = chains.some((entry) => entry.value.steps.some((step) =>
    step.predicate.kind === 'encounterEntered' && step.predicate.minimumTier >= 2));
  const loop = [
    'destinationSelected', 'ammunitionInHold', 'undocked', 'movementOrdered', 'targetLocked', 'weaponFired',
    'defenseActivated', 'encounterCompleted', 'lootTaken', 'docked', 'itemSold', 'shipReady',
    'fitCommitted',
  ];
  const issues = loop.filter((kind) => !kinds.has(kind)).map((kind) =>
    issue('catalogRelationship', file, 'definitions',
      `the guidance never asks for "${kind}", so part of the loop is untaught (MVP Scope 3, MVP-AC-10)`));
  if (!harder) {
    issues.push(issue('catalogRelationship', file, 'definitions',
      'the guidance never leads to a harder site (MVP Scope 2, MVP-AC-10)'));
  }
  return issues;
}
