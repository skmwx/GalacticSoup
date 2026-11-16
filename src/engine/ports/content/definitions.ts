import type {
  AmmunitionId,
  AudioCueId,
  CubicDecimetres,
  DefinitionId,
  EncounterId,
  GuidanceId,
  HullId,
  ItemId,
  LootTableId,
  MessageKey,
  ModuleId,
  NotificationId,
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
  'launcher',
  'propulsion',
  'shieldBooster',
  'armorRepairer',
  'resistancePlating',
  'resistanceAmplifier',
  'capacitorBattery',
  'shieldExtender',
  'shieldRecharger',
  'capacitorRecharger',
  'weaponUpgrade',
  'web',
] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

/**
 * Weapon families (FeatureSpec02 5.1, 6.1). Structural: a family decides which
 * charges a weapon loads and which family-restricted modifiers reach it.
 * Projectile and hybrid weapons are turrets; guided weapons are launchers.
 */
export const WEAPON_FAMILIES = ['projectile', 'hybrid', 'guided'] as const;
export type WeaponFamily = (typeof WEAPON_FAMILIES)[number];

export const TURRET_FAMILIES = ['projectile', 'hybrid'] as const;
export type TurretFamily = (typeof TURRET_FAMILIES)[number];

/**
 * The reviewed passive modifier operators (Technical Specification 10.2;
 * FeatureSpec02 5.1). Content names an operator and a positive magnitude; the
 * engine's registry decides which attribute it reaches, how, at which stage,
 * and which module categories may use it, so a category can never carry an
 * effect it does not execute.
 */
export const MODIFIER_OPERATORS = [
  'shieldCapacity',
  'shieldRechargeTime',
  'capacitorRechargeTime',
  'signatureRadius',
  'projectileDamage',
  'hybridDamage',
  'turretTracking',
  'guidedExplosionRadius',
  'guidedExplosionVelocity',
] as const;
export type ModifierOperator = (typeof MODIFIER_OPERATORS)[number];

export interface ModifierDefinition {
  readonly operator: ModifierOperator;
  /** Positive magnitude in the operator's own terms (see the registry). */
  readonly value: number;
}

/** The charge group key a weapon of one family and size loads. */
export function chargeGroupKey(family: WeaponFamily, size: ModuleSize): string {
  return `${size}-${family}`;
}

/**
 * Behaviour roles the selector understands (Functional Specification 9.10).
 * A tackler positions for its speed-control module rather than its guns.
 */
export const NPC_ROLES = ['brawler', 'skirmisher', 'sniper', 'tackler'] as const;
export type NpcRole = (typeof NPC_ROLES)[number];

/**
 * The enemy archetypes of the v0.2 roster (FeatureSpec02 7.1). An archetype is
 * what the player is told to prepare for; it changes no rule. Its behaviour
 * comes from the role and the loadout, and content validation holds each
 * archetype to the modules and role that make it observable.
 */
export const NPC_ARCHETYPES = ['fastFrigate', 'artillery', 'brawler', 'missile', 'controller'] as const;
export type NpcArchetype = (typeof NPC_ARCHETYPES)[number];

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

/** Hull size classes of the combat lineup (FeatureSpec02 4.1). */
export const HULL_CLASSES = ['frigate', 'destroyer', 'cruiser'] as const;
export type HullClass = (typeof HULL_CLASSES)[number];

/** Module sizes a hull may accept (FeatureSpec02 4.1, 5.1). */
export const MODULE_SIZES = ['small', 'medium'] as const;
export type ModuleSize = (typeof MODULE_SIZES)[number];

export interface HullDefinition {
  readonly id: HullId;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  /** Only a player-usable hull may be bought, fitted and undocked by the player. */
  readonly playerUsable: boolean;
  /** The hull's step in the combat lineup. Information only; it changes no rule. */
  readonly hullClass: HullClass;
  /**
   * Module sizes the hull accepts, declared explicitly (FeatureSpec02 4.1).
   * Fitting enforces it once modules carry a size (v0.2 phase 2).
   */
  readonly moduleSizes: readonly ModuleSize[];
  readonly defenses: Readonly<Record<DefenseLayer, LayerDefinition>>;
  readonly shieldRechargeSeconds: number;
  readonly capacitor: { readonly capacity: number; readonly rechargeSeconds: number };
  readonly movement: {
    readonly maxSpeedKmPerSecond: number;
    readonly accelerationKmPerSecondSquared: number;
    readonly brakingKmPerSecondSquared: number;
    readonly turnRateRadiansPerSecond: number;
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
  /**
   * The module's size (Functional Specification 8.4). Every weapon and every
   * sized module states one; a non-sized support module states `suitsSizes`
   * instead. Exactly one of the two is present.
   */
  readonly size?: ModuleSize;
  /** The hull sizes a non-sized support module suits. */
  readonly suitsSizes?: readonly ModuleSize[];
}

export interface TurretModuleDefinition extends ModuleCommon {
  readonly category: 'turret';
  readonly size: ModuleSize;
  readonly turret: {
    readonly family: TurretFamily;
    readonly optimalRangeKm: number;
    readonly falloffKm: number;
    readonly trackingRadiansPerSecond: number;
    readonly signatureResolutionMetres: number;
    readonly damageMultiplier: number;
    readonly magazineSize: number;
  };
}

/**
 * A guided-weapon launcher (Functional Specification 9.4, 9.6). Flight and
 * explosion parameters belong to the charge it fires; the launcher supplies
 * the cycle, the magazine and a damage multiplier.
 */
export interface LauncherModuleDefinition extends ModuleCommon {
  readonly category: 'launcher';
  readonly size: ModuleSize;
  readonly launcher: {
    readonly damageMultiplier: number;
    readonly magazineSize: number;
  };
}

/** A weapon-slot module that fires charges. */
export type WeaponModuleDefinition = TurretModuleDefinition | LauncherModuleDefinition;

/** A passive module whose whole effect is a list of registered modifiers. */
export interface ModifierModuleDefinition extends ModuleCommon {
  readonly category: 'shieldExtender' | 'shieldRecharger' | 'capacitorRecharger' | 'weaponUpgrade';
  readonly modifiers: readonly ModifierDefinition[];
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

/**
 * A targeted speed-reduction module, the web (Functional Specification 9.9;
 * FeatureSpec02 6.3). Each completed cycle applies or refreshes one effect on
 * its locked target that multiplies the target's maximum normal speed by
 * `1 - speedReductionFraction` for `effectDurationSeconds`, by default one
 * cycle.
 */
export interface WebModuleDefinition extends ModuleCommon {
  readonly category: 'web';
  readonly size: ModuleSize;
  readonly activation: { readonly capacitorPerCycle: number; readonly cycleSeconds: number };
  readonly web: {
    readonly rangeKm: number;
    /** Share of maximum speed removed, above 0 and below 1. */
    readonly speedReductionFraction: number;
    /** Absent means one cycle. */
    readonly effectDurationSeconds?: number;
  };
}

/** How long one web application lasts: its stated duration, or one cycle. */
export function webEffectDurationSeconds(module: WebModuleDefinition): number {
  return module.web.effectDurationSeconds ?? module.activation.cycleSeconds;
}

export interface ResistanceModuleDefinition extends ModuleCommon {
  /** Plating hardens armour; an amplifier hardens shields. */
  readonly category: 'resistancePlating' | 'resistanceAmplifier';
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
  | LauncherModuleDefinition
  | PropulsionModuleDefinition
  | RepairModuleDefinition
  | ResistanceModuleDefinition
  | CapacitorModuleDefinition
  | ModifierModuleDefinition
  | WebModuleDefinition;

interface AmmunitionCommon {
  readonly id: AmmunitionId;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  /** The weapon family that loads it (Technical Specification 6.2). */
  readonly family: WeaponFamily;
  /** The weapon size that loads it. */
  readonly size: ModuleSize;
  readonly damagePerShot: DamageProfile;
  readonly volumeCubicDecimetres: CubicDecimetres;
  readonly referenceValueCredits: number;
}

/** A turret charge: it scales the turret's own range and tracking. */
export interface TurretAmmunitionDefinition extends AmmunitionCommon {
  readonly family: TurretFamily;
  readonly optimalRangeMultiplier: number;
  readonly falloffMultiplier: number;
  readonly trackingMultiplier: number;
}

/**
 * A guided charge: the projectile it becomes carries these parameters, fixed
 * at launch (Functional Specification 9.6).
 */
export interface GuidedAmmunitionDefinition extends AmmunitionCommon {
  readonly family: 'guided';
  readonly guided: {
    readonly flightSpeedKmPerSecond: number;
    readonly flightTimeSeconds: number;
    readonly explosionRadiusMetres: number;
    readonly explosionVelocityKmPerSecond: number;
  };
}

export type AmmunitionDefinition = TurretAmmunitionDefinition | GuidedAmmunitionDefinition;

/** The family a weapon module fires. */
export function weaponFamilyOf(module: WeaponModuleDefinition): WeaponFamily {
  return module.category === 'turret' ? module.turret.family : 'guided';
}

/** Whether a module is a weapon that fires charges. */
export function isWeaponModule(module: ModuleDefinition): module is WeaponModuleDefinition {
  return module.category === 'turret' || module.category === 'launcher';
}

/** Rounds one weapon's magazine holds. */
export function magazineSizeOf(module: WeaponModuleDefinition): number {
  return module.category === 'turret' ? module.turret.magazineSize : module.launcher.magazineSize;
}

/** The weapon's own damage multiplier on its charge's listed damage. */
export function weaponDamageMultiplierOf(module: WeaponModuleDefinition): number {
  return module.category === 'turret' ? module.turret.damageMultiplier : module.launcher.damageMultiplier;
}

/** The charge group key of a charge. */
export function chargeGroupOf(charge: AmmunitionDefinition): string {
  return chargeGroupKey(charge.family, charge.size);
}

/** The charge group key a weapon loads. */
export function weaponChargeGroupOf(module: WeaponModuleDefinition): string {
  return chargeGroupKey(weaponFamilyOf(module), module.size);
}

/**
 * Whether a module can load a charge: only a weapon does, and only charges of
 * its own family and size (Functional Specification 9.4). Fitting validity,
 * reloads, resupply and every surface that says which weapon a charge suits
 * ask this one rule.
 */
export function moduleAcceptsCharge(module: ModuleDefinition, charge: AmmunitionDefinition): boolean {
  return isWeaponModule(module) && weaponFamilyOf(module) === charge.family && module.size === charge.size;
}

/**
 * Whether a hull accepts a module's size (Functional Specification 8.4). A
 * sized module needs its size among the hull's; a non-sized one needs one of
 * the sizes it suits to be.
 */
export function hullAcceptsModuleSize(hull: HullDefinition, module: ModuleDefinition): boolean {
  if (module.size !== undefined) return hull.moduleSizes.includes(module.size);
  return (module.suitsSizes ?? []).some((size) => hull.moduleSizes.includes(size));
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
  /**
   * What the player prepares for (FeatureSpec02 7.1); information only. The
   * v0.2 content floor requires ten profiles that state one, two of each.
   */
  readonly archetype?: NpcArchetype;
  readonly hullId: HullId;
  readonly loadout: {
    readonly modules: readonly ModuleId[];
    /**
     * Ammunition per weapon group (Technical Specification 8.3). Each fitted
     * weapon loads the first entry it accepts, so turrets and launchers on one
     * hull keep their own charges. `reserveRounds` of each charge ride in the
     * hold so the opponent reloads the way the player does rather than falling
     * silent after one magazine (Functional Specification 9.4, 9.10).
     */
    readonly ammunition: readonly NpcAmmunitionDefinition[];
  };
  readonly bountyCredits: number;
  readonly lootTableId: LootTableId;
}

export interface NpcAmmunitionDefinition {
  readonly ammunitionId: AmmunitionId;
  /** Rounds of it carried in the hold for reloads; 0 means none. */
  readonly reserveRounds: number;
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

/**
 * How urgent a notification is (Functional Specification 19.7). Structural:
 * the four levels are the specification's, not tuning.
 */
export const NOTIFICATION_SEVERITIES = ['informational', 'opportunity', 'warning', 'danger'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/**
 * What a notification is about. The player configures sound and visibility by
 * category (Functional Specification 19.7).
 */
export const NOTIFICATION_CATEGORIES = [
  'combat',
  'navigation',
  'encounter',
  'station',
  'recovery',
  'guidance',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** How often one notification may be raised. */
export const NOTIFICATION_REPEATS = ['always', 'oncePerSite'] as const;
export type NotificationRepeat = (typeof NOTIFICATION_REPEATS)[number];

/**
 * The registered engine operations a notification can be raised by
 * (Technical Specification 10.6, 12.4). Content chooses an operation and its
 * parameters; it never supplies a condition of its own.
 */
export type NotificationTrigger =
  | { readonly kind: 'hostileLock' }
  | { readonly kind: 'playerSpeedReduced' }
  | { readonly kind: 'playerLayerBelow'; readonly layer: DefenseLayer; readonly fraction: number }
  | { readonly kind: 'playerLayerDamaged'; readonly layer: DefenseLayer }
  | { readonly kind: 'playerModuleStarved'; readonly categories: readonly ModuleCategory[] }
  | { readonly kind: 'playerWeaponStopped'; readonly reasons: readonly string[] }
  | { readonly kind: 'playerWeaponIdle' }
  | { readonly kind: 'playerLockLost'; readonly reasons: readonly string[] }
  | { readonly kind: 'undockedLowCapacitor'; readonly fraction: number }
  | { readonly kind: 'encounterCompleted' }
  | { readonly kind: 'bountyPaid' }
  | { readonly kind: 'wreckCreated' }
  | { readonly kind: 'lootTaken' }
  | { readonly kind: 'shipLost' }
  | { readonly kind: 'insurancePaid' }
  | { readonly kind: 'recoveryShipGranted' }
  | { readonly kind: 'docked' }
  | { readonly kind: 'undocked' }
  | { readonly kind: 'warpArrived' }
  | { readonly kind: 'marketTransaction'; readonly side: 'buy' | 'sell' }
  | { readonly kind: 'repairCompleted' }
  | { readonly kind: 'resupplyCompleted' }
  | { readonly kind: 'insurancePurchased' }
  | { readonly kind: 'fitCommitted' }
  | { readonly kind: 'guidanceStepCompleted' };

export type NotificationTriggerKind = NotificationTrigger['kind'];

export interface NotificationDefinition {
  readonly id: NotificationId;
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  readonly messageKey: MessageKey;
  /** The audible cue, or `null` for a silent notification. */
  readonly cueId: AudioCueId | null;
  /**
   * False for the messages Functional Specification 19.7 forbids hiding
   * completely: ship destruction and save integrity.
   */
  readonly hideable: boolean;
  readonly repeat: NotificationRepeat;
  /** Repeats within this window are grouped into one entry. */
  readonly groupWindowSeconds: number;
  readonly trigger: NotificationTrigger;
}

/** Output channel an audible cue plays on (Technical Specification 12.3). */
export const AUDIO_CHANNELS = ['alert', 'interface', 'effects'] as const;
export type AudioChannel = (typeof AUDIO_CHANNELS)[number];

export const AUDIO_WAVEFORMS = ['sine', 'square', 'triangle', 'sawtooth'] as const;
export type AudioWaveform = (typeof AUDIO_WAVEFORMS)[number];

export interface AudioNoteDefinition {
  readonly frequencyHz: number;
  readonly durationMs: number;
  /** Peak gain from 0 through 1, before the player's volume. */
  readonly gain: number;
}

/**
 * An audible cue, authored as a short tone sequence so the build carries no
 * binary audio (Technical Specification 3.1, 12.4).
 */
export interface AudioCueDefinition {
  readonly id: AudioCueId;
  readonly channel: AudioChannel;
  readonly waveform: AudioWaveform;
  /**
   * The severity this cue speaks for when a message has no definition of its
   * own - a save-integrity failure, which the interface raises.
   */
  readonly defaultFor?: NotificationSeverity;
  readonly notes: readonly AudioNoteDefinition[];
}

/** Where the player carries out a guidance step (Functional Specification 19.5). */
export const GUIDANCE_SURFACES = [
  'station.hub',
  'station.market',
  'station.hangar',
  'station.fitting',
  'station.services',
  'station.ship',
  'station.departure',
  'space',
] as const;
export type GuidanceSurface = (typeof GUIDANCE_SURFACES)[number];

/** Movement orders a guidance step may ask for (Functional Specification 7.1). */
export const GUIDANCE_MOVEMENT_ORDERS = ['approach', 'orbit', 'keepRange', 'moveToPoint'] as const;
export type GuidanceMovementOrder = (typeof GUIDANCE_MOVEMENT_ORDERS)[number];

/**
 * The registered engine operations that complete a guidance step
 * (Technical Specification 10.6). Each reads the campaign's own events or
 * state; content chooses one and its parameters.
 */
export type GuidancePredicate =
  | { readonly kind: 'destinationSelected' }
  | { readonly kind: 'undocked' }
  | { readonly kind: 'encounterEntered'; readonly minimumTier: number }
  | { readonly kind: 'movementOrdered'; readonly orders: readonly GuidanceMovementOrder[] }
  | { readonly kind: 'targetLocked' }
  | { readonly kind: 'weaponFired' }
  | { readonly kind: 'defenseActivated' }
  | { readonly kind: 'encounterCompleted' }
  | { readonly kind: 'lootTaken' }
  | { readonly kind: 'docked' }
  | { readonly kind: 'itemSold' }
  | { readonly kind: 'shipReady'; readonly capacitorFraction: number }
  | { readonly kind: 'ammunitionInHold'; readonly minimumRounds: number }
  | { readonly kind: 'fitCommitted' };

export type GuidancePredicateKind = GuidancePredicate['kind'];

export interface GuidanceStepDefinition {
  readonly id: GuidanceId;
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
  readonly surface: GuidanceSurface;
  /** Steps that must be completed or skipped before this one opens. */
  readonly requires: readonly GuidanceId[];
  readonly skippable: boolean;
  readonly predicate: GuidancePredicate;
}

/**
 * A contextual guidance chain (Functional Specification 3.2, as MVP Scope 3
 * selects it: guidance for the combat loop, not the full introduction).
 */
export interface GuidanceChainDefinition {
  readonly id: GuidanceId;
  readonly titleKey: MessageKey;
  readonly introKey: MessageKey;
  readonly completedKey: MessageKey;
  readonly steps: readonly GuidanceStepDefinition[];
}
