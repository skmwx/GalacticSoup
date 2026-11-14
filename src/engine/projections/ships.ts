import { DEFENSE_LAYERS, type ContentRepository } from '@engine/ports';
import {
  assessFit,
  attributeValue,
  capacityRoot,
  deriveShipAttributes,
  shipFit,
  usedVolume,
  type CampaignState,
  type DerivedShipAttributes,
  type ShipIdentity,
} from '@engine/domain';
import type { OwnedShipData, ShipFigureData, ShipsListData } from '@protocol';
import { deepClone, deepFreeze } from '@shared';

/**
 * The player's ships (Functional Specification 6.3, 19.6; FeatureSpec02 4.2).
 *
 * Every ship the player owns, wherever it is, with what the station needs to
 * choose between them: which one is active, which are docked here, whether
 * each could undock, its condition and insurance, and the figures a
 * comparison lines up. Whether a ship can be made active is answered here,
 * from the same rules `ship.activate` applies, so the interface never
 * re-derives them.
 *
 * @implements FUNC-6.3, FUNC-19.6, TECH-7.3, V02-AC-03
 */
export function shipsListProjection(state: CampaignState, content: ContentRepository): ShipsListData {
  const assets = state.assets;
  const here = assets.location.kind === 'station' ? assets.location.stationId : null;
  const ships = Object.keys(assets.ships)
    .sort()
    .map((id) => assets.ships[id]!)
    .filter((ship) => ship.owner === 'player')
    .map((ship) => describe(state, content, ship, here));
  return deepFreeze({
    revision: state.revision,
    activeShipId: assets.activeShipId,
    stationId: here,
    draftShipId: state.fitting?.shipId ?? null,
    ships,
  });
}

function describe(
  state: CampaignState,
  content: ContentRepository,
  ship: ShipIdentity,
  here: string | null,
): OwnedShipData {
  const hull = content.requireHull(ship.hullId);
  const fit = shipFit(state.assets, ship.id);
  const derived = deriveShipAttributes({ hull, fit, content });
  const assessment = assessFit({ hull, fit, content, derived });
  const local = here !== null && ship.location.kind === 'station' && ship.location.stationId === here;
  const active = ship.id === state.assets.activeShipId;
  const cargoRoot = capacityRoot(state.assets, ship.cargoInventoryId);

  return {
    id: ship.id,
    hullId: hull.id,
    nameKey: hull.nameKey,
    descriptionKey: hull.descriptionKey,
    hullClass: hull.hullClass,
    moduleSizes: [...hull.moduleSizes],
    traitKeys: [...hull.traitKeys],
    active,
    local,
    location: deepClone(ship.location),
    cargoInventoryId: ship.cargoInventoryId,
    cargoUsedCubicDecimetres: usedVolume(state.assets, content, ship.cargoInventoryId),
    cargoCapacityCubicDecimetres: cargoRoot.capacity.kind === 'limited' ? cargoRoot.capacity.volumeCubicDecimetres : 0,
    fittedModules: fit.length,
    undockable: assessment.violations.length === 0,
    layers: DEFENSE_LAYERS.map((layer) => {
      const maximumHitPoints = attributeValue(derived, `${layer}HitPoints`);
      return { layer, maximumHitPoints, hitPoints: Math.max(0, maximumHitPoints - ship.condition.damage[layer]) };
    }),
    capacitorCharge: ship.condition.capacitorCharge,
    insuranceCoverage: ship.insurance.coverage,
    recoveryGrant: ship.recoveryGrant,
    referenceValueCredits: hull.referenceValueCredits,
    figures: figuresOf(derived, hull.slots, hull.hardpoints, hull.referenceValueCredits),
    activation: activationOf(state, active, local, here),
  };
}

/** The same order of checks `ship.activate` makes, as a projected reason. */
function activationOf(
  state: CampaignState,
  active: boolean,
  local: boolean,
  here: string | null,
): OwnedShipData['activation'] {
  const reason = here === null
    ? 'error.ruleViolation.shipSwitchInSpace'
    : !local
      ? 'error.ruleViolation.shipNotLocal'
      : active
        ? 'ships.activation.alreadyActive'
        : state.fitting !== null
          ? 'error.ruleViolation.fittingDraftOpen'
          : null;
  return { available: reason === null, unavailableReason: reason };
}

const FIGURES: readonly (readonly [string, 'higher' | 'lower'])[] = [
  ['shieldHitPoints', 'higher'],
  ['armorHitPoints', 'higher'],
  ['hullHitPoints', 'higher'],
  ['capacitorCapacity', 'higher'],
  ['maxSpeedKmPerSecond', 'higher'],
  ['turnRateRadiansPerSecond', 'higher'],
  ['signatureRadiusMetres', 'lower'],
  ['maxLockRangeKm', 'higher'],
  ['maxLockedTargets', 'higher'],
  ['powerOutput', 'higher'],
  ['processingOutput', 'higher'],
  ['cargoCapacityCubicDecimetres', 'higher'],
];

function figuresOf(
  derived: DerivedShipAttributes,
  slots: Readonly<Record<string, number>>,
  hardpoints: Readonly<Record<string, number>>,
  referenceValueCredits: number,
): readonly ShipFigureData[] {
  const figures: ShipFigureData[] = FIGURES.map(([key, better]) => ({
    key,
    labelKey: `stat.${key}`,
    value: attributeValue(derived, key),
    better,
  }));
  for (const kind of ['weapon', 'system', 'engineering'] as const) {
    figures.push({ key: `${kind}Slots`, labelKey: `ships.figure.${kind}Slots`, value: slots[kind] ?? 0, better: 'higher' });
  }
  for (const kind of ['turret', 'launcher'] as const) {
    figures.push({
      key: `${kind}Hardpoints`, labelKey: `ships.figure.${kind}Hardpoints`, value: hardpoints[kind] ?? 0, better: 'higher',
    });
  }
  // Replacement cost is a disadvantage of a larger hull (FeatureSpec02 2, 4.1).
  figures.push({ key: 'referenceValueCredits', labelKey: 'stat.referenceValueCredits', value: referenceValueCredits, better: 'lower' });
  return figures;
}
