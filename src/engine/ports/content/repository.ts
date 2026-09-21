import type {
  AmmunitionId,
  DefinitionId,
  EncounterId,
  HullId,
  ItemId,
  LootTableId,
  MessageKey,
  ModuleId,
  NpcProfileId,
  SiteId,
  StationId,
  SystemId,
} from '@shared';

import type {
  AmmunitionDefinition,
  EncounterDefinition,
  HullDefinition,
  ItemDefinition,
  LootTableDefinition,
  MarketListingDefinition,
  ModuleDefinition,
  NpcProfileDefinition,
  StationDefinition,
  SiteDefinition,
  SystemDefinition,
  TradeableDefinition,
} from './definitions.ts';
import type { RulesContent } from './rules.ts';

/**
 * The read-only content port (Technical Specification 4.3, 6.3).
 *
 * The engine asks this port for authored definitions and never learns how they
 * were stored, validated or bundled. Every lookup is by stable definition id;
 * every listing is returned in stable id order so an iteration can safely
 * affect an outcome.
 *
 * Campaign state stores definition ids and per-campaign mutable data only. It
 * never copies a definition, so a content update reaches an existing campaign
 * through this port rather than through a migration.
 *
 * @implements TECH-6.3
 */

export interface ContentIdentity {
  /** Deterministic build identity recorded in every save. */
  readonly contentVersion: string;
  /** SHA-256 of the canonical bundle. */
  readonly contentHash: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

export interface ContentRepository extends ContentIdentity {
  readonly rules: RulesContent;

  hull(id: string): HullDefinition | undefined;
  module(id: string): ModuleDefinition | undefined;
  ammunition(id: string): AmmunitionDefinition | undefined;
  item(id: string): ItemDefinition | undefined;
  /** An item, module or ammunition definition: anything a hold can contain. */
  tradeable(id: string): TradeableDefinition | undefined;
  system(id: string): SystemDefinition | undefined;
  site(id: string): SiteDefinition | undefined;
  station(id: string): StationDefinition | undefined;
  npcProfile(id: string): NpcProfileDefinition | undefined;
  lootTable(id: string): LootTableDefinition | undefined;
  encounter(id: string): EncounterDefinition | undefined;

  requireHull(id: HullId): HullDefinition;
  requireModule(id: ModuleId): ModuleDefinition;
  requireAmmunition(id: AmmunitionId): AmmunitionDefinition;
  requireItem(id: ItemId): ItemDefinition;
  requireTradeable(id: DefinitionId): TradeableDefinition;
  requireSystem(id: SystemId): SystemDefinition;
  requireSite(id: SiteId): SiteDefinition;
  requireStation(id: StationId): StationDefinition;
  requireNpcProfile(id: NpcProfileId): NpcProfileDefinition;
  requireLootTable(id: LootTableId): LootTableDefinition;
  requireEncounter(id: EncounterId): EncounterDefinition;

  hulls(): readonly HullDefinition[];
  modules(): readonly ModuleDefinition[];
  ammunitions(): readonly AmmunitionDefinition[];
  items(): readonly ItemDefinition[];
  systems(): readonly SystemDefinition[];
  stations(): readonly StationDefinition[];
  npcProfiles(): readonly NpcProfileDefinition[];
  lootTables(): readonly LootTableDefinition[];
  encounters(): readonly EncounterDefinition[];

  /** Listings of one station, ordered by item id. */
  listings(stationId: string): readonly MarketListingDefinition[];
  /** Ammunition compatible with a turret group, ordered by id. */
  ammunitionInGroup(group: string): readonly AmmunitionDefinition[];

  /** Authored text for a content message key, or `undefined` when absent. */
  message(locale: string, key: MessageKey): string | undefined;

  /**
   * Every authored message of one locale, for the interface to resolve the
   * keys projections carry. Returns an empty catalogue for a locale the bundle
   * does not contain (Technical Specification 12.5).
   */
  messages(locale: string): Readonly<Record<MessageKey, string>>;

  /** Definition count per kind, in stable kind order. */
  definitionCounts(): Readonly<Record<string, number>>;
}

/**
 * Thrown when a required definition does not resolve. A campaign must never
 * reach a state that references content it does not have; the application
 * layer maps this to the `NOT_FOUND` protocol error.
 */
export class ContentLookupError extends Error {
  readonly kind: string;
  readonly definitionId: string;

  constructor(kind: string, definitionId: string) {
    super(`No ${kind} definition with id "${definitionId}".`);
    this.name = 'ContentLookupError';
    this.kind = kind;
    this.definitionId = definitionId;
  }
}

/**
 * Thrown when a content bundle cannot be trusted: a failed structural guard, a
 * broken reference or a digest that does not match the canonical bytes. The
 * application layer maps this to the `CONTENT_ERROR` protocol error.
 */
export class ContentIntegrityError extends Error {
  readonly reason: string;
  readonly path: string;

  constructor(reason: string, path: string, detail: string) {
    super(`${detail} (${reason} at ${path === '' ? '/' : path})`);
    this.name = 'ContentIntegrityError';
    this.reason = reason;
    this.path = path;
  }
}
