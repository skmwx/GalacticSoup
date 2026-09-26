import type {
  AmmunitionDefinition,
  AudioCueDefinition,
  ContentRepository,
  EncounterDefinition,
  GuidanceChainDefinition,
  GuidanceStepDefinition,
  HullDefinition,
  ItemDefinition,
  LootTableDefinition,
  MarketListingDefinition,
  ModuleDefinition,
  NotificationDefinition,
  NpcProfileDefinition,
  StationDefinition,
  SiteDefinition,
  SystemDefinition,
  TradeableDefinition,
} from '@engine/ports';
import { ContentIntegrityError, ContentLookupError } from '@engine/ports';
import { compareStable, deepFreeze, indexBy, sortedBy } from '@shared';

import type { ParsedContent } from './parseBundle.ts';

/**
 * The content port implementation (Technical Specification 6.3).
 *
 * Definitions are indexed once by stable id and handed out frozen. Every list
 * this repository returns is already in id order, so an engine iteration that
 * affects an outcome cannot depend on authoring order.
 *
 * @implements TECH-6.3
 */

export interface ContentRepositoryOptions {
  /**
   * Freezes every definition so an accidental write fails immediately.
   * Enabled in development and in tests; skipped in production, where the
   * cost is not repaid.
   */
  readonly freeze?: boolean;
}

export function createContentRepository(
  parsed: ParsedContent,
  options: ContentRepositoryOptions = {},
): ContentRepository {
  const content = options.freeze === true ? deepFreeze(parsed) : parsed;

  const hulls = index('hull', content.hulls);
  const modules = index('module', content.modules);
  const ammunition = index('ammunition', content.ammunition);
  const items = index('item', content.items);
  const systems = index('system', content.systems);
  const sites = index('site', content.systems.flatMap((system) => system.sites));
  const stations = index('station', content.stations);
  const npcProfiles = index('npcProfile', content.npcProfiles);
  const lootTables = index('lootTable', content.lootTables);
  const encounters = index('encounter', content.encounters);
  const guidanceChains = sortedBy(content.guidance, (entry) => entry.id);
  const guidanceSteps = index('guidanceStep', guidanceChains.flatMap((chain) => chain.steps));
  index('guidanceChain', guidanceChains);
  const notifications = index('notification', content.notifications);
  const notificationList = sortedBy(content.notifications, (entry) => entry.id);
  const audioCues = index('audioCue', content.audioCues);
  const audioCueList = sortedBy(content.audioCues, (entry) => entry.id);

  const tradeables = new Map<string, TradeableDefinition>();
  for (const definition of [...content.items, ...content.modules, ...content.ammunition]) {
    tradeables.set(definition.id, definition);
  }

  const listingsByStation = new Map<string, MarketListingDefinition[]>();
  for (const listing of content.listings) {
    const existing = listingsByStation.get(listing.stationId);
    if (existing === undefined) {
      listingsByStation.set(listing.stationId, [listing]);
    } else {
      existing.push(listing);
    }
  }
  for (const [stationId, listings] of listingsByStation) {
    listingsByStation.set(
      stationId,
      listings.sort((a, b) => compareStable(a.itemId, b.itemId)),
    );
  }

  const ammunitionByGroup = new Map<string, AmmunitionDefinition[]>();
  for (const charge of sortedBy(content.ammunition, (entry) => entry.id)) {
    const existing = ammunitionByGroup.get(charge.group);
    if (existing === undefined) {
      ammunitionByGroup.set(charge.group, [charge]);
    } else {
      existing.push(charge);
    }
  }

  const counts: Record<string, number> = {
    ammunition: content.ammunition.length,
    'audio.cues': content.audioCues.length,
    encounters: content.encounters.length,
    guidance: content.guidance.length,
    hulls: content.hulls.length,
    items: content.items.length,
    'loot.tables': content.lootTables.length,
    'market.listings': content.listings.length,
    modules: content.modules.length,
    notifications: content.notifications.length,
    'npc.profiles': content.npcProfiles.length,
    sites: sites.size,
    stations: content.stations.length,
    systems: content.systems.length,
  };

  const require = <T>(kind: string, id: string, found: T | undefined): T => {
    if (found === undefined) {
      throw new ContentLookupError(kind, id);
    }
    return found;
  };

  return {
    contentVersion: content.identity.contentVersion,
    contentHash: content.identity.contentHash,
    defaultLocale: content.identity.defaultLocale,
    locales: content.identity.locales,
    rules: content.rules,

    hull: (id) => hulls.get(id),
    module: (id) => modules.get(id),
    ammunition: (id) => ammunition.get(id),
    item: (id) => items.get(id),
    tradeable: (id) => tradeables.get(id),
    system: (id) => systems.get(id),
    site: (id) => sites.get(id),
    station: (id) => stations.get(id),
    npcProfile: (id) => npcProfiles.get(id),
    lootTable: (id) => lootTables.get(id),
    encounter: (id) => encounters.get(id),

    requireHull: (id) => require('hull', id, hulls.get(id)),
    requireModule: (id) => require('module', id, modules.get(id)),
    requireAmmunition: (id) => require('ammunition', id, ammunition.get(id)),
    requireItem: (id) => require('item', id, items.get(id)),
    requireTradeable: (id) => require('tradeable', id, tradeables.get(id)),
    requireSystem: (id) => require('system', id, systems.get(id)),
    requireSite: (id) => require('site', id, sites.get(id)),
    requireStation: (id) => require('station', id, stations.get(id)),
    requireNpcProfile: (id) => require('npcProfile', id, npcProfiles.get(id)),
    requireLootTable: (id) => require('lootTable', id, lootTables.get(id)),
    requireEncounter: (id) => require('encounter', id, encounters.get(id)),

    hulls: () => content.hulls,
    modules: () => content.modules,
    ammunitions: () => content.ammunition,
    items: () => content.items,
    systems: () => content.systems,
    stations: () => content.stations,
    npcProfiles: () => content.npcProfiles,
    lootTables: () => content.lootTables,
    encounters: () => content.encounters,

    guidanceChains: () => guidanceChains,
    guidanceStep: (id) => guidanceSteps.get(id),
    notifications: () => notificationList,
    notification: (id) => notifications.get(id),
    audioCues: () => audioCueList,
    audioCue: (id) => audioCues.get(id),

    listings: (stationId) => listingsByStation.get(stationId) ?? EMPTY_LISTINGS,
    ammunitionInGroup: (group) => ammunitionByGroup.get(group) ?? EMPTY_AMMUNITION,

    message: (locale, key) => content.localization[locale]?.[key],
    messages: (locale) => content.localization[locale] ?? EMPTY_MESSAGES,

    definitionCounts: () => counts,
  };
}

const EMPTY_MESSAGES: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_LISTINGS: readonly MarketListingDefinition[] = [];
const EMPTY_AMMUNITION: readonly AmmunitionDefinition[] = [];

type Identified =
  | HullDefinition
  | ModuleDefinition
  | AmmunitionDefinition
  | ItemDefinition
  | SystemDefinition
  | SiteDefinition
  | StationDefinition
  | NpcProfileDefinition
  | LootTableDefinition
  | EncounterDefinition
  | GuidanceChainDefinition
  | GuidanceStepDefinition
  | NotificationDefinition
  | AudioCueDefinition;

function index<T extends Identified>(kind: string, definitions: readonly T[]): Map<string, T> {
  const result = indexBy(definitions, (definition) => definition.id);
  if (!result.ok) {
    throw new ContentIntegrityError(
      'duplicate-id',
      kind,
      `two ${kind} definitions share the id "${result.duplicateKey}"`,
    );
  }
  return new Map(result.index);
}
