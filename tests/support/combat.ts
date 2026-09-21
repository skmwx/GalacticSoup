import {
  allocateEntityId,
  applyDraftTo,
  instantiateSite,
  inventoryService,
  shipFit,
  slotKey,
  stacksIn,
  type CampaignDraft,
  type EntityId,
  type SiteLocation,
} from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type { AmmunitionId, HullId, ModuleId, SiteId, StationId } from '@shared';

import { INSTALLED_BOUNDARY_RESOLVERS } from '@engine/application';
import { advanceCombat, advanceNavigation, advanceTime } from '@engine/simulation';

import { testDraft, testSimulation, type TestSimulation } from './campaign.ts';
import { shippedContent } from './content.ts';

/**
 * A loaded combat site with the player's ship and one test-target ship.
 *
 * Phase 11 delivers the targeting and weapon machinery, not the encounter that
 * populates a site: the authored spawns arrive with the encounter lifecycle.
 * The target here is therefore built by the test, and it is an ordinary ship
 * with an ordinary fit, so it exercises exactly the code an opponent will.
 */

export const COMBAT_SITE_ID = 'site.borrell.verge' as SiteId;
export const STATION_SITE_ID = 'site.borrell.station' as SiteId;
export const AUTOCANNON = 'module.turret.autocannon.small' as ModuleId;
export const RAILGUN = 'module.turret.railgun.small' as ModuleId;
export const AFTERBURNER = 'module.propulsion.afterburner.small' as ModuleId;
export const ARMOR_PLATING = 'module.plating.armor.small' as ModuleId;
export const CAPACITOR_BATTERY = 'module.capacitor.battery.small' as ModuleId;
export const FUSION = 'ammo.projectile.small.fusion' as AmmunitionId;
export const PHASED = 'ammo.projectile.small.phased' as AmmunitionId;
export const IRON = 'ammo.hybrid.small.iron' as AmmunitionId;

export interface CombatFixture {
  readonly draft: CampaignDraft;
  readonly content: ContentRepository;
  readonly context: TestSimulation;
  readonly playerId: EntityId;
  readonly targetId: EntityId;
}

export interface CombatFixtureOptions {
  /** The site to load. Defaults to the combat site, which holds no station. */
  readonly siteId?: SiteId;
  /** Where the player's ship sits, in kilometres. */
  readonly playerPositionKm?: { readonly x: number; readonly y: number };
  /** Where the target sits relative to the player, in kilometres. */
  readonly targetPositionKm?: { readonly x: number; readonly y: number };
  readonly targetVelocityKmPerSecond?: { readonly x: number; readonly y: number };
  /** Rounds of each kind moved into the player's cargo hold. */
  readonly playerCargoRounds?: readonly { readonly ammunitionId: AmmunitionId; readonly rounds: number }[];
  /** Give the target a turret of its own so it can return fire. */
  readonly armTarget?: boolean;
  /** Refit the player's first weapon slot before undocking. */
  readonly playerTurret?: {
    readonly moduleId: ModuleId;
    readonly ammunitionId: AmmunitionId;
    readonly rounds?: number;
  };
  /** Refit the player's first system slot before undocking. */
  readonly playerSystemModule?: ModuleId;
  /** Refit the player's first engineering slot before undocking. */
  readonly playerEngineeringModule?: ModuleId;
}

export function combatFixture(options: CombatFixtureOptions = {}): CombatFixture {
  const content = shippedContent();
  const draft = testDraft();
  const playerId = draft.assets.activeShipId as EntityId;
  const player = draft.assets.ships[playerId];
  if (player === undefined) throw new Error('The test campaign has no active ship.');

  const station = content.requireStation(content.rules.economy.startingStationId as StationId);
  const hangar = hangarOf(draft, station.id);
  const service = inventoryService(draft, content);

  for (const entry of options.playerCargoRounds ?? []) {
    const source = stacksIn(draft.assets, hangar).find(
      (stack) => stack.definitionId === entry.ammunitionId && stack.state.kind === 'plain',
    );
    if (source === undefined) {
      service.add(player.cargoInventoryId, entry.ammunitionId, entry.rounds, granted(entry.rounds));
    } else {
      service.transfer(source.id, player.cargoInventoryId, Math.min(entry.rounds, source.quantity));
    }
  }

  if (
    options.playerTurret !== undefined ||
    options.playerSystemModule !== undefined ||
    options.playerEngineeringModule !== undefined
  ) {
    const slots = Object.fromEntries(shipFit(draft.assets, playerId).map((fitted) => [
      slotKey(fitted.slot),
      {
        moduleId: fitted.moduleId,
        online: fitted.online,
        ammunitionId: fitted.charge?.ammunitionId ?? null,
      },
    ]));
    const turret = options.playerTurret;
    if (turret !== undefined) {
      service.add(hangar, turret.moduleId, 1, granted(1));
      service.add(hangar, turret.ammunitionId, turret.rounds ?? 25, granted(turret.rounds ?? 25));
      slots[FIRST_WEAPON] = {
        moduleId: turret.moduleId,
        online: true,
        ammunitionId: turret.ammunitionId,
      };
    }
    if (options.playerSystemModule !== undefined) {
      service.add(hangar, options.playerSystemModule, 1, granted(1));
      slots[FIRST_SYSTEM] = {
        moduleId: options.playerSystemModule,
        online: true,
        ammunitionId: null,
      };
    }
    if (options.playerEngineeringModule !== undefined) {
      service.add(hangar, options.playerEngineeringModule, 1, granted(1));
      slots[FIRST_ENGINEERING] = {
        moduleId: options.playerEngineeringModule,
        online: true,
        ammunitionId: null,
      };
    }
    const missing = applyDraftTo(draft, content, {
      shipId: playerId,
      baseRevision: draft.revision,
      slots,
    });
    if (missing.length > 0) {
      throw new Error(`The player could not be refitted: ${missing[0]?.definitionId ?? ''}`);
    }
  }

  const targetId = options.armTarget === false ? unarmedTarget(draft, content) : armedTarget(draft, content, station.id);

  const siteId = options.siteId ?? COMBAT_SITE_ID;
  const location: SiteLocation = {
    kind: 'site',
    systemId: station.systemId,
    siteId,
  };
  draft.navigation.currentSite = instantiateSite(
    draft,
    content,
    siteId,
    { ...player, location },
    { ...(options.playerPositionKm ?? { x: 0, y: 0 }) },
    0,
  );
  draft.assets.location = location;
  draft.navigation.movement = { kind: 'stop' };

  const shipEntry = draft.assets.ships[playerId];
  if (shipEntry !== undefined) shipEntry.location = location;

  const targetShip = draft.assets.ships[targetId];
  const hull = content.requireHull(targetShip?.hullId ?? ('' as HullId));
  if (targetShip !== undefined) targetShip.location = location;
  draft.navigation.currentSite.objects[targetId] = {
    id: targetId,
    kind: 'ship',
    definitionId: hull.id,
    nameKey: hull.nameKey,
    position: { ...(options.targetPositionKm ?? { x: 5, y: 0 }) },
    velocity: { ...(options.targetVelocityKmPerSecond ?? { x: 0, y: 0 }) },
    facingRadians: Math.PI,
    radiusKm: hull.signatureRadiusMetres / 2000,
    movable: true,
  };
  draft.assets.version += 1;

  return { draft, content, context: testSimulation(draft, content), playerId, targetId };
}

/** The slot key of the player's and the target's first weapon. */
export const FIRST_WEAPON = slotKey({ kind: 'weapon', index: 0 });
export const FIRST_SYSTEM = slotKey({ kind: 'system', index: 0 });
export const FIRST_ENGINEERING = slotKey({ kind: 'engineering', index: 0 });

function armedTarget(
  draft: CampaignDraft,
  content: ContentRepository,
  stationId: StationId,
): EntityId {
  const shipId = createTargetShip(draft, content, stationId);
  const hangar = hangarOf(draft, stationId);
  const service = inventoryService(draft, content);
  service.add(hangar, AUTOCANNON, 1, granted(1));
  service.add(hangar, FUSION, 20, granted(20));
  const missing = applyDraftTo(draft, content, {
    shipId,
    baseRevision: draft.revision,
    slots: { [FIRST_WEAPON]: { moduleId: AUTOCANNON, online: true, ammunitionId: FUSION } },
  });
  if (missing.length > 0) throw new Error(`The test target could not be fitted: ${missing[0]?.definitionId ?? ''}`);
  return shipId;
}

function unarmedTarget(draft: CampaignDraft, content: ContentRepository): EntityId {
  return createTargetShip(draft, content, content.rules.economy.startingStationId as StationId);
}

function createTargetShip(
  draft: CampaignDraft,
  content: ContentRepository,
  stationId: StationId,
): EntityId {
  const station = content.requireStation(stationId);
  const hull = content.requireHull(content.rules.economy.starterHullId as HullId);
  const shipId = allocateEntityId(draft);
  const service = inventoryService(draft, content);
  const cargo = service.create(
    { kind: 'cargo', shipId },
    { kind: 'limited', volumeCubicDecimetres: hull.cargoCapacityCubicDecimetres },
  );
  const fitting = service.create({ kind: 'fitting', shipId }, { kind: 'unlimited' });
  draft.assets.ships[shipId] = {
    id: shipId,
    hullId: hull.id,
    cargoInventoryId: cargo,
    fittingInventoryId: fitting,
    location: { kind: 'station', stationId: station.id, systemId: station.systemId },
    condition: {
      damage: { shield: 0, armor: 0, hull: 0 },
      capacitorCharge: hull.capacitor.capacity,
    },
    insurance: { coverage: 'basic', premiumPaidCredits: 0 },
  };
  return shipId;
}

function hangarOf(draft: CampaignDraft, stationId: string): string {
  const hangar = Object.values(draft.assets.inventories).find(
    (inventory) => inventory.location.kind === 'hangar' && inventory.location.stationId === stationId,
  );
  if (hangar === undefined) throw new Error('The test campaign has no station hangar.');
  return hangar.id;
}

function granted(quantity: number) {
  return { grantedQuantity: quantity, purchasedQuantity: 0, purchaseCostCredits: 0 };
}

/**
 * Advances the fixture by whole milliseconds of real time at 1x, running the
 * same continuous systems and boundary resolvers the shipped engine installs.
 */
export function advance(fixture: CombatFixture, elapsedRealMs: number): void {
  fixture.draft.time.paused = false;
  let remaining = elapsedRealMs;
  const cap = fixture.content.rules.time.maxFrameDeltaMs;
  while (remaining > 0) {
    const step = Math.min(remaining, cap);
    advanceTime(fixture.context, step, INSTALLED_BOUNDARY_RESOLVERS, [
      advanceNavigation,
      advanceCombat,
    ]);
    remaining -= step;
  }
}

/** The kinds of the events the fixture has published, in order. */
export function eventKinds(fixture: CombatFixture): readonly string[] {
  return fixture.context.events.map((event) => event.kind);
}
