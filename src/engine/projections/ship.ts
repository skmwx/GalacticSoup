import {
  DAMAGE_TYPES,
  DEFENSE_LAYERS,
  HARDPOINT_KINDS,
  SLOT_KINDS,
  type ContentRepository,
  type DefenseLayer,
  type HardpointKind,
  type HullDefinition,
  type SlotKind,
} from '@engine/ports';
import {
  assessFit,
  attributeValue,
  deriveShipAttributes,
  draftMatchesFit,
  fitFromDraft,
  InventoryError,
  previewDraft,
  resistanceAttribute,
  shipFit,
  slotKey,
  summariseFit,
  type CampaignState,
  type DerivedShipAttributes,
  type FitDescription,
  type FitIssue,
  type FitSummary,
  type FittingDraft,
  type ResourceUse,
  type ShipIdentity,
  type SlotRef,
} from '@engine/domain';
import { fitViolationMessageKey, fitWarningMessageKey, UNDOCK_INVALID_FIT_KEY } from '@protocol';
import type {
  DerivedStatData,
  FitIssueData,
  FittedSlotData,
  FittingCandidateData,
  FittingDraftData,
  FormulaTraceData,
  LayerConditionData,
  MissingItemData,
  ItemData,
  OpenFittingDraftData,
  PlannedSlotData,
  ResourceUseData,
  ShipData,
  SlotCandidatesData,
  UndockValidityData,
  WeaponStatData,
} from '@protocol';
import { deepClone, deepFreeze } from '@shared';

import { itemDataOf } from './items';

/**
 * Ship, fitting-draft and undock-validity view models
 * (Functional Specification 8.2-8.5, 19.6; Technical Specification 7.3).
 *
 * The fitting screen needs more than a list of slots: it needs what the fit
 * does, why a value is what it is, what is still missing and whether the ship
 * may leave the station. All of it is derived here from authoritative state
 * and copied into immutable view models, so no interface code can hold a
 * mutable piece of the engine or recompute a rule for itself.
 *
 * @implements FUNC-8.2, FUNC-8.4, FUNC-8.5, FUNC-19.6, TECH-7.3, TECH-10.2
 */

export function shipProjection(
  state: CampaignState,
  content: ContentRepository,
  shipId: string,
): ShipData {
  const ship = state.assets.ships[shipId];
  if (ship === undefined) {
    throw new InventoryError('itemNotFound');
  }
  return deepFreeze(describeShip(state, content, ship, shipFit(state.assets, shipId)));
}

export function undockValidityProjection(
  state: CampaignState,
  content: ContentRepository,
  shipId: string,
): UndockValidityData {
  const ship = state.assets.ships[shipId];
  if (ship === undefined) {
    throw new InventoryError('itemNotFound');
  }
  const hull = content.requireHull(ship.hullId);
  const fit = shipFit(state.assets, shipId);
  const derived = deriveShipAttributes({ hull, fit, content });
  const assessment = assessFit({ hull, fit, content, derived });
  const undockable = assessment.violations.length === 0;

  return deepFreeze({
    revision: state.revision,
    shipId,
    undockable,
    violations: assessment.violations.map(issueData(fitViolationMessageKey)),
    unavailableReason: undockable ? null : UNDOCK_INVALID_FIT_KEY,
  });
}

export function fittingDraftProjection(
  state: CampaignState,
  content: ContentRepository,
): FittingDraftData {
  const draft = state.fitting;
  if (draft === null) {
    return deepFreeze({ revision: state.revision, draft: null });
  }
  return deepFreeze({ revision: state.revision, draft: describeDraft(state, content, draft) });
}

function describeDraft(
  state: CampaignState,
  content: ContentRepository,
  draft: FittingDraft,
): OpenFittingDraftData {
  const preview = previewDraft({
    campaignId: state.campaignId,
    nextEntityOrdinal: state.nextEntityOrdinal,
    assets: state.assets,
    content,
    draft,
  });

  const committable = preview.ok && preview.missing.length === 0;

  return {
    shipId: draft.shipId,
    baseRevision: draft.baseRevision,
    changed: !draftMatchesFit(draft, shipFit(state.assets, draft.shipId)),
    slots: plannedSlots(draft, content),
    missing: preview.missing.map((missing) => missingData(missing, content)),
    committable,
    blockedReason:
      preview.failureReason === null ? null : `error.ruleViolation.${preview.failureReason}`,
    preview: previewShip(state, content, draft, preview, committable),
    options: slotCandidates(state, content, draft.shipId),
  };
}

/**
 * What the player may put in each slot (Functional Specification 8.4;
 * Technical Specification 12.3).
 *
 * Compatibility is a content rule, so it is decided here and offered as a
 * list. A module counts as available when the local hangar, the ship's own
 * hold or the ship itself can supply it, which is exactly where a commit
 * looks for it. Ammunition is offered per module, because which charges a
 * turret accepts depends on the turret.
 */
function slotCandidates(
  state: CampaignState,
  content: ContentRepository,
  shipId: string,
): readonly SlotCandidatesData[] {
  const ship = state.assets.ships[shipId];
  if (ship === undefined) {
    return [];
  }
  const hull = content.requireHull(ship.hullId);
  const owned = localDefinitionCounts(state, ship);
  const modules = [...owned.keys()]
    .sort()
    .flatMap((definitionId) => content.module(definitionId) ?? []);

  return SLOT_KINDS.flatMap((kind) => {
    const slots: SlotCandidatesData[] = [];
    for (let index = 0; index < hull.slots[kind]; index += 1) {
      const candidates: FittingCandidateData[] = modules
        .filter(
          (module) =>
            module.slot === kind &&
            (module.hardpoint === undefined || hull.hardpoints[module.hardpoint] > 0),
        )
        .map((module) => ({
          module: itemDataOf(module, content),
          category: module.category,
          hardpoint: module.hardpoint ?? null,
          powerUse: module.fitting.powerUse,
          processingUse: module.fitting.processingUse,
          available: owned.get(module.id) ?? 0,
          charges:
            module.category === 'turret'
              ? ownedCharges(content, owned, module.turret.ammunitionGroup)
              : [],
        }));
      slots.push({ slot: { kind, index }, candidates });
    }
    return slots;
  });
}

/** Ammunition of one group the player holds locally, in stable id order. */
function ownedCharges(
  content: ContentRepository,
  owned: ReadonlyMap<string, number>,
  group: string,
): readonly ItemData[] {
  return content
    .ammunitionInGroup(group)
    .filter((ammunition) => (owned.get(ammunition.id) ?? 0) > 0)
    .map((ammunition) => itemDataOf(ammunition, content));
}

/**
 * Units of each definition the ship's own stores and its station hangar hold,
 * counting what the ship currently wears: a commit takes an unwanted module
 * off before it refits, so a fitted module is a source like any other.
 */
function localDefinitionCounts(
  state: CampaignState,
  ship: ShipIdentity,
): ReadonlyMap<string, number> {
  const sources = new Set<string>([ship.cargoInventoryId, ship.fittingInventoryId]);
  for (const inventory of Object.values(state.assets.inventories)) {
    if (
      inventory.location.kind === 'hangar' &&
      ship.location.kind === 'station' && inventory.location.stationId === ship.location.stationId
    ) {
      sources.add(inventory.id);
    }
  }

  const counts = new Map<string, number>();
  for (const stack of Object.values(state.assets.stacks)) {
    if (!sources.has(stack.inventoryId)) {
      continue;
    }
    counts.set(stack.definitionId, (counts.get(stack.definitionId) ?? 0) + stack.quantity);
  }
  return counts;
}

/**
 * What the draft would leave behind.
 *
 * A draft that can be committed is previewed from the assets committing would
 * produce, so the preview and the commit cannot disagree
 * (Functional Specification 22.4). A draft that cannot - because an item is
 * missing or a hold is full - is previewed from the fit it describes instead,
 * so the player can still see what they are aiming at alongside the reason it
 * is unavailable.
 */
function previewShip(
  state: CampaignState,
  content: ContentRepository,
  draft: FittingDraft,
  preview: ReturnType<typeof previewDraft>,
  committable: boolean,
): ShipData | null {
  const ship = state.assets.ships[draft.shipId];
  if (ship === undefined) {
    return null;
  }
  if (!committable || preview.assets === null) {
    return describeShip(state, content, ship, fitFromDraft(draft, content));
  }
  return describeShip(
    { ...state, assets: preview.assets },
    content,
    preview.assets.ships[draft.shipId] ?? ship,
    shipFit(preview.assets, draft.shipId),
  );
}

function describeShip(
  state: CampaignState,
  content: ContentRepository,
  ship: ShipIdentity,
  fit: FitDescription,
): ShipData {
  const hull = content.requireHull(ship.hullId);
  const derived = deriveShipAttributes({ hull, fit, content });
  const assessment = assessFit({ hull, fit, content, derived });
  const summary = summariseFit({ hull, fit, content, derived });

  return {
    revision: state.revision,
    id: ship.id,
    hullId: hull.id,
    nameKey: hull.nameKey,
    descriptionKey: hull.descriptionKey,
    traitKeys: [...hull.traitKeys],
    active: ship.id === state.assets.activeShipId,
    location: deepClone(ship.location),
    cargoInventoryId: ship.cargoInventoryId,
    fittingInventoryId: ship.fittingInventoryId,
    slots: slotData(hull, fit, content),
    slotUse: resourceData(SLOT_KINDS, assessment.slots),
    hardpointUse: resourceData(HARDPOINT_KINDS, assessment.hardpoints),
    power: useData(assessment.power),
    processing: useData(assessment.processing),
    attributes: statData(derived),
    layers: layerData(ship, derived),
    capacitor: {
      charge: ship.condition.capacitorCharge,
      capacity: summary.capacitor.capacity,
      rechargeSeconds: summary.capacitor.rechargeSeconds,
      rechargePerSecond: summary.capacitor.rechargePerSecond,
      drainPerSecond: summary.capacitor.drainPerSecond,
      stable: summary.capacitor.stable,
      enduranceSeconds: summary.capacitor.enduranceSeconds,
      ...capacitorRecharge(ship.condition.capacitorCharge, summary.capacitor.capacity,
        summary.capacitor.rechargeSeconds),
    },
    weapons: weaponData(summary),
    defense: {
      burstHitPoints: { ...summary.defense.burstHitPoints },
      sustainedHitPointsPerSecond: { ...summary.defense.sustainedHitPointsPerSecond },
    },
    violations: assessment.violations.map(issueData(fitViolationMessageKey)),
    warnings: summary.warnings.map(issueData(fitWarningMessageKey)),
    undockable: assessment.violations.length === 0,
    recoveryGrant: ship.recoveryGrant,
    insuranceCoverage: ship.insurance.coverage,
  };
}

/** Every slot the hull offers, occupied or not, in stable order. */
function slotData(
  hull: HullDefinition,
  fit: FitDescription,
  content: ContentRepository,
): readonly FittedSlotData[] {
  const occupied = new Map(fit.map((fitted) => [slotKey(fitted.slot), fitted]));
  const slots: FittedSlotData[] = [];

  for (const kind of SLOT_KINDS) {
    for (let index = 0; index < hull.slots[kind]; index += 1) {
      const slot: SlotRef = { kind, index };
      const fitted = occupied.get(slotKey(slot));
      const module = fitted === undefined ? undefined : content.module(fitted.moduleId);
      const loaded = fitted?.charge ?? null;
      const charge = loaded === null ? undefined : content.ammunition(loaded.ammunitionId);

      slots.push({
        slot: { ...slot },
        module: module === undefined ? null : itemDataOf(module, content),
        online: fitted?.online ?? false,
        charge:
          loaded === null || charge === undefined
            ? null
            : { item: itemDataOf(charge, content), quantity: loaded.quantity, stackId: loaded.stackId },
        stackId: fitted?.stackId ?? null,
        powerUse: module?.fitting.powerUse ?? 0,
        processingUse: module?.fitting.processingUse ?? 0,
        category: module?.category ?? null,
        hardpoint: module?.hardpoint ?? null,
      });
    }
  }

  return slots;
}

function statData(derived: DerivedShipAttributes): readonly DerivedStatData[] {
  return Object.keys(derived.attributes)
    .sort()
    .map((attribute) => {
      const value = derived.attributes[attribute];
      return {
        attribute,
        labelKey: `stat.${attribute}`,
        base: value?.base ?? 0,
        value: value?.value ?? 0,
        clamped: value?.clamped ?? false,
        steps: (value?.steps ?? []).map((step) => ({ ...step })),
      };
    });
}

function layerData(
  ship: ShipIdentity,
  derived: DerivedShipAttributes,
): readonly LayerConditionData[] {
  return DEFENSE_LAYERS.map((layer: DefenseLayer) => {
    const maximumHitPoints = attributeValue(derived, `${layer}HitPoints`);
    return {
      layer,
      maximumHitPoints,
      hitPoints: Math.max(0, maximumHitPoints - ship.condition.damage[layer]),
      resistances: DAMAGE_TYPES.map((damageType) => ({
        damageType,
        value: attributeValue(derived, resistanceAttribute(layer, damageType)),
      })),
    };
  });
}

function weaponData(summary: FitSummary): readonly WeaponStatData[] {
  return summary.weapons.map((weapon) => ({
    ...weapon,
    slot: { ...weapon.slot },
    damagePerShot: { ...weapon.damagePerShot },
  }));
}

function plannedSlots(
  draft: FittingDraft,
  content: ContentRepository,
): readonly PlannedSlotData[] {
  return Object.keys(draft.slots)
    .sort()
    .flatMap((key) => {
      const planned = draft.slots[key];
      const [kind, index] = key.split(':');
      if (planned === undefined || kind === undefined || index === undefined) {
        return [];
      }
      const module = content.module(planned.moduleId);
      const charge =
        planned.ammunitionId === null ? undefined : content.ammunition(planned.ammunitionId);
      return [
        {
          slot: { kind, index: Number(index) },
          module: module === undefined ? null : itemDataOf(module, content),
          online: planned.online,
          charge: charge === undefined ? null : itemDataOf(charge, content),
        },
      ];
    });
}

function missingData(
  missing: { readonly definitionId: string; readonly required: number; readonly available: number },
  content: ContentRepository,
): MissingItemData {
  return {
    definitionId: missing.definitionId,
    nameKey: content.tradeable(missing.definitionId)?.nameKey ?? missing.definitionId,
    required: missing.required,
    available: missing.available,
  };
}

function issueData<TCode extends string>(
  messageKey: (code: string) => string,
): (issue: FitIssue<TCode>) => FitIssueData {
  return (issue) => ({
    code: issue.code,
    messageKey: messageKey(issue.code),
    slot: issue.slot === null ? null : { ...issue.slot },
    params: { ...issue.params },
  });
}

function useData(use: ResourceUse): ResourceUseData {
  return { used: use.used, available: use.available };
}

function resourceData<TKey extends SlotKind | HardpointKind>(
  keys: readonly TKey[],
  use: Readonly<Record<TKey, ResourceUse>>,
): Readonly<Record<string, ResourceUseData>> {
  const map: Record<string, ResourceUseData> = {};
  for (const key of keys) {
    map[key] = useData(use[key]);
  }
  return map;
}

/**
 * How long the capacitor takes to fill from its current charge
 * (Functional Specification 9.8, 19.6): the missing charge over the recharge
 * rate, capacity divided by recharge time. It is an explanation, not a rule -
 * the recharge itself happens in the simulation.
 */
function capacitorRecharge(
  charge: number,
  capacity: number,
  rechargeSeconds: number,
): { readonly secondsToFull: number; readonly rechargeTrace: FormulaTraceData } {
  const rate = rechargeSeconds > 0 ? capacity / rechargeSeconds : 0;
  const missing = Math.max(0, capacity - charge);
  const secondsToFull = missing === 0 || rate <= 0 ? 0 : missing / rate;
  return {
    secondsToFull,
    rechargeTrace: {
      formulaKey: 'combat.formula.capacitorRecharge',
      operands: [
        { key: 'capacity', value: capacity },
        { key: 'charge', value: charge },
        { key: 'rechargeSeconds', value: rechargeSeconds },
      ],
      unroundedResult: secondsToFull,
      displayResult: Math.round(secondsToFull * 10) / 10,
    },
  };
}
