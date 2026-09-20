import { describe, expect, it } from 'vitest';

import {
  assessFit,
  deriveShipAttributes,
  draftFromFit,
  inventoryService,
  isUndockable,
  previewDraft,
  shipFit,
  slotKey,
  stacksIn,
  structuralViolations,
  summariseFit,
  type CampaignDraft,
  type CampaignState,
  type FitDescription,
  type FittingDraft,
} from '@engine/domain';
import { runCommand } from '@engine/application';
import { canonicalJson, type AmmunitionId, type DefinitionId, type ModuleId } from '@shared';

import { testCampaign } from '../../support/campaign';
import { shippedContent } from '../../support/content';

/**
 * Fitting: the draft state machine, the constraints and undock validity
 * (Functional Specification 8.4-8.5; Technical Specification 10.2).
 */

const content = shippedContent();
const AUTOCANNON = 'module.turret.autocannon.small' as ModuleId;
const RAILGUN = 'module.turret.railgun.small' as ModuleId;
const AFTERBURNER = 'module.propulsion.afterburner.small' as ModuleId;
const BOOSTER = 'module.shield.booster.small' as ModuleId;
const PLATING = 'module.plating.armor.small' as ModuleId;
const BATTERY = 'module.capacitor.battery.small' as ModuleId;
const FUSION = 'ammo.projectile.small.fusion' as AmmunitionId;
const IRON = 'ammo.hybrid.small.iron' as AmmunitionId;

function open(): CampaignState {
  return testCampaign();
}

/** Runs a command against `state` and returns the campaign it committed. */
function apply(state: CampaignState, type: Parameters<typeof runCommand>[0]['type'], payload: unknown) {
  return runCommand({ campaign: state, content, type, payload });
}

function committed(
  state: CampaignState,
  type: Parameters<typeof runCommand>[0]['type'],
  payload: unknown,
): CampaignState {
  const result = apply(state, type, payload);
  if (result.kind !== 'committed' || result.campaign === null) {
    throw new Error(`Expected a committed campaign, got ${JSON.stringify(result)}`);
  }
  return result.campaign;
}

function begun(state: CampaignState = open()): CampaignState {
  return committed(state, 'fitting.begin', { shipId: state.assets.activeShipId });
}

function setSlot(
  state: CampaignState,
  slotKind: string,
  slotIndex: number,
  moduleId: string,
  extra: Record<string, unknown> = {},
) {
  return apply(state, 'fitting.set', { slotKind, slotIndex, moduleId, online: true, ...extra });
}

function grant(state: CampaignState, definitionId: string, quantity: number): CampaignState {
  const draft = JSON.parse(JSON.stringify(state)) as CampaignDraft;
  const hangar = Object.values(draft.assets.inventories).find(
    (inventory) => inventory.location.kind === 'hangar',
  );
  inventoryService(draft, content).add(hangar!.id, definitionId as DefinitionId, quantity, {
    grantedQuantity: quantity,
    purchasedQuantity: 0,
    purchaseCostCredits: 0,
  });
  return draft as CampaignState;
}

function fitOf(state: CampaignState): FitDescription {
  return shipFit(state.assets, state.assets.activeShipId);
}

function describeFit(state: CampaignState): readonly string[] {
  return fitOf(state).map(
    (fitted) =>
      `${slotKey(fitted.slot)}=${fitted.moduleId}${fitted.online ? '' : ':offline'}${
        fitted.charge === null ? '' : `+${fitted.charge.ammunitionId}x${String(fitted.charge.quantity)}`
      }`,
  );
}

function hangarOf(state: CampaignState): readonly { definitionId: string; quantity: number }[] {
  const hangar = Object.values(state.assets.inventories).find(
    (inventory) => inventory.location.kind === 'hangar',
  );
  return stacksIn(state.assets, hangar!.id).map((stack) => ({
    definitionId: stack.definitionId,
    quantity: stack.quantity,
  }));
}

describe('the authored starting fit', () => {
  it('is assembled from the granted items and is valid [FUNC-3.1, FUNC-8.4, MVP-AC-02]', () => {
    const state = open();

    expect(describeFit(state)).toEqual([
      `weapon:0=${AUTOCANNON}+${FUSION}x20`,
      `system:0=${BOOSTER}`,
    ]);
    // The magazine took its rounds from the grant; the rest stayed behind.
    expect(hangarOf(state)).toEqual([{ definitionId: FUSION, quantity: 40 }]);

    const hull = content.requireHull(state.assets.ships[state.assets.activeShipId]!.hullId);
    const derived = deriveShipAttributes({ hull, fit: fitOf(state), content });
    expect(isUndockable(assessFit({ hull, fit: fitOf(state), content, derived }))).toBe(true);
  });

  it('leaves the ship undamaged with a full capacitor [FUNC-8.2]', () => {
    const ship = open().assets.ships[open().assets.activeShipId]!;

    expect(ship.condition.damage).toEqual({ shield: 0, armor: 0, hull: 0 });
    expect(ship.condition.capacitorCharge).toBe(
      content.requireHull(ship.hullId).capacitor.capacity,
    );
  });
});

describe('the fitting draft', () => {
  it('opens from the fit the ship wears and changes nothing [FUNC-8.4, TECH-10.2]', () => {
    const state = open();
    const opened = begun(state);

    expect(opened.fitting?.shipId).toBe(state.assets.activeShipId);
    expect(opened.fitting?.baseRevision).toBe(state.revision);
    expect(opened.fitting?.slots).toEqual(
      draftFromFit(state.assets.activeShipId, state.revision, fitOf(state)).slots,
    );
    expect(opened.assets).toEqual(state.assets);
  });

  it('is idempotent for the same ship and refuses a second one [FUNC-22.10]', () => {
    const opened = begun();
    const again = apply(opened, 'fitting.begin', { shipId: opened.assets.activeShipId });
    expect(again.kind).toBe('unchanged');

    const other = apply(opened, 'fitting.begin', { shipId: `${opened.campaignId}-e999` });
    expect(other.kind === 'failed' && other.error.messageKey).toBe(
      'error.ruleViolation.fittingDraftOpen',
    );
  });

  it('refuses to open or commit without an open draft [FUNC-22.10]', () => {
    const state = open();

    for (const type of ['fitting.set', 'fitting.clear', 'fitting.revert', 'fitting.commit'] as const) {
      const result = apply(state, type, {
        slotKind: 'weapon',
        slotIndex: 0,
        moduleId: AUTOCANNON,
        online: true,
      });
      expect(result.kind === 'failed' && result.error.messageKey, type).toBe(
        'error.ruleViolation.fittingDraftClosed',
      );
    }
  });

  it('replaces one slot at a time and reports an unchanged edit [TECH-7.2, TECH-10.2]', () => {
    const opened = begun();
    const changed = setSlot(opened, 'weapon', 0, AUTOCANNON, { ammunitionId: FUSION });
    expect(changed.kind).toBe('unchanged');

    const next = committed(opened, 'fitting.set', {
      slotKind: 'weapon',
      slotIndex: 0,
      moduleId: AUTOCANNON,
      online: false,
      ammunitionId: FUSION,
    });
    expect(next.fitting?.slots['weapon:0']?.online).toBe(false);
    // Nothing physical moved: the draft is only a plan.
    expect(next.assets).toEqual(opened.assets);
  });

  it('clears a slot and ignores clearing an empty one [FUNC-8.4]', () => {
    const opened = begun();
    const cleared = committed(opened, 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 });

    expect(Object.keys(cleared.fitting?.slots ?? {})).toEqual(['system:0']);
    expect(apply(cleared, 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 }).kind).toBe('unchanged');
  });

  it('reverting discards the plan and leaves the ship as it was [FUNC-8.4]', () => {
    const state = open();
    const cleared = committed(begun(state), 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
    const reverted = committed(cleared, 'fitting.revert', {});

    expect(reverted.fitting).toBeNull();
    expect(describeFit(reverted)).toEqual(describeFit(state));
  });

  it('survives being saved and read back [TECH-11.4]', () => {
    const opened = committed(begun(), 'fitting.set', {
      slotKind: 'engineering',
      slotIndex: 0,
      moduleId: PLATING,
      online: true,
    });
    const restored = JSON.parse(JSON.stringify(opened)) as CampaignState;

    expect(restored.fitting).toEqual(opened.fitting);
  });
});

describe('fitting constraints', () => {
  it.each([
    ['a slot the hull does not have', 'weapon', 5, AUTOCANNON, {}, 'slotUnavailable'],
    ['a module of the wrong slot kind', 'weapon', 1, BOOSTER, {}, 'slotKindMismatch'],
    ['ammunition of another group', 'weapon', 1, AUTOCANNON, { ammunitionId: IRON }, 'ammunitionMismatch'],
    ['a charge in something that takes none', 'system', 1, AFTERBURNER, { ammunitionId: FUSION }, 'chargeNotAccepted'],
  ])('refuses %s when the change is made [FUNC-8.4, FUNC-22.10]', (_label, kind, index, moduleId, extra, code) => {
    const opened = begun();
    const result = setSlot(opened, kind, index as number, moduleId, extra as Record<string, unknown>);

    expect(result.kind === 'failed' && result.error.messageKey).toBe(`fitting.violation.${String(code)}`);
    expect(result.kind === 'failed' && result.error.code).toBe('RULE_VIOLATION');
  });

  it('refuses a module or charge that is not in the catalogue [TECH-6.3]', () => {
    const opened = begun();

    expect(setSlot(opened, 'weapon', 1, 'module.missing.turret').kind).toBe('failed');
    const unknownCharge = setSlot(opened, 'weapon', 1, AUTOCANNON, { ammunitionId: 'ammo.missing.round' });
    expect(unknownCharge.kind === 'failed' && unknownCharge.error.messageKey).toBe(
      'fitting.violation.ammunitionUnknown',
    );
  });

  it('counts hardpoints and reports the shortfall [FUNC-8.3, FUNC-8.4]', () => {
    const hull = content.requireHull('hull.independent.starter' as Parameters<typeof content.requireHull>[0]);
    const threeTurrets: FitDescription = [0, 1, 2].map((index) => ({
      slot: { kind: 'weapon' as const, index },
      moduleId: AUTOCANNON,
      online: true,
      charge: null,
      stackId: null,
    }));
    const derived = deriveShipAttributes({ hull, fit: threeTurrets, content });
    const assessment = assessFit({ hull, fit: threeTurrets, content, derived });

    expect(assessment.violations.map((violation) => violation.code).sort()).toEqual([
      'hardpointUnavailable',
      'slotUnavailable',
      'slotUnavailable',
    ]);
    expect(assessment.hardpoints.turret).toEqual({ used: 3, available: 2 });
    expect(isUndockable(assessment)).toBe(false);
  });

  it('lets a fit over-commit the power grid but not undock with it [FUNC-8.4]', () => {
    const state = grant(grant(grant(open(), RAILGUN, 2), AFTERBURNER, 1), BATTERY, 1);
    let opened = begun(state);
    opened = committed(opened, 'fitting.set', { slotKind: 'weapon', slotIndex: 0, moduleId: RAILGUN, online: true });
    opened = committed(opened, 'fitting.set', { slotKind: 'weapon', slotIndex: 1, moduleId: RAILGUN, online: true });
    opened = committed(opened, 'fitting.set', { slotKind: 'system', slotIndex: 1, moduleId: AFTERBURNER, online: true });
    opened = committed(opened, 'fitting.set', { slotKind: 'engineering', slotIndex: 0, moduleId: BATTERY, online: true });

    const applied = committed(opened, 'fitting.commit', {});
    const hull = content.requireHull(applied.assets.ships[applied.assets.activeShipId]!.hullId);
    const fit = fitOf(applied);
    const derived = deriveShipAttributes({ hull, fit, content });
    const assessment = assessFit({ hull, fit, content, derived });

    expect(assessment.power.used).toBeGreaterThan(assessment.power.available);
    expect(assessment.violations.map((violation) => violation.code)).toContain('powerExceeded');
    expect(isUndockable(assessment)).toBe(false);
    // The fit is storable: only a structurally impossible one is refused.
    expect(structuralViolations(assessment.violations)).toEqual([]);

    const offline = committed(
      committed(applied, 'fitting.begin', { shipId: applied.assets.activeShipId }),
      'fitting.set',
      { slotKind: 'weapon', slotIndex: 1, moduleId: RAILGUN, online: false },
    );
    const fixed = committed(offline, 'fitting.commit', {});
    const fixedFit = fitOf(fixed);
    const fixedDerived = deriveShipAttributes({ hull, fit: fixedFit, content });
    expect(isUndockable(assessFit({ hull, fit: fixedFit, content, derived: fixedDerived }))).toBe(true);
  });
});

describe('committing a fit', () => {
  it('moves the physical units and returns what the fit no longer wants [FUNC-8.4, FUNC-22.3]', () => {
    const state = grant(open(), RAILGUN, 1);
    const opened = committed(begun(state), 'fitting.set', {
      slotKind: 'weapon',
      slotIndex: 0,
      moduleId: RAILGUN,
      online: true,
    });
    const applied = committed(opened, 'fitting.commit', {});

    expect(applied.fitting).toBeNull();
    expect(describeFit(applied)).toEqual([`weapon:0=${RAILGUN}`, `system:0=${BOOSTER}`]);
    // The autocannon and its magazine came back to the hangar, whole.
    expect(hangarOf(applied)).toEqual([
      { definitionId: FUSION, quantity: 60 },
      { definitionId: AUTOCANNON, quantity: 1 },
    ]);
    expect(totalUnits(applied)).toEqual(totalUnits(state));
  });

  it('loads a magazine from the local stores and no more than it holds [FUNC-8.4]', () => {
    const cleared = committed(begun(), 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
    const emptied = committed(cleared, 'fitting.commit', {});
    expect(hangarOf(emptied)).toEqual([
      { definitionId: FUSION, quantity: 60 },
      { definitionId: AUTOCANNON, quantity: 1 },
    ]);

    const reloaded = committed(
      committed(
        committed(emptied, 'fitting.begin', { shipId: emptied.assets.activeShipId }),
        'fitting.set',
        { slotKind: 'weapon', slotIndex: 0, moduleId: AUTOCANNON, online: true, ammunitionId: FUSION },
      ),
      'fitting.commit',
      {},
    );

    expect(describeFit(reloaded)).toContain(`weapon:0=${AUTOCANNON}+${FUSION}x20`);
    expect(hangarOf(reloaded)).toEqual([{ definitionId: FUSION, quantity: 40 }]);
  });

  it('refuses atomically when an item the plan needs is not here [FUNC-22.2, FUNC-22.4]', () => {
    const opened = committed(begun(), 'fitting.set', {
      slotKind: 'weapon',
      slotIndex: 1,
      moduleId: RAILGUN,
      online: true,
    });
    const before = canonicalJson(opened);
    const result = apply(opened, 'fitting.commit', {});

    expect(result.kind === 'failed' && result.error.messageKey).toBe(
      'error.ruleViolation.fittingItemsMissing',
    );
    expect(result.kind === 'failed' && result.error.params?.['definitionId']).toBe(RAILGUN);
    expect(canonicalJson(opened)).toBe(before);
  });

  it('refuses to fit anywhere but at a station with the service [FUNC-8.4]', () => {
    const state = open();
    const elsewhere: CampaignState = {
      ...state,
      assets: {
        ...state.assets,
        location: { ...state.assets.location, stationId: 'station.elsewhere' as never },
      },
    };
    const result = apply(elsewhere, 'fitting.begin', { shipId: state.assets.activeShipId });

    expect(result.kind === 'failed' && result.error.messageKey).toBe(
      'error.ruleViolation.fittingUnavailable',
    );
  });

  it('previews exactly what committing would produce [FUNC-22.4, TECH-10.2]', () => {
    const state = grant(open(), PLATING, 1);
    const opened = committed(begun(state), 'fitting.set', {
      slotKind: 'engineering',
      slotIndex: 0,
      moduleId: PLATING,
      online: true,
    });
    const preview = previewDraft({
      campaignId: opened.campaignId,
      nextEntityOrdinal: opened.nextEntityOrdinal,
      assets: opened.assets,
      content,
      draft: opened.fitting as FittingDraft,
    });
    const applied = committed(opened, 'fitting.commit', {});

    expect(preview.ok).toBe(true);
    expect(preview.missing).toEqual([]);
    expect(preview.assets).toEqual(applied.assets);
  });

  it('keeps stored damage and charge inside what the new fit allows [FUNC-4.2, FUNC-8.2]', () => {
    const state = grant(open(), BATTERY, 1);
    const shipId = state.assets.activeShipId;
    const withBattery = committed(
      committed(begun(state), 'fitting.set', {
        slotKind: 'engineering',
        slotIndex: 0,
        moduleId: BATTERY,
        online: true,
      }),
      'fitting.commit',
      {},
    );

    const charged: CampaignState = {
      ...withBattery,
      assets: {
        ...withBattery.assets,
        ships: {
          ...withBattery.assets.ships,
          [shipId]: {
            ...withBattery.assets.ships[shipId]!,
            condition: { damage: { shield: 100, armor: 0, hull: 0 }, capacitorCharge: 370 },
          },
        },
      },
    };

    const removed = committed(
      committed(
        committed(charged, 'fitting.begin', { shipId }),
        'fitting.clear',
        { slotKind: 'engineering', slotIndex: 0 },
      ),
      'fitting.commit',
      {},
    );

    // The battery is gone, so the capacitor cannot still hold its bonus.
    expect(removed.assets.ships[shipId]!.condition.capacitorCharge).toBe(250);
    expect(removed.assets.ships[shipId]!.condition.damage.shield).toBe(100);
  });
});

describe('what a fit does', () => {
  it('reports weapon range, tracking and damage with the loaded charge [FUNC-8.5, MVP-AC-04]', () => {
    const state = open();
    const hull = content.requireHull(state.assets.ships[state.assets.activeShipId]!.hullId);
    const fit = fitOf(state);
    const derived = deriveShipAttributes({ hull, fit, content });
    const summary = summariseFit({ hull, fit, content, derived });
    const turret = content.requireModule(AUTOCANNON);
    if (turret.category !== 'turret') {
      throw new Error('The autocannon must be a turret.');
    }
    const charge = content.requireAmmunition(FUSION);
    const weapon = summary.weapons[0];
    const cycleSeconds = turret.activation?.cycleSeconds ?? 0;

    expect(weapon?.optimalRangeKm).toBeCloseTo(
      turret.turret.optimalRangeKm * charge.optimalRangeMultiplier,
      12,
    );
    expect(weapon?.falloffKm).toBeCloseTo(turret.turret.falloffKm * charge.falloffMultiplier, 12);
    expect(weapon?.absoluteRangeKm).toBeCloseTo(
      (weapon?.optimalRangeKm ?? 0) +
        content.rules.combat.absoluteRangeFalloffMultiples * (weapon?.falloffKm ?? 0),
      12,
    );
    expect(weapon?.volleyDamage).toBe(12);
    expect(weapon?.damagePerSecond).toBeCloseTo(12 / cycleSeconds, 12);
  });

  it('warns about missing ammunition, offline modules and an unstable capacitor [FUNC-8.5, MVP-AC-04]', () => {
    const state = grant(open(), AFTERBURNER, 1);
    const opened = committed(
      committed(begun(state), 'fitting.set', {
        slotKind: 'weapon',
        slotIndex: 0,
        moduleId: AUTOCANNON,
        online: false,
      }),
      'fitting.set',
      { slotKind: 'system', slotIndex: 1, moduleId: AFTERBURNER, online: true },
    );
    const applied = committed(opened, 'fitting.commit', {});
    const hull = content.requireHull(applied.assets.ships[applied.assets.activeShipId]!.hullId);
    const fit = fitOf(applied);
    const summary = summariseFit({
      hull,
      fit,
      content,
      derived: deriveShipAttributes({ hull, fit, content }),
    });

    expect(summary.warnings.map((warning) => warning.code).sort()).toEqual([
      'capacitorUnstable',
      'moduleOffline',
      'noAmmunition',
      'noWeapon',
    ]);
    expect(summary.capacitor.stable).toBe(false);
    expect(summary.capacitor.enduranceSeconds).toBeGreaterThan(0);
  });

  it('estimates burst and sustained repair from the fitted defences [FUNC-8.5]', () => {
    const state = open();
    const hull = content.requireHull(state.assets.ships[state.assets.activeShipId]!.hullId);
    const fit = fitOf(state);
    const summary = summariseFit({
      hull,
      fit,
      content,
      derived: deriveShipAttributes({ hull, fit, content }),
    });
    const booster = content.requireModule(BOOSTER);
    if (booster.category !== 'shieldBooster') {
      throw new Error('The shield booster must be a shield booster.');
    }

    expect(summary.defense.burstHitPoints.shield).toBe(booster.repair.amountHitPoints);
    expect(summary.defense.sustainedHitPointsPerSecond.shield).toBeCloseTo(40 / 4, 12);
    expect(summary.defense.burstHitPoints.armor).toBe(0);
  });
});

/** Every physical unit in the campaign, by definition. */
function totalUnits(state: CampaignState): Readonly<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const stack of Object.values(state.assets.stacks)) {
    totals[stack.definitionId] = (totals[stack.definitionId] ?? 0) + stack.quantity;
  }
  return totals;
}
