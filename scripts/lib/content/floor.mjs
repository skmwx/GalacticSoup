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
 *   - a development milestone profile (`v0.2-phase-1`, `v0.2-phase-3`, ...) holds what the
 *     completed implementation phases deliver and is honest that the rest of
 *     the v0.2 catalog and ladder are not there yet;
 *   - `v0.2-release` holds the complete v0.2 floor: three hulls, 26 combat
 *     modules, the ammunition floor, ten NPC profiles, twelve distinct sites
 *     in three bands with at least three fit-sensitive ones, and the drop
 *     coverage. The shipped manifest claims it from v0.2 phase 5, when the
 *     ladder is complete.
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
import { acceptsCharge, hullAcceptsSize, weaponFamilyOf } from './semantic.mjs';

/** A longer-range turret choice reaches at least this multiple of the shortest. */
const RANGE_SPREAD = 2;

/** The profile the release gate requires. */
export const RELEASE_FLOOR_PROFILE = 'v0.2-release';

/** Development milestones, in delivery order, then the release profile. */
export const FLOOR_PROFILES = ['v0.2-phase-1', 'v0.2-phase-3', 'v0.2-phase-4', RELEASE_FLOOR_PROFILE];

/**
 * Profiles that hold the weapon catalog to the v0.2 family and size coverage
 * delivered by phases 2-3 (FeatureSpec02 5.1, 6.1): projectile and hybrid
 * turrets and guided launchers in small and medium sizes, and the ammunition
 * split per family and size.
 */
const WEAPON_COVERAGE_PROFILES = new Set(['v0.2-phase-3', 'v0.2-phase-4', RELEASE_FLOOR_PROFILE]);

/**
 * Profiles that hold the combat catalog, the enemy roster and the reference
 * fits complete (v0.2 Implementation Plan phase 4, item 5): the 26 modules all
 * purchasable, ten profiles covering the five archetypes, and six reference
 * fits covering the required approaches. The twelve-site ladder and drop
 * coverage are release-only.
 */
const CATALOG_COMPLETE_PROFILES = new Set(['v0.2-phase-4', RELEASE_FLOOR_PROFILE]);

/** Each archetype is fielded by at least this many profiles (FeatureSpec02 7.1). */
const PROFILES_PER_ARCHETYPE = 2;
const ARCHETYPES = ['fastFrigate', 'artillery', 'brawler', 'missile', 'controller'];

/** Reference fits per player hull (FeatureSpec02 5.3). */
const FITS_PER_HULL = 2;

/** Approaches the six reference fits must cover between them (FeatureSpec02 5.3). */
const FIT_APPROACHES = {
  'active shield': (modules) => modules.some((module) => module.category === 'shieldBooster'),
  'active armour': (modules) => modules.some((module) => module.category === 'armorRepairer'),
  'passive shield': (modules) => modules.some((module) =>
    module.category === 'shieldExtender' || module.category === 'shieldRecharger'),
  'web-assisted turret': (modules) => modules.some((module) => module.category === 'web') &&
    modules.some((module) => module.category === 'turret'),
  'guided combat': (modules) => modules.some((module) => module.category === 'launcher'),
};

/** Ammunition each weapon family and size must offer (FeatureSpec02 6.1). */
const AMMUNITION_COVERAGE = {
  'small-projectile': 2,
  'medium-projectile': 2,
  'small-hybrid': 2,
  'medium-hybrid': 2,
  'small-guided': 4,
  'medium-guided': 4,
};

/** The v0.2 player lineup (FeatureSpec02 4.1), one hull per class. */
const PLAYER_HULL_CLASSES = ['frigate', 'destroyer', 'cruiser'];

/** The complete v0.2 floor (FeatureSpec02 5.1, 6.1, 7.1, 7.2, 8.1). */
const RELEASE_FLOOR = {
  combatModules: 26,
  ammunition: 16,
  npcProfiles: 10,
  encountersPerTier: { 1: 4, 2: 4, 3: 4 },
  droppableModules: 10,
  fitSensitiveEncounters: 3,
};

/**
 * The module groups the drops must span between them (FeatureSpec02 7.2):
 * weapons, defence, capacitor or weapon support, and propulsion or control.
 */
const DROP_GROUPS = {
  weapons: ['turret', 'launcher'],
  defence: ['shieldBooster', 'armorRepairer', 'resistancePlating', 'resistanceAmplifier', 'shieldExtender', 'shieldRecharger'],
  'capacitor or weapon support': ['capacitorBattery', 'capacitorRecharger', 'weaponUpgrade'],
  'propulsion or control': ['propulsion', 'web'],
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
  if (WEAPON_COVERAGE_PROFILES.has(profile)) {
    issues.push(...checkWeaponCoverage({ modules, ammunition, sold, where }));
  }
  if (CATALOG_COMPLETE_PROFILES.has(profile)) {
    issues.push(...checkCompleteCatalog({ collected, modules, ammunition, profiles, hulls, sold, where, stationId }));
  }
  if (profile === RELEASE_FLOOR_PROFILE) {
    issues.push(...checkReleaseFloor({ collected, modules, profiles, hulls }));
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
 * FeatureSpec02 5.1, 5.3, 6.1, 7.1: the complete combat catalog. Exactly 26
 * modules and at least 16 charges, all purchasable at the starting station;
 * at least ten NPC profiles with every archetype fielded twice; and two
 * reference fits per player hull that between them cover the required
 * approaches, with at least one pair per hull differing in weapon family.
 */
function checkCompleteCatalog({ collected, modules, ammunition, profiles, hulls, sold, where, stationId }) {
  const issues = [];
  const fail = (file, path, detail) => issues.push(issue('catalogRelationship', file, path, `${detail} (v0.2 complete catalog)`));
  const anyFile = (map) => [...map.values()][0]?.file ?? '';

  if (modules.size !== RELEASE_FLOOR.combatModules) {
    fail(anyFile(modules), 'definitions',
      `${String(modules.size)} combat module definitions, not ${String(RELEASE_FLOOR.combatModules)}`);
  }
  if (ammunition.size < RELEASE_FLOOR.ammunition) {
    fail(anyFile(ammunition), 'definitions',
      `${String(ammunition.size)} ammunition definitions, fewer than ${String(RELEASE_FLOOR.ammunition)}`);
  }
  // At least ten profiles cover the five archetypes (FeatureSpec02 7.1); a
  // profile that states none does not count towards them.
  const covering = [...profiles.values()].filter((entry) => entry.value.archetype !== undefined).length;
  if (covering < RELEASE_FLOOR.npcProfiles) {
    fail(anyFile(profiles), 'definitions',
      `${String(covering)} NPC profiles state an archetype, fewer than ${String(RELEASE_FLOOR.npcProfiles)}`);
  }
  for (const archetype of ARCHETYPES) {
    const fielded = [...profiles.values()].filter((entry) => entry.value.archetype === archetype).length;
    if (fielded < PROFILES_PER_ARCHETYPE) {
      fail(anyFile(profiles), 'definitions',
        `${String(fielded)} profiles field the ${archetype} archetype, fewer than ${String(PROFILES_PER_ARCHETYPE)} (FeatureSpec02 7.1)`);
    }
  }
  for (const id of [...modules.keys(), ...ammunition.keys()].sort()) {
    if (!sold.has(id)) fail(where, 'listings', `"${stationId}" does not sell "${id}", so it has no dependable purchase path`);
  }

  const fits = collected.referenceFits ?? [];
  const fitFile = fits[0]?.file ?? '';
  const fitModules = (entry) => entry.value.modules
    .map((slot) => modules.get(slot.moduleId)?.value)
    .filter((module) => module !== undefined);
  for (const hull of [...hulls.values()].filter((entry) => entry.value.playerUsable)) {
    const forHull = fits.filter((entry) => entry.value.hullId === hull.value.id);
    if (forHull.length < FITS_PER_HULL) {
      fail(fitFile, 'fits', `${String(forHull.length)} reference fits for "${hull.value.id}", fewer than ${String(FITS_PER_HULL)} (FeatureSpec02 5.3)`);
      continue;
    }
    const families = new Set(forHull.map((entry) => fitModules(entry)
      .map((module) => weaponFamilyOf(module))
      .filter((family) => family !== null)
      .sort()
      .join('+')));
    if (families.size < 2) {
      fail(fitFile, 'fits', `the reference fits for "${hull.value.id}" all use the same weapon family (FeatureSpec02 5.3)`);
    }
  }
  for (const [approach, covers] of Object.entries(FIT_APPROACHES)) {
    if (!fits.some((entry) => covers(fitModules(entry)))) {
      fail(fitFile, 'fits', `no reference fit covers ${approach} (FeatureSpec02 5.3)`);
    }
  }
  return issues;
}

/**
 * FeatureSpec02 7.1, 7.2, 8.1: the complete v0.2 ladder and drop coverage, on
 * top of the complete catalog.
 *
 * - twelve encounters, four in each of the three bands;
 * - every encounter fields a different set of opponent profiles, so no two
 *   differ only in health, damage or count;
 * - at least three are marked fit-sensitive;
 * - every archetype profile flies in at least one encounter;
 * - the drops the ladder can actually produce (the loot tables of the
 *   profiles it spawns) span at least ten modules, a launcher, a medium module
 *   and every module group, and every band can drop a module the starter hull
 *   can fit, so early sites pay in usable equipment rather than only cargo.
 */
function checkReleaseFloor({ collected, modules, profiles, hulls }) {
  const issues = [];
  const fail = (file, path, detail) => issues.push(issue('catalogRelationship', file, path, `${detail} (v0.2 release floor)`));
  const encounters = collected.definitions.encounters;
  const encounterFile = encounters[0]?.file ?? '';
  const expectedTotal = Object.values(RELEASE_FLOOR.encountersPerTier).reduce((a, b) => a + b, 0);
  for (const [tier, count] of Object.entries(RELEASE_FLOOR.encountersPerTier)) {
    const found = encounters.filter((entry) => entry.value.tier === Number(tier)).length;
    if (found !== count) fail(encounterFile, '', `${String(found)} tier ${tier} encounters, not ${String(count)}`);
  }
  if (encounters.length !== expectedTotal) {
    fail(encounterFile, '', `${String(encounters.length)} encounters in total, not ${String(expectedTotal)}`);
  }

  const compositions = new Map();
  for (const entry of encounters) {
    const composition = [...new Set(entry.value.spawns.map((spawn) => spawn.npcProfileId))].sort().join('+');
    const previous = compositions.get(composition);
    if (previous !== undefined) {
      fail(entry.file, `${entry.path}.spawns`,
        `"${entry.value.id}" fields the same opponents as "${previous}"; twelve distinct encounters differ in composition (FeatureSpec02 8.1)`);
    }
    compositions.set(composition, entry.value.id);
  }
  const sensitive = encounters.filter((entry) => entry.value.fitSensitive === true).length;
  if (sensitive < RELEASE_FLOOR.fitSensitiveEncounters) {
    fail(encounterFile, '',
      `${String(sensitive)} encounters expose an inappropriate-fit weakness, fewer than ${String(RELEASE_FLOOR.fitSensitiveEncounters)} (FeatureSpec02 8.1)`);
  }
  const fielded = new Set(encounters.flatMap((entry) => entry.value.spawns.map((spawn) => spawn.npcProfileId)));
  for (const [id, entry] of profiles) {
    if (entry.value.archetype !== undefined && !fielded.has(id)) {
      fail(entry.file, entry.path, `the ${entry.value.archetype} profile "${id}" flies in no encounter (FeatureSpec02 7.1)`);
    }
  }

  const tables = new Map(collected.definitions['loot.tables'].map((entry) => [entry.value.id, entry]));
  const lootFile = collected.definitions['loot.tables'][0]?.file ?? '';
  /** Module definitions an encounter's opponents can drop. */
  const dropsOf = (encounter) => encounter.spawns
    .map((spawn) => tables.get(profiles.get(spawn.npcProfileId)?.value.lootTableId)?.value.entries ?? [])
    .flat()
    .map((lootEntry) => modules.get(lootEntry.itemId)?.value)
    .filter((module) => module !== undefined);
  const droppedModules = [...new Map(encounters.flatMap((entry) => dropsOf(entry.value))
    .map((module) => [module.id, module])).values()];
  if (droppedModules.length < RELEASE_FLOOR.droppableModules) {
    fail(lootFile, 'definitions',
      `the ladder's opponents can drop ${String(droppedModules.length)} module definitions, fewer than ${String(RELEASE_FLOOR.droppableModules)}`);
  }
  if (!droppedModules.some((module) => module.category === 'launcher')) {
    fail(lootFile, 'definitions', 'no launcher can drop (FeatureSpec02 7.2)');
  }
  if (!droppedModules.some((module) => module.size === 'medium')) {
    fail(lootFile, 'definitions', 'no medium module can drop (FeatureSpec02 7.2)');
  }
  for (const [group, categories] of Object.entries(DROP_GROUPS)) {
    if (!droppedModules.some((module) => categories.includes(module.category))) {
      fail(lootFile, 'definitions', `no ${group} module can drop (FeatureSpec02 7.2)`);
    }
  }
  const starter = hulls.get(collected.rules.economy?.values.starterHullId)?.value;
  if (starter !== undefined) {
    const fitsStarter = (module) => (starter.slots[module.slot] ?? 0) > 0 && hullAcceptsSize(starter, module) &&
      (module.hardpoint === undefined || (starter.hardpoints[module.hardpoint] ?? 0) > 0);
    for (const tier of Object.keys(RELEASE_FLOOR.encountersPerTier)) {
      const band = encounters.filter((entry) => entry.value.tier === Number(tier));
      if (band.length > 0 && !band.some((entry) => dropsOf(entry.value).some(fitsStarter))) {
        fail(lootFile, 'definitions', `no tier ${tier} encounter can drop a module the starter hull can fit (FeatureSpec02 7.2)`);
      }
    }
  }
  return issues;
}

/**
 * FeatureSpec02 5.1, 6.1: projectile, hybrid and guided weapons in both sizes,
 * each sold with enough charges that the charge is a real choice, and every
 * guided size able to deal each of the four damage types.
 */
function checkWeaponCoverage({ modules, ammunition, sold, where }) {
  const issues = [];
  const fail = (detail) => issues.push(issue('catalogRelationship', where, 'listings', `${detail} (FeatureSpec02 5.1, 6.1)`));
  const weapons = [...modules.values()].map((entry) => entry.value).filter((module) => weaponFamilyOf(module) !== null);
  const charges = [...ammunition.values()].map((entry) => entry.value);
  for (const [group, minimum] of Object.entries(AMMUNITION_COVERAGE)) {
    const [size, family] = group.split('-');
    const groupWeapons = weapons.filter((module) => module.size === size && weaponFamilyOf(module) === family && sold.has(module.id));
    if (groupWeapons.length === 0) fail(`no ${size} ${family} weapon is sold`);
    const groupCharges = charges.filter((charge) => charge.size === size && charge.family === family && sold.has(charge.id));
    if (groupCharges.length < minimum) fail(`${String(groupCharges.length)} ${size} ${family} charges are sold, fewer than ${String(minimum)}`);
    if (family === 'guided') {
      const types = new Set(groupCharges.flatMap((charge) =>
        Object.entries(charge.damagePerShot).filter(([, value]) => value > 0).map(([type]) => type)));
      if (types.size < 4) fail(`${size} guided charges cover ${String(types.size)} damage types, not all four`);
    }
    for (const weapon of groupWeapons) {
      if (!groupCharges.some((charge) => acceptsCharge(weapon, charge))) fail(`"${weapon.id}" has no sold charge`);
    }
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
      .filter((charge) => acceptsCharge(turret, charge) && sold.has(charge.id));
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
  if (selling('resistancePlating').length + selling('resistanceAmplifier').length === 0) missing('no passive resistance module');
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
