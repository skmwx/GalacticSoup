import type {
  AmmunitionId,
  CubicDecimetres,
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

/**
 * Engine-facing shapes of the authored definitions the MVP slice needs
 * (Technical Specification 6.1; MVP Scope 3-4).
 *
 * These types describe content *after* it has been loaded: identifiers are
 * branded, and authored cubic metres have become canonical cubic-decimetre
 * units. The authored JSON shape is described by the schemas under
 * `schemas/content`, which are the contract a future Java engine reads.
 *
 * Only the structural enumerations live here - the four damage types, the slot
 * kinds, the defensive layers. Every quantity is a tunable value that content
 * supplies.
 *
 * @implements TECH-6.1
 */

/** Structural, not tunable (Functional Specification 9.7). */
export const DAMAGE_TYPES = ['electromagnetic', 'thermal', 'kinetic', 'explosive'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Structural, not tunable (Functional Specification 9.7). */
export const DEFENSE_LAYERS = ['shield', 'armor', 'hull'] as const;
export type DefenseLayer = (typeof DEFENSE_LAYERS)[number];

/** Structural, not tunable (Functional Specification 8.3). */
export const SLOT_KINDS = ['weapon', 'system', 'engineering', 'utility'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/** Structural, not tunable (Functional Specification 8.3). */
export const HARDPOINT_KINDS = ['turret', 'launcher', 'mining'] as const;
export type HardpointKind = (typeof HARDPOINT_KINDS)[number];

export const MODULE_CATEGORIES = [
  'turret',
  'propulsion',
  'shieldBooster',
  'armorRepairer',
  'resistancePlating',
  'capacitorBattery',
] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export const NPC_ROLES = ['brawler', 'skirmisher', 'sniper'] as const;
export type NpcRole = (typeof NPC_ROLES)[number];

export const STATION_SERVICES = ['market', 'fitting', 'repair', 'insurance'] as const;
export type StationService = (typeof STATION_SERVICES)[number];

export const SITE_KINDS = ['station', 'combat'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export const ITEM_CATEGORIES = ['salvage', 'commodity'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * `fixed` is the unlimited, non-scarce supply a neutral recovery station keeps
 * for the starter hull, its basic modules and compatible ammunition
 * (Functional Specification 11.2).
 */
export const MARKET_SUPPLY_KINDS = ['dynamic', 'fixed'] as const;
export type MarketSupplyKind = (typeof MARKET_SUPPLY_KINDS)[number];

/** A share of one shot's damage per damage type, in hit points. */
export type DamageProfile = Readonly<Record<DamageType, number>>;

/** A resistance per damage type, as a fraction from 0 through 0.9. */
export type ResistanceProfile = Readonly<Record<DamageType, number>>;

export interface LayerDefinition {
  readonly hitPoints: number;
  readonly resistances: ResistanceProfile;
}

export interface HullDefinition {
  readonly id: HullId;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  /** Only a player-usable hull may be bought, fitted and undocked by the player. */
  readonly playerUsable: boolean;
  readonly defenses: Readonly<Record<DefenseLayer, LayerDefinition>>;
  readonly shieldRechargeSeconds: number;
  readonly capacitor: { readonly capacity: number; readonly rechargeSeconds: number };
  readonly movement: {
    readonly maxSpeedKmPerSecond: number;
    readonly accelerationKmPerSecondSquared: number;
    readonly brakingKmPerSecondSquared: number;
    readonly turnRateRadiansPerSecond: number;
    readonly warpSpeedKmPerSecond: number;
  };
  readonly signatureRadiusMetres: number;
  readonly targeting: {
    readonly scanResolution: number;
    readonly maxLockRangeKm: number;
    readonly maxLockedTargets: number;
  };
  readonly cargoCapacityCubicDecimetres: CubicDecimetres;
  readonly slots: Readonly<Record<SlotKind, number>>;
  readonly hardpoints: Readonly<Record<HardpointKind, number>>;
  readonly fitting: { readonly powerOutput: number; readonly processingOutput: number };
  readonly referenceValueCredits: number;
  readonly insuranceClass: string;
  readonly traitKeys: readonly MessageKey[];
}

interface ModuleCommon {
  readonly id: ModuleId;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly slot: SlotKind;
  /** Weapon-slot modules only (Functional Specification 8.3). */
  readonly hardpoint?: HardpointKind;
  readonly fitting: { readonly powerUse: number; readonly processingUse: number };
  /** Absent for a passive module, which never activates or draws capacitor. */
  readonly activation?: {
    readonly capacitorPerCycle: number;
    readonly cycleSeconds: number;
  };
  readonly volumeCubicDecimetres: CubicDecimetres;
  readonly referenceValueCredits: number;
}

export interface TurretModuleDefinition extends ModuleCommon {
  readonly category: 'turret';
  readonly turret: {
    readonly optimalRangeKm: number;
    readonly falloffKm: number;
    readonly trackingRadiansPerSecond: number;
    readonly signatureResolutionMetres: number;
    readonly damageMultiplier: number;
    readonly magazineSize: number;
    readonly ammunitionGroup: string;
  };
}

export interface PropulsionModuleDefinition extends ModuleCommon {
  readonly category: 'propulsion';
  readonly propulsion: {
    readonly speedBonusFraction: number;
    readonly signatureRadiusPenaltyFraction: number;
  };
}

export interface RepairModuleDefinition extends ModuleCommon {
  readonly category: 'shieldBooster' | 'armorRepairer';
  readonly repair: { readonly layer: DefenseLayer; readonly amountHitPoints: number };
}

export interface ResistanceModuleDefinition extends ModuleCommon {
  readonly category: 'resistancePlating';
  readonly resistance: { readonly layer: DefenseLayer; readonly bonuses: ResistanceProfile };
}

export interface CapacitorModuleDefinition extends ModuleCommon {
  readonly category: 'capacitorBattery';
  readonly capacitorSupport: {
    readonly capacityBonus: number;
    readonly rechargeBonusFraction: number;
  };
}

export type ModuleDefinition =
  | TurretModuleDefinition
  | PropulsionModuleDefinition
  | RepairModuleDefinition
  | ResistanceModuleDefinition
  | CapacitorModuleDefinition;

export interface AmmunitionDefinition {
  readonly id: AmmunitionId;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  /** Matches the `ammunitionGroup` of every turret that can load it. */
  readonly group: string;
  readonly damagePerShot: DamageProfile;
  readonly optimalRangeMultiplier: number;
  readonly falloffMultiplier: number;
  readonly trackingMultiplier: number;
  readonly volumeCubicDecimetres: CubicDecimetres;
  readonly referenceValueCredits: number;
}

export interface ItemDefinition {
  readonly id: ItemId;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly category: ItemCategory;
  readonly volumeCubicDecimetres: CubicDecimetres;
  readonly referenceValueCredits: number;
}

/** Anything that can occupy a cargo hold, be looted, bought or sold. */
export type TradeableDefinition = ItemDefinition | ModuleDefinition | AmmunitionDefinition;

export interface SiteDefinition {
  readonly id: SiteId;
  readonly nameKey: MessageKey;
  readonly kind: SiteKind;
  /** Position inside the system, used for warp distance and the system view. */
  readonly position: { readonly xKm: number; readonly yKm: number };
}

export interface SystemDefinition {
  readonly id: SystemId;
  readonly nameKey: MessageKey;
  /** Fixed by system and never scaled to the player (Functional Specification 5.1). */
  readonly dangerRating: number;
  readonly sites: readonly SiteDefinition[];
}

export interface StationDefinition {
  readonly id: StationId;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly systemId: SystemId;
  readonly siteId: SiteId;
  readonly services: readonly StationService[];
  /** Displayed content value from 0.75 through 1.50 (Functional Specification 10). */
  readonly serviceModifier: number;
  /** A neutral-access station never denies docking on standings. */
  readonly neutralAccess: boolean;
}

export interface MarketListingDefinition {
  readonly stationId: StationId;
  readonly itemId: DefinitionId;
  readonly supply: MarketSupplyKind;
  readonly basePriceCredits: number;
  readonly regionalPriceFactor: number;
  readonly targetStock: number;
  readonly initialStock: number;
  readonly elasticity: number;
  readonly baseSpread: number;
  readonly productionPerHour: number;
  readonly consumptionPerHour: number;
}

export interface NpcProfileDefinition {
  readonly id: NpcProfileId;
  readonly nameKey: MessageKey;
  readonly role: NpcRole;
  readonly hullId: HullId;
  readonly loadout: {
    readonly modules: readonly ModuleId[];
    readonly ammunitionId?: AmmunitionId;
    /**
     * Rounds of that ammunition carried in the hold, so the opponent reloads
     * the way the player does rather than falling silent after one magazine
     * (Functional Specification 9.4, 9.10). Absent means none.
     */
    readonly reserveRounds?: number;
  };
  readonly bountyCredits: number;
  readonly lootTableId: LootTableId;
}

export interface LootEntryDefinition {
  /** An item, module or ammunition definition. */
  readonly itemId: DefinitionId;
  readonly chance: number;
  readonly quantityMinimum: number;
  readonly quantityMaximum: number;
}

export interface LootTableDefinition {
  readonly id: LootTableId;
  readonly entries: readonly LootEntryDefinition[];
}

export interface EncounterSpawnDefinition {
  readonly npcProfileId: NpcProfileId;
  readonly count: number;
  readonly spawnDistanceKm: number;
}

export interface EncounterDefinition {
  readonly id: EncounterId;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly rewardSummaryKey: MessageKey;
  /** Guidance shown before entry, not a hidden gate (MVP Scope 4.2). */
  readonly tier: number;
  readonly systemId: SystemId;
  readonly siteId: SiteId;
  readonly repeatable: boolean;
  readonly spawns: readonly EncounterSpawnDefinition[];
}
