/**
 * Semantic validation (Technical Specification 6.2).
 *
 * JSON Schema checks the shape of one file. These are the cross-file rules it
 * cannot express: unique ids, resolvable references, the slot and hardpoint
 * relationships of Functional Specification 8.3-8.4, the market bounds of
 * 11.1-11.2, the neutral-access guarantee of 5.1, and complete localization.
 *
 * Every rule here is one the MVP slice relies on. Rules that belong to
 * deferred systems - gates, factions, recipes, skills - are added with those
 * systems, not before.
 */
import { isConvertibleVolume } from '../../../src/shared/numeric/units.ts';

import { issue } from './issues.mjs';

/** Slot each module category must occupy (Functional Specification 8.3). */
const CATEGORY_SLOTS = {
  turret: 'weapon',
  propulsion: 'system',
  shieldBooster: 'system',
  armorRepairer: 'system',
  resistancePlating: 'engineering',
  capacitorBattery: 'engineering',
};

/** Layer each repair or resistance category must address. */
const CATEGORY_LAYERS = {
  shieldBooster: 'shield',
  armorRepairer: 'armor',
};

/**
 * @param {import('./collect.mjs').Collected} collected
 * @returns {import('./issues.mjs').ContentIssue[]}
 */
export function validateSemantics(collected) {
  /** @type {import('./issues.mjs').ContentIssue[]} */
  const issues = [];

  const ids = new Map();
  const register = (entry) => {
    const id = entry.value.id;
    const previous = ids.get(id);
    if (previous !== undefined) {
      issues.push(
        issue(
          'duplicateId',
          entry.file,
          `${entry.path}.id`,
          `"${id}" is already defined in ${previous.file} ${previous.path}`,
        ),
      );
      return;
    }
    ids.set(id, entry);
  };

  for (const entries of Object.values(collected.definitions)) {
    for (const entry of entries) {
      register(entry);
    }
  }

  const hulls = byId(collected.definitions.hulls);
  const modules = byId(collected.definitions.modules);
  const ammunition = byId(collected.definitions.ammunition);
  const items = byId(collected.definitions.items);
  const systems = byId(collected.definitions.systems);
  const stations = byId(collected.definitions.stations);
  const npcProfiles = byId(collected.definitions['npc.profiles']);
  const lootTables = byId(collected.definitions['loot.tables']);
  const encounters = byId(collected.definitions.encounters);

  const sites = new Map();
  for (const entry of collected.definitions.systems) {
    for (const [index, site] of entry.value.sites.entries()) {
      const sitePath = `${entry.path}.sites[${index}]`;
      const previous = sites.get(site.id);
      if (previous !== undefined) {
        issues.push(
          issue(
            'duplicateId',
            entry.file,
            `${sitePath}.id`,
            `"${site.id}" is already defined in ${previous.file} ${previous.path}`,
          ),
        );
        continue;
      }
      sites.set(site.id, { value: site, file: entry.file, path: sitePath, systemId: entry.value.id });
    }
  }

  const tradeable = new Map([...items, ...modules, ...ammunition]);
  const sellable = new Map([...tradeable, ...hulls]);

  const start = collected.rules.economy;
  if (start !== undefined) {
    const values = start.values;
    const station = stations.get(values.startingStationId);
    const hull = hulls.get(values.starterHullId);
    if (station === undefined || !station.neutralAccess ||
        systems.get(station.systemId)?.dangerRating !== 1) {
      issues.push(issue('unresolvedReference', start.file, 'values.startingStationId',
        'Starting station must resolve to a neutral-access station in danger 1 space.'));
    }
    if (hull === undefined || !hull.playerUsable) {
      issues.push(issue('unresolvedReference', start.file, 'values.starterHullId',
        'Starter hull must resolve to a player-usable hull.'));
    }
    const granted = new Set();
    let startingVolume = 0;
    for (const [index, item] of (values.startingItems ?? []).entries()) {
      if (!tradeable.has(item.definitionId) || granted.has(item.definitionId)) {
        issues.push(issue('unresolvedReference', start.file, `values.startingItems[${index}].definitionId`,
          'Starting items must resolve to distinct physical item definitions.'));
      }
      granted.add(item.definitionId);
      const definition = tradeable.get(item.definitionId);
      if (definition !== undefined) {
        startingVolume += item.quantity * Math.round(definition.volumeCubicMetres * 1000);
        if (!Number.isSafeInteger(startingVolume)) {
          issues.push(issue('invalidValue', start.file, `values.startingItems[${index}].quantity`,
            'Starting item volume exceeds the supported canonical integer range.'));
        }
      }
    }
    issues.push(...checkStartingFit(start, hull, { modules, ammunition }));
  }

  const ammunitionGroups = new Set(
    collected.definitions.ammunition.map((entry) => entry.value.group),
  );

  issues.push(...checkVolumes(collected));
  issues.push(...checkHulls(collected));
  issues.push(...checkModules(collected, ammunitionGroups));
  issues.push(...checkNpcProfiles(collected, { hulls, modules, ammunition, lootTables }));
  issues.push(...checkLootTables(collected, tradeable));
  issues.push(...checkStations(collected, { systems, sites }));
  issues.push(...checkEncounters(collected, { systems, sites, npcProfiles }));
  issues.push(...checkEncounterReach(collected, { stations, sites }));
  issues.push(...checkEncounterDistinctness(collected));
  issues.push(...checkRewardSummaries(collected, { npcProfiles }));
  issues.push(...checkLootOutlets(collected, { hulls, modules, ammunition }));
  issues.push(...checkSiteUse(collected, sites, encounters));
  issues.push(...checkMarket(collected, { stations, sellable }));
  issues.push(...checkStarterReachability(collected, { stations, hulls, modules }));
  issues.push(...checkRules(collected));
  issues.push(...checkLocalization(collected));

  return issues;
}

function checkVolumes(collected) {
  const issues = [];
  const check = (entry, field) => {
    const value = entry.value[field];
    if (!isConvertibleVolume(value)) {
      issues.push(
        issue(
          'invalidValue',
          entry.file,
          `${entry.path}.${field}`,
          `${String(value)} m3 is not a whole number of cubic-decimetre units`,
        ),
      );
    }
  };

  for (const entry of collected.definitions.hulls) {
    check(entry, 'cargoCapacityCubicMetres');
  }
  for (const kind of ['modules', 'ammunition', 'items']) {
    for (const entry of collected.definitions[kind]) {
      check(entry, 'volumeCubicMetres');
    }
  }
  return issues;
}

function checkHulls(collected) {
  const issues = [];
  const playerUsable = collected.definitions.hulls.filter((entry) => entry.value.playerUsable);

  if (playerUsable.length === 0) {
    issues.push(
      issue(
        'catalogRelationship',
        '',
        '',
        'no hull is playerUsable, so the player could never fly anything',
      ),
    );
  }

  const maximum = collected.rules.combat?.values.resistanceMaximum;
  if (typeof maximum === 'number') {
    for (const entry of collected.definitions.hulls) {
      for (const [layer, definition] of Object.entries(entry.value.defenses)) {
        for (const [type, resistance] of Object.entries(definition.resistances)) {
          if (resistance > maximum) {
            issues.push(
              issue(
                'invalidValue',
                entry.file,
                `${entry.path}.defenses.${layer}.resistances.${type}`,
                `${String(resistance)} exceeds the resistance maximum of ${String(maximum)}`,
              ),
            );
          }
        }
      }
    }
  }

  return issues;
}

function checkModules(collected, ammunitionGroups) {
  const issues = [];

  for (const entry of collected.definitions.modules) {
    const module = entry.value;
    const expectedSlot = CATEGORY_SLOTS[module.category];
    if (expectedSlot !== undefined && module.slot !== expectedSlot) {
      issues.push(
        issue(
          'catalogRelationship',
          entry.file,
          `${entry.path}.slot`,
          `a ${module.category} module occupies a ${expectedSlot} slot, not a ${module.slot} slot`,
        ),
      );
    }

    if (module.hardpoint !== undefined && module.slot !== 'weapon') {
      issues.push(
        issue(
          'catalogRelationship',
          entry.file,
          `${entry.path}.hardpoint`,
          'only a weapon-slot module uses a hardpoint',
        ),
      );
    }

    if (module.category === 'turret') {
      if (module.hardpoint !== 'turret') {
        issues.push(
          issue(
            'catalogRelationship',
            entry.file,
            `${entry.path}.hardpoint`,
            'a turret requires a turret hardpoint',
          ),
        );
      }
      if (!ammunitionGroups.has(module.turret.ammunitionGroup)) {
        issues.push(
          issue(
            'unresolvedReference',
            entry.file,
            `${entry.path}.turret.ammunitionGroup`,
            `no ammunition belongs to the group "${module.turret.ammunitionGroup}"`,
          ),
        );
      }
    }

    const expectedLayer = CATEGORY_LAYERS[module.category];
    if (expectedLayer !== undefined && module.repair?.layer !== expectedLayer) {
      issues.push(
        issue(
          'catalogRelationship',
          entry.file,
          `${entry.path}.repair.layer`,
          `a ${module.category} repairs the ${expectedLayer} layer`,
        ),
      );
    }
  }

  return issues;
}

function checkNpcProfiles(collected, { hulls, modules, ammunition, lootTables }) {
  const issues = [];

  for (const entry of collected.definitions['npc.profiles']) {
    const profile = entry.value;
    const hull = hulls.get(profile.hullId);

    if (hull === undefined) {
      issues.push(
        issue('unresolvedReference', entry.file, `${entry.path}.hullId`, `no hull "${profile.hullId}"`),
      );
    }
    if (!lootTables.has(profile.lootTableId)) {
      issues.push(
        issue(
          'unresolvedReference',
          entry.file,
          `${entry.path}.lootTableId`,
          `no loot table "${profile.lootTableId}"`,
        ),
      );
    }

    const fitted = [];
    for (const [index, moduleId] of profile.loadout.modules.entries()) {
      const module = modules.get(moduleId);
      if (module === undefined) {
        issues.push(
          issue(
            'unresolvedReference',
            entry.file,
            `${entry.path}.loadout.modules[${index}]`,
            `no module "${moduleId}"`,
          ),
        );
        continue;
      }
      fitted.push(module);
    }

    if (profile.loadout.ammunitionId !== undefined && !ammunition.has(profile.loadout.ammunitionId)) {
      issues.push(
        issue(
          'unresolvedReference',
          entry.file,
          `${entry.path}.loadout.ammunitionId`,
          `no ammunition "${profile.loadout.ammunitionId}"`,
        ),
      );
    }

    if (hull !== undefined) {
      issues.push(...checkFitValidity(entry, hull, fitted));
    }

    const turrets = fitted.filter((module) => module.category === 'turret');
    issues.push(...checkReserveRounds(entry, hull, turrets, ammunition));
    if (turrets.length > 0) {
      const charge = profile.loadout.ammunitionId === undefined
        ? undefined
        : ammunition.get(profile.loadout.ammunitionId);
      if (charge === undefined) {
        issues.push(
          issue(
            'catalogRelationship',
            entry.file,
            `${entry.path}.loadout`,
            'a profile with turrets must name compatible ammunition',
          ),
        );
      } else {
        for (const turret of turrets) {
          if (turret.turret.ammunitionGroup !== charge.group) {
            issues.push(
              issue(
                'catalogRelationship',
                entry.file,
                `${entry.path}.loadout.ammunitionId`,
                `"${charge.id}" is group "${charge.group}"; "${turret.id}" loads "${turret.turret.ammunitionGroup}"`,
              ),
            );
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Reserve rounds reload the loadout's own turrets from the hold
 * (Functional Specification 9.4, 9.10), so they need turrets and a named
 * charge to load, and they must fit the hull's cargo hold.
 */
function checkReserveRounds(entry, hull, turrets, ammunition) {
  const profile = entry.value;
  const reserve = profile.loadout.reserveRounds ?? 0;
  if (reserve === 0) return [];
  const path = `${entry.path}.loadout.reserveRounds`;
  const charge = profile.loadout.ammunitionId === undefined
    ? undefined
    : ammunition.get(profile.loadout.ammunitionId);
  if (turrets.length === 0 || charge === undefined) {
    return [issue('catalogRelationship', entry.file, path, 'reserve rounds need a turret and a named ammunition')];
  }
  if (hull === undefined) return [];
  const needed = Math.round(reserve * charge.volumeCubicMetres * 1000);
  const hold = Math.round(hull.cargoCapacityCubicMetres * 1000);
  return needed <= hold
    ? []
    : [issue('catalogRelationship', entry.file, path,
        `${String(reserve)} rounds need ${String(needed)} dm3 but "${hull.id}" holds ${String(hold)} dm3`)];
}

/** Functional Specification 8.4: slots, hardpoints, power and processing. */
function checkFitValidity(entry, hull, fitted) {
  const issues = [];
  const slotUse = { weapon: 0, system: 0, engineering: 0, utility: 0 };
  const hardpointUse = { turret: 0, launcher: 0, mining: 0 };
  let power = 0;
  let processing = 0;

  for (const module of fitted) {
    slotUse[module.slot] += 1;
    if (module.hardpoint !== undefined) {
      hardpointUse[module.hardpoint] += 1;
    }
    power += module.fitting.powerUse;
    processing += module.fitting.processingUse;
  }

  for (const [slot, used] of Object.entries(slotUse)) {
    if (used > hull.slots[slot]) {
      issues.push(
        issue(
          'catalogRelationship',
          entry.file,
          `${entry.path}.loadout.modules`,
          `${String(used)} ${slot} modules exceed the ${String(hull.slots[slot])} that "${hull.id}" has`,
        ),
      );
    }
  }
  for (const [hardpoint, used] of Object.entries(hardpointUse)) {
    if (used > hull.hardpoints[hardpoint]) {
      issues.push(
        issue(
          'catalogRelationship',
          entry.file,
          `${entry.path}.loadout.modules`,
          `${String(used)} ${hardpoint} hardpoints exceed the ${String(hull.hardpoints[hardpoint])} that "${hull.id}" has`,
        ),
      );
    }
  }
  if (power > hull.fitting.powerOutput) {
    issues.push(
      issue(
        'catalogRelationship',
        entry.file,
        `${entry.path}.loadout.modules`,
        `${String(power)} power exceeds the ${String(hull.fitting.powerOutput)} that "${hull.id}" supplies`,
      ),
    );
  }
  if (processing > hull.fitting.processingOutput) {
    issues.push(
      issue(
        'catalogRelationship',
        entry.file,
        `${entry.path}.loadout.modules`,
        `${String(processing)} processing exceeds the ${String(hull.fitting.processingOutput)} that "${hull.id}" supplies`,
      ),
    );
  }

  return issues;
}

function checkLootTables(collected, tradeable) {
  const issues = [];

  for (const entry of collected.definitions['loot.tables']) {
    for (const [index, lootEntry] of entry.value.entries.entries()) {
      const path = `${entry.path}.entries[${index}]`;
      if (!tradeable.has(lootEntry.itemId)) {
        issues.push(
          issue(
            'unresolvedReference',
            entry.file,
            `${path}.itemId`,
            `"${lootEntry.itemId}" is not an item, module or ammunition definition`,
          ),
        );
      }
      if (lootEntry.quantityMinimum > lootEntry.quantityMaximum) {
        issues.push(
          issue(
            'invalidValue',
            entry.file,
            `${path}.quantityMinimum`,
            `minimum ${String(lootEntry.quantityMinimum)} exceeds maximum ${String(lootEntry.quantityMaximum)}`,
          ),
        );
      }
    }
  }

  return issues;
}

function checkStations(collected, { systems, sites }) {
  const issues = [];
  let neutral = 0;

  for (const entry of collected.definitions.stations) {
    const station = entry.value;
    if (!systems.has(station.systemId)) {
      issues.push(
        issue(
          'unresolvedReference',
          entry.file,
          `${entry.path}.systemId`,
          `no system "${station.systemId}"`,
        ),
      );
    }

    const site = sites.get(station.siteId);
    if (site === undefined) {
      issues.push(
        issue('unresolvedReference', entry.file, `${entry.path}.siteId`, `no site "${station.siteId}"`),
      );
    } else {
      if (site.value.kind !== 'station') {
        issues.push(
          issue(
            'catalogRelationship',
            entry.file,
            `${entry.path}.siteId`,
            `"${station.siteId}" is a ${site.value.kind} site, not a station site`,
          ),
        );
      }
      if (site.systemId !== station.systemId) {
        issues.push(
          issue(
            'catalogRelationship',
            entry.file,
            `${entry.path}.siteId`,
            `"${station.siteId}" belongs to ${site.systemId}, not ${station.systemId}`,
          ),
        );
      }
    }

    if (station.neutralAccess) {
      neutral += 1;
    }
  }

  if (collected.definitions.stations.length > 0 && neutral === 0) {
    issues.push(
      issue(
        'catalogRelationship',
        '',
        '',
        'no station grants neutral access, so the recovery guarantee of Functional Specification 5.1 cannot hold',
      ),
    );
  }

  return issues;
}

function checkEncounters(collected, { systems, sites, npcProfiles }) {
  const issues = [];
  let starterTier = 0;
  const tiers = new Set();

  for (const entry of collected.definitions.encounters) {
    const encounter = entry.value;
    tiers.add(encounter.tier);
    if (!systems.has(encounter.systemId)) {
      issues.push(
        issue(
          'unresolvedReference',
          entry.file,
          `${entry.path}.systemId`,
          `no system "${encounter.systemId}"`,
        ),
      );
    }

    const site = sites.get(encounter.siteId);
    if (site === undefined) {
      issues.push(
        issue('unresolvedReference', entry.file, `${entry.path}.siteId`, `no site "${encounter.siteId}"`),
      );
    } else {
      if (site.value.kind !== 'combat') {
        issues.push(
          issue(
            'catalogRelationship',
            entry.file,
            `${entry.path}.siteId`,
            `"${encounter.siteId}" is a ${site.value.kind} site, not a combat site`,
          ),
        );
      }
      if (site.systemId !== encounter.systemId) {
        issues.push(
          issue(
            'catalogRelationship',
            entry.file,
            `${entry.path}.siteId`,
            `"${encounter.siteId}" belongs to ${site.systemId}, not ${encounter.systemId}`,
          ),
        );
      }
    }

    for (const [index, spawn] of encounter.spawns.entries()) {
      if (!npcProfiles.has(spawn.npcProfileId)) {
        issues.push(
          issue(
            'unresolvedReference',
            entry.file,
            `${entry.path}.spawns[${index}].npcProfileId`,
            `no NPC profile "${spawn.npcProfileId}"`,
          ),
        );
      }
    }

    if (encounter.tier === 1) {
      starterTier += 1;
    }
  }

  if (collected.definitions.encounters.length > 0 && starterTier === 0) {
    issues.push(
      issue(
        'catalogRelationship',
        '',
        '',
        'no tier 1 encounter exists, so a starter fit has nothing it can attempt',
      ),
    );
  }

  // Tier is guidance for the next step (MVP Scope 4.2; Functional
  // Specification 18): a missing tier between the easiest and the hardest
  // leaves no encounter to learn that step on.
  const highest = Math.max(0, ...tiers);
  for (let tier = 1; tier < highest; tier += 1) {
    if (!tiers.has(tier)) {
      issues.push(
        issue(
          'catalogRelationship',
          '',
          '',
          `no tier ${String(tier)} encounter exists between tier 1 and tier ${String(highest)}`,
        ),
      );
    }
  }

  return issues;
}

/**
 * Every encounter can be reached from where the campaign starts
 * (Functional Specification 7.3; Technical Specification 6.2).
 *
 * The player undocks at the starting station's site and warps. Without gates
 * that means the same system, and a warp needs its minimum distance, so a site
 * closer than that could never be entered at all.
 */
function checkEncounterReach(collected, { stations, sites }) {
  const economy = collected.rules.economy?.values;
  const navigation = collected.rules.navigation?.values;
  const station = economy === undefined ? undefined : stations.get(economy.startingStationId);
  const home = station === undefined ? undefined : sites.get(station.siteId);
  if (home === undefined || navigation === undefined) return [];

  const issues = [];
  for (const entry of collected.definitions.encounters) {
    const site = sites.get(entry.value.siteId);
    if (site === undefined) continue;
    if (site.systemId !== home.systemId) {
      issues.push(issue('catalogRelationship', entry.file, `${entry.path}.siteId`,
        `"${entry.value.siteId}" is in ${site.systemId}, which the starting station in ${home.systemId} has no route to`));
      continue;
    }
    const distance = Math.hypot(
      site.value.position.xKm - home.value.position.xKm,
      site.value.position.yKm - home.value.position.yKm,
    );
    if (distance < navigation.warpMinimumDistanceKm) {
      issues.push(issue('catalogRelationship', entry.file, `${entry.path}.siteId`,
        `"${entry.value.siteId}" is ${String(Math.round(distance))} km from the starting station, closer than the ${String(navigation.warpMinimumDistanceKm)} km a warp needs`));
    }
  }
  return issues;
}

/**
 * Two encounters must differ in more than numbers
 * (Functional Specification 21; MVP Scope 4.2).
 *
 * Encounters that spawn the same profiles at the same distances differ only
 * in how many opponents there are, which the specification does not count as
 * a distinct encounter. Composition or initial positioning must change.
 */
function checkEncounterDistinctness(collected) {
  const issues = [];
  const seen = new Map();
  for (const entry of collected.definitions.encounters) {
    const signature = [...new Set(
      entry.value.spawns.map((spawn) => `${spawn.npcProfileId}@${String(spawn.spawnDistanceKm)}`),
    )].sort().join(',');
    const previous = seen.get(signature);
    if (previous !== undefined) {
      issues.push(issue('catalogRelationship', entry.file, `${entry.path}.spawns`,
        `spawns the same opponents at the same distances as "${previous}"; only their numbers differ`));
      continue;
    }
    seen.set(signature, entry.value.id);
  }
  return issues;
}

/**
 * A reward summary may not state a bounty the opponents do not carry
 * (MVP Scope 4.2).
 *
 * The station shows the authored total beside the summary, so the summary
 * need not repeat it; when it does, every credit figure in it must be that
 * total, in every locale, or the two would contradict each other the first
 * time a bounty is retuned.
 */
function checkRewardSummaries(collected, { npcProfiles }) {
  const issues = [];
  for (const entry of collected.definitions.encounters) {
    const total = entry.value.spawns.reduce(
      (sum, spawn) => sum + spawn.count * (npcProfiles.get(spawn.npcProfileId)?.bountyCredits ?? 0),
      0,
    );
    for (const [locale, table] of Object.entries(collected.localization)) {
      const text = table.messages[entry.value.rewardSummaryKey];
      if (typeof text !== 'string') continue;
      for (const figure of creditFigures(text)) {
        if (figure !== total) {
          issues.push(issue('invalidValue', table.file, `messages.${entry.value.rewardSummaryKey}`,
            `the ${locale} reward summary states ${String(figure)} credits, but the authored bounties total ${String(total)}`));
        }
      }
    }
  }
  return issues;
}

/** Whole numbers of at least 100 in a text, with digit-group separators removed. */
function creditFigures(text) {
  const figures = [];
  for (const match of text.matchAll(/\d{1,3}(?:[,.\u00a0\u202f ]\d{3})+|\d+/g)) {
    const value = Number(match[0].replace(/\D/g, ''));
    if (value >= 100) figures.push(value);
  }
  return figures;
}

/**
 * Everything a wreck can hold is worth taking home
 * (Functional Specification 9.11; MVP-AC-06).
 *
 * Loot must be sellable at some station, or be equipment a player-usable hull
 * can fit or load. Anything else would fill the hold and convert into
 * nothing.
 */
function checkLootOutlets(collected, { hulls, modules, ammunition }) {
  const listed = new Set(
    collected.listings.flatMap((table) => table.listings.map((listing) => listing.itemId)),
  );
  const playerHulls = [...hulls.values()].filter((hull) => hull.playerUsable);
  const fittable = (module) => playerHulls.some((hull) =>
    (hull.slots[module.slot] ?? 0) > 0 &&
    (module.hardpoint === undefined || (hull.hardpoints[module.hardpoint] ?? 0) > 0));
  const loadable = (charge) => [...modules.values()].some((module) =>
    module.category === 'turret' && module.turret.ammunitionGroup === charge.group && fittable(module));

  const issues = [];
  for (const entry of collected.definitions['loot.tables']) {
    for (const [index, lootEntry] of entry.value.entries.entries()) {
      if (listed.has(lootEntry.itemId)) continue;
      const module = modules.get(lootEntry.itemId);
      const charge = ammunition.get(lootEntry.itemId);
      if ((module !== undefined && fittable(module)) || (charge !== undefined && loadable(charge))) continue;
      issues.push(issue('catalogRelationship', entry.file, `${entry.path}.entries[${index}].itemId`,
        `"${lootEntry.itemId}" is sold at no station and no player-usable hull can use it`));
    }
  }
  return issues;
}

function checkSiteUse(collected, sites, encounters) {
  const issues = [];
  const used = new Set();
  for (const entry of collected.definitions.encounters) {
    used.add(entry.value.siteId);
  }
  void encounters;

  for (const [id, site] of sites) {
    if (site.value.kind === 'combat' && !used.has(id)) {
      issues.push(
        issue(
          'catalogRelationship',
          site.file,
          `${site.path}.id`,
          `combat site "${id}" is not used by any encounter`,
        ),
      );
    }
  }

  return issues;
}

function checkMarket(collected, { stations, sellable }) {
  const issues = [];

  for (const table of collected.listings) {
    if (!stations.has(table.stationId)) {
      issues.push(
        issue(
          'unresolvedReference',
          table.file,
          'stationId',
          `no station "${table.stationId}"`,
        ),
      );
    }

    const seen = new Set();
    for (const [index, listing] of table.listings.entries()) {
      const path = `listings[${index}]`;
      if (seen.has(listing.itemId)) {
        issues.push(
          issue(
            'duplicateId',
            table.file,
            `${path}.itemId`,
            `"${listing.itemId}" is listed twice at ${table.stationId}`,
          ),
        );
      }
      seen.add(listing.itemId);

      if (!sellable.has(listing.itemId)) {
        issues.push(
          issue(
            'unresolvedReference',
            table.file,
            `${path}.itemId`,
            `"${listing.itemId}" is not a tradeable definition`,
          ),
        );
      }

      if (listing.initialStock > listing.targetStock * 2) {
        issues.push(
          issue(
            'invalidValue',
            table.file,
            `${path}.initialStock`,
            `${String(listing.initialStock)} exceeds twice the target stock of ${String(listing.targetStock)}`,
          ),
        );
      }

      if (
        listing.supply === 'fixed' &&
        (listing.productionPerHour !== 0 || listing.consumptionPerHour !== 0)
      ) {
        issues.push(
          issue(
            'invalidValue',
            table.file,
            `${path}.supply`,
            'a fixed-supply listing is non-scarce and must not produce or consume stock',
          ),
        );
      }
    }
  }

  return issues;
}

/**
 * Functional Specification 11.2: a neutral-access station keeps the starter
 * hull, its basic modules and compatible ammunition at fixed prices, so a
 * recovered player can always fly again.
 */
/**
 * The authored starting fit must be a legal fit of the starter hull, assembled
 * only from the granted starting items (Functional Specification 3.1, 8.4).
 *
 * A campaign that cannot assemble its own fit would fail at creation rather
 * than at validation, so the build refuses the content instead.
 */
function checkStartingFit(start, hull, { modules, ammunition }) {
  const issues = [];
  const entries = start.values.startingFit ?? [];
  const at = (index, field) => `values.startingFit[${index}].${field}`;

  const granted = new Map(
    (start.values.startingItems ?? []).map((item) => [item.definitionId, item.quantity]),
  );
  const used = new Map();
  const taken = new Set();
  const hardpoints = new Map();
  let power = 0;
  let processing = 0;
  let armed = false;

  for (const [index, entry] of entries.entries()) {
    const module = modules.get(entry.moduleId);
    if (module === undefined) {
      issues.push(issue('unresolvedReference', start.file, at(index, 'moduleId'),
        `"${entry.moduleId}" is not a module definition`));
      continue;
    }
    used.set(entry.moduleId, (used.get(entry.moduleId) ?? 0) + 1);

    if (module.slot !== entry.slot) {
      issues.push(issue('catalogRelationship', start.file, at(index, 'slot'),
        `"${entry.moduleId}" occupies a ${module.slot} slot, not a ${entry.slot} slot`));
    }
    const key = `${entry.slot}:${entry.index}`;
    if (taken.has(key)) {
      issues.push(issue('catalogRelationship', start.file, at(index, 'index'),
        `slot ${key} is fitted twice`));
    }
    taken.add(key);

    if (hull !== undefined) {
      const available = hull.slots[entry.slot] ?? 0;
      if (entry.index >= available) {
        issues.push(issue('catalogRelationship', start.file, at(index, 'index'),
          `the starter hull has ${String(available)} ${entry.slot} slot(s)`));
      }
      if (module.hardpoint !== undefined) {
        const count = (hardpoints.get(module.hardpoint) ?? 0) + 1;
        hardpoints.set(module.hardpoint, count);
        if (count > (hull.hardpoints[module.hardpoint] ?? 0)) {
          issues.push(issue('catalogRelationship', start.file, at(index, 'moduleId'),
            `the starter hull has too few ${module.hardpoint} hardpoints`));
        }
      }
    }

    if (entry.online) {
      power += module.fitting.powerUse;
      processing += module.fitting.processingUse;
    }

    if (entry.ammunitionId === undefined) {
      continue;
    }
    const charge = ammunition.get(entry.ammunitionId);
    used.set(entry.ammunitionId, (used.get(entry.ammunitionId) ?? 0) + 1);
    if (charge === undefined) {
      issues.push(issue('unresolvedReference', start.file, at(index, 'ammunitionId'),
        `"${entry.ammunitionId}" is not an ammunition definition`));
    } else if (module.category !== 'turret') {
      issues.push(issue('catalogRelationship', start.file, at(index, 'ammunitionId'),
        `a ${module.category} module takes no charge`));
    } else if (charge.group !== module.turret.ammunitionGroup) {
      issues.push(issue('catalogRelationship', start.file, at(index, 'ammunitionId'),
        `"${entry.ammunitionId}" is not in the "${module.turret.ammunitionGroup}" group`));
    } else if (entry.online) {
      armed = true;
    }
  }

  // The starter fit must be able to attempt the easiest encounter without a
  // purchase (Functional Specification 3.1; MVP Scope 4.1), which it cannot
  // do without a loaded gun.
  if (entries.length > 0 && !armed) {
    issues.push(issue('catalogRelationship', start.file, 'values.startingFit',
      'the starting fit arms no online turret with a charge, so the starter ship could not fight'));
  }

  for (const [definitionId, count] of used) {
    if ((granted.get(definitionId) ?? 0) < count) {
      issues.push(issue('catalogRelationship', start.file, 'values.startingFit',
        `the starting fit uses "${definitionId}" but the starting items do not supply it`));
    }
  }

  if (hull !== undefined) {
    if (power > hull.fitting.powerOutput) {
      issues.push(issue('catalogRelationship', start.file, 'values.startingFit',
        `the online starting fit draws ${String(power)} power of ${String(hull.fitting.powerOutput)}`));
    }
    if (processing > hull.fitting.processingOutput) {
      issues.push(issue('catalogRelationship', start.file, 'values.startingFit',
        `the online starting fit uses ${String(processing)} processing of ${String(hull.fitting.processingOutput)}`));
    }
  }

  return issues;
}

function checkStarterReachability(collected, { stations, hulls, modules }) {
  const issues = [];
  const neutral = collected.definitions.stations.filter((entry) => entry.value.neutralAccess);
  if (neutral.length === 0) {
    return issues;
  }

  const listingsByStation = new Map();
  for (const table of collected.listings) {
    listingsByStation.set(table.stationId, table);
  }

  for (const entry of neutral) {
    const table = listingsByStation.get(entry.value.id);
    if (table === undefined) {
      issues.push(
        issue(
          'catalogRelationship',
          entry.file,
          `${entry.path}.id`,
          `neutral-access station "${entry.value.id}" has no market listings`,
        ),
      );
      continue;
    }

    const fixed = new Set(
      table.listings.filter((listing) => listing.supply === 'fixed').map((listing) => listing.itemId),
    );

    const playerHulls = [...hulls.values()].filter((hull) => hull.playerUsable);
    for (const hull of playerHulls) {
      if (!fixed.has(hull.id)) {
        issues.push(
          issue(
            'catalogRelationship',
            table.file,
            'listings',
            `"${hull.id}" is player-usable but "${entry.value.id}" does not stock it at a fixed price`,
          ),
        );
      }
    }
    issues.push(...checkRecoveryReach(collected, table, hulls));

    const turrets = [...modules.values()].filter(
      (module) => module.category === 'turret' && fixed.has(module.id),
    );
    if (turrets.length === 0) {
      issues.push(
        issue(
          'catalogRelationship',
          table.file,
          'listings',
          `"${entry.value.id}" stocks no turret at a fixed price, so a recovered ship could not be armed`,
        ),
      );
      continue;
    }

    const groups = new Set(turrets.map((module) => module.turret.ammunitionGroup));
    const stockedGroups = new Set(
      collected.definitions.ammunition
        .filter((charge) => fixed.has(charge.value.id))
        .map((charge) => charge.value.group),
    );
    for (const group of groups) {
      if (!stockedGroups.has(group)) {
        issues.push(
          issue(
            'catalogRelationship',
            table.file,
            'listings',
            `"${entry.value.id}" stocks a "${group}" turret but no ammunition for it at a fixed price`,
          ),
        );
      }
    }
  }

  return issues;
}

/**
 * A shipless pilot is never stranded (Functional Specification 9.12, 22.1).
 *
 * The recovery service grants a starter ship only below the starter hull's
 * reference value. A pilot at or above it must therefore be able to buy that
 * hull where they were recovered, so the recovery station's fixed quote for it
 * may not exceed the reference value.
 */
function checkRecoveryReach(collected, table, hulls) {
  const economy = collected.rules.economy?.values;
  if (economy === undefined) return [];
  const starter = hulls.get(economy.starterHullId);
  const index = table.listings.findIndex(
    (listing) => listing.itemId === economy.starterHullId && listing.supply === 'fixed',
  );
  const listing = table.listings[index];
  if (starter === undefined || listing === undefined) return [];
  const spread = Math.min(
    economy.effectiveSpreadMaximum,
    Math.max(economy.effectiveSpreadMinimum, listing.baseSpread),
  );
  const price = Math.max(
    economy.minimumUnitPriceCredits,
    Math.round(listing.basePriceCredits * listing.regionalPriceFactor * (1 + spread)),
  );
  return price <= starter.referenceValueCredits
    ? []
    : [
        issue(
          'catalogRelationship',
          table.file,
          `listings[${String(index)}].basePriceCredits`,
          `the starter hull sells for ${String(price)} credits, above the ${String(starter.referenceValueCredits)} credits below which recovery grants one`,
        ),
      ];
}

/** Bounds inside a rule group must be internally consistent. */
function checkRules(collected) {
  const issues = [];
  const pairs = [
    ['combat', 'damageVariationMinimum', 'damageVariationMaximum'],
    ['combat', 'lockTimeMinimumSeconds', 'lockTimeMaximumSeconds'],
    ['economy', 'scarcityMinimum', 'scarcityMaximum'],
    ['economy', 'midPriceMultiplierMinimum', 'midPriceMultiplierMaximum'],
    ['economy', 'effectiveSpreadMinimum', 'effectiveSpreadMaximum'],
    ['economy', 'elasticityMinimum', 'elasticityMaximum'],
    ['economy', 'baseSpreadMinimum', 'baseSpreadMaximum'],
    ['economy', 'stationServiceModifierMinimum', 'stationServiceModifierMaximum'],
  ];

  for (const [group, minimumKey, maximumKey] of pairs) {
    const rules = collected.rules[group];
    if (rules === undefined) {
      continue;
    }
    const minimum = rules.values[minimumKey];
    const maximum = rules.values[maximumKey];
    if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
      issues.push(
        issue(
          'invalidValue',
          rules.file,
          `values.${minimumKey}`,
          `${String(minimum)} exceeds ${maximumKey} of ${String(maximum)}`,
        ),
      );
    }
  }

  issues.push(...checkWreckReach(collected));
  return issues;
}

/**
 * The closest approach order must end inside wreck access range
 * (Functional Specification 7.2, 9.11; Technical Specification 6.2).
 *
 * An approach stops within its tolerance of the chosen distance, so a wreck
 * can be opened with an ordinary order only if the shortest authored range
 * plus that tolerance reaches it. Otherwise loot would be unreachable through
 * the interface, which is a content error rather than a player mistake.
 */
function checkWreckReach(collected) {
  const navigation = collected.rules.navigation;
  const combat = collected.rules.combat;
  const presets = navigation?.values.rangePresetsKm;
  const tolerance = navigation?.values.approachToleranceKm;
  const reach = combat?.values.wreckAccessRangeKm;
  if (!Array.isArray(presets) || presets.length === 0) return [];
  if (typeof tolerance !== 'number' || typeof reach !== 'number') return [];
  const closest = Math.min(...presets);
  return closest + tolerance <= reach
    ? []
    : [
        issue(
          'invalidValue',
          navigation.file,
          'values.rangePresetsKm',
          `the closest approach of ${String(closest)} km plus the ${String(tolerance)} km tolerance does not reach the ${String(reach)} km wreck access range`,
        ),
      ];
}

/** Every referenced message key must exist in every declared locale. */
function checkLocalization(collected) {
  const issues = [];
  const manifest = collected.manifest;
  if (manifest === null) {
    return issues;
  }

  const locales = manifest.value.locales;
  if (!locales.includes(manifest.value.defaultLocale)) {
    issues.push(
      issue(
        'invalidValue',
        manifest.file,
        'defaultLocale',
        `"${manifest.value.defaultLocale}" is not among the declared locales`,
      ),
    );
  }

  for (const locale of locales) {
    if (collected.localization[locale] === undefined) {
      issues.push(
        issue('missingLocalization', '', '', `no localization file for the declared locale "${locale}"`),
      );
    }
  }

  for (const reference of collectMessageKeys(collected)) {
    for (const locale of locales) {
      const table = collected.localization[locale];
      if (table === undefined) {
        continue;
      }
      if (table.messages[reference.key] === undefined) {
        issues.push(
          issue(
            'missingLocalization',
            reference.file,
            reference.path,
            `"${reference.key}" has no text in locale "${locale}"`,
          ),
        );
      }
    }
  }

  return issues;
}

/** Walks every definition and yields each `*Key` value with its location. */
function collectMessageKeys(collected) {
  const references = [];

  const walk = (value, file, path) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        walk(entry, file, `${path}[${index}]`);
      });
      return;
    }
    if (value === null || typeof value !== 'object') {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (typeof entry === 'string' && (key.endsWith('Key') || key.endsWith('Keys'))) {
        references.push({ key: entry, file, path: childPath });
      } else if (key === 'traitKeys' && Array.isArray(entry)) {
        entry.forEach((trait, index) => {
          references.push({ key: trait, file, path: `${childPath}[${index}]` });
        });
      } else {
        walk(entry, file, childPath);
      }
    }
  };

  for (const entries of Object.values(collected.definitions)) {
    for (const entry of entries) {
      walk(entry.value, entry.file, entry.path);
    }
  }

  return references;
}

function byId(entries) {
  return new Map(entries.map((entry) => [entry.value.id, entry.value]));
}
