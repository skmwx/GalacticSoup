/**
 * Public engine API.
 *
 * The engine is headless: it runs in the worker in production and directly in
 * tests, and depends on no DOM, React, storage or network facility
 * (Technical Specification 2, 4.1, 16).
 */
export { createEngineHost, ENGINE_VERSION } from '@engine/application';
export type { EngineHost, EngineHostOptions } from '@engine/application';
export {
  ContentIntegrityError,
  ContentLookupError,
  DAMAGE_TYPES,
  DEFENSE_LAYERS,
  HARDPOINT_KINDS,
  ITEM_CATEGORIES,
  MARKET_SUPPLY_KINDS,
  MODULE_CATEGORIES,
  NPC_ROLES,
  RULE_GROUPS,
  SITE_KINDS,
  SLOT_KINDS,
  STATION_SERVICES,
} from '@engine/ports';
export type {
  AmmunitionDefinition,
  CapacitorModuleDefinition,
  CombatRules,
  ContentIdentity,
  ContentRepository,
  DamageProfile,
  DamageType,
  DefenseLayer,
  EconomyRules,
  EncounterDefinition,
  HullDefinition,
  ItemDefinition,
  LootTableDefinition,
  MarketListingDefinition,
  ModuleCategory,
  ModuleDefinition,
  NpcProfileDefinition,
  PropulsionModuleDefinition,
  RepairModuleDefinition,
  ResistanceModuleDefinition,
  RulesContent,
  SiteDefinition,
  StationDefinition,
  SystemDefinition,
  TimeRules,
  TradeableDefinition,
  TurretModuleDefinition,
} from '@engine/ports';
