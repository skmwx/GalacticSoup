import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { draftOf, type CampaignState } from '@engine';
import { shipFit } from '@engine/domain';
import { fittingDraftProjection, shipProjection } from '@engine/projections';

import { REPO_ROOT } from '../../config/aliases.mjs';
import { shippedContent } from '../support/content.ts';
import { buy, command, newCampaign, reasonOf, refusal, withCredits } from '../support/loss.ts';

/**
 * The v0.2 fitting catalog through the real command pipeline
 * (Functional Specification 8.4-8.5, 9.7; FeatureSpec02 5.1-5.3; v0.2
 * Implementation Plan phases 2-3).
 *
 * Every reference fit is bought at the starting station and committed to its
 * hull; a size the hull does not accept is refused when it is set; derived
 * statistics carry the new operators with their traces; and fitting and
 * removing modules repeatedly creates no capacitor and repairs nothing.
 */

const content = shippedContent();

interface ReferenceFit {
  readonly id: string;
  readonly hullId: string;
  readonly modules: readonly { readonly moduleId: string; readonly ammunitionId?: string }[];
  readonly reserve: readonly { readonly ammunitionId: string; readonly quantity: number }[];
}

const REFERENCE_FITS = (JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'content', 'balance', 'reference-fits.json'), 'utf8'),
) as { fits: ReferenceFit[] }).fits;

function wealthy(): CampaignState {
  return withCredits(newCampaign(), 2_000_000);
}

function shipOf(state: CampaignState, hullId: string): string {
  const found = Object.values(state.assets.ships).find((ship) => ship.owner === 'player' && ship.hullId === hullId);
  if (found === undefined) throw new Error(`No ${hullId}.`);
  return found.id;
}

/** Buys the hull (unless it is the starter) and everything the fit needs, then commits it. */
function assemble(fit: ReferenceFit): { readonly state: CampaignState; readonly shipId: string } {
  let state = wealthy();
  const starter = content.rules.economy.starterHullId;
  if (fit.hullId !== starter) state = buy(state, fit.hullId, 1).state;
  const shipId = fit.hullId === starter ? state.assets.activeShipId! : shipOf(state, fit.hullId);

  const needs = new Map<string, number>();
  for (const slot of fit.modules) {
    needs.set(slot.moduleId, (needs.get(slot.moduleId) ?? 0) + 1);
    if (slot.ammunitionId !== undefined) {
      const module = content.requireModule(slot.moduleId as never);
      const magazine = module.category === 'turret' ? module.turret.magazineSize
        : module.category === 'launcher' ? module.launcher.magazineSize : 0;
      needs.set(slot.ammunitionId, (needs.get(slot.ammunitionId) ?? 0) + magazine);
    }
  }
  for (const [definitionId, quantity] of needs) state = buy(state, definitionId, quantity).state;

  state = command(state, 'fitting.begin', { shipId }).state;
  // The starter's own fit is cleared first, so the reference fit is exactly what remains.
  for (const fitted of shipFit(state.assets, shipId)) {
    state = command(state, 'fitting.clear', { slotKind: fitted.slot.kind, slotIndex: fitted.slot.index }).state;
  }
  const next: Record<string, number> = {};
  for (const slot of fit.modules) {
    const module = content.requireModule(slot.moduleId as never);
    const index = next[module.slot] ?? 0;
    next[module.slot] = index + 1;
    state = command(state, 'fitting.set', {
      slotKind: module.slot,
      slotIndex: index,
      moduleId: slot.moduleId,
      online: true,
      ...(slot.ammunitionId === undefined ? {} : { ammunitionId: slot.ammunitionId }),
    }).state;
  }
  state = command(state, 'fitting.commit', {}).state;
  return { state, shipId };
}

describe('reference fits (FeatureSpec02 5.3)', () => {
  it('declares a turret fit for every hull and the guided fits delivered so far [V02-AC-04, V02-AC-05]', () => {
    const hulls = new Set(REFERENCE_FITS.map((fit) => fit.hullId));
    expect(hulls).toEqual(new Set(['hull.independent.starter', 'hull.independent.destroyer', 'hull.independent.cruiser']));
    expect(REFERENCE_FITS.map((fit) => fit.id)).toEqual(expect.arrayContaining(['fit.frigate.guided', 'fit.cruiser.guided']));
  });

  it.each(REFERENCE_FITS.map((fit) => [fit.id, fit] as const))(
    'buys and commits %s legally at the starting station, ready to undock [FUNC-8.4, V02-AC-04, V02-AC-05]',
    (_id, fit) => {
      const { state, shipId } = assemble(fit);
      const ship = shipProjection(state, content, shipId);
      expect(ship.violations).toEqual([]);
      expect(ship.undockable).toBe(true);
      expect(shipFit(state.assets, shipId)).toHaveLength(fit.modules.length);
      // Every weapon is loaded with its declared charge and shows what it does.
      expect(ship.weapons.length).toBe(fit.modules.filter((slot) => slot.ammunitionId !== undefined).length);
      for (const weapon of ship.weapons) {
        expect(weapon.loadedRounds).toBe(weapon.magazineSize);
        expect(weapon.damagePerSecond).toBeGreaterThan(0);
        if (weapon.kind === 'guided') {
          expect(weapon.maximumFlightDistanceKm).toBeGreaterThan(0);
          expect(weapon.explosionRadiusMetres).toBeGreaterThan(0);
        } else {
          expect(weapon.optimalRangeKm).toBeGreaterThan(0);
        }
      }
    },
  );
});

describe('size compatibility through the pipeline', () => {
  it('refuses a medium weapon on the frigate when it is set, and accepts it on the cruiser [FUNC-8.4, V02-AC-05]', () => {
    let state = buy(wealthy(), 'module.turret.railgun.medium', 1).state;
    const frigate = state.assets.activeShipId!;
    state = command(state, 'fitting.begin', { shipId: frigate }).state;
    const refused = refusal(state, 'fitting.set', {
      slotKind: 'weapon', slotIndex: 1, moduleId: 'module.turret.railgun.medium', online: true,
    });
    expect(refused?.messageKey).toBe('fitting.violation.sizeNotAccepted');
    expect(reasonOf(refused)).toBe('fitting.violation.sizeNotAccepted');
    state = command(state, 'fitting.revert', {}).state;

    state = buy(state, 'hull.independent.cruiser', 1).state;
    const cruiser = shipOf(state, 'hull.independent.cruiser');
    state = command(state, 'fitting.begin', { shipId: cruiser }).state;
    state = command(state, 'fitting.set', {
      slotKind: 'weapon', slotIndex: 0, moduleId: 'module.turret.railgun.medium', online: true,
    }).state;
    state = command(state, 'fitting.commit', {}).state;
    expect(shipFit(state.assets, cruiser).map((slot) => slot.moduleId)).toEqual(['module.turret.railgun.medium']);
  });

  it('offers only modules the hull accepts as fitting candidates [FUNC-8.4, FUNC-8.5, V02-AC-05]', () => {
    let state = buy(wealthy(), 'module.turret.railgun.medium', 1).state;
    state = buy(state, 'module.upgrade.tracking', 1).state;
    state = command(state, 'fitting.begin', { shipId: state.assets.activeShipId! }).state;
    const draft = fittingDraftProjection(state, content).draft;
    const offered = (draft?.options ?? []).flatMap((option) => option.candidates.map((candidate) => candidate.module.definitionId));
    expect(offered).not.toContain('module.turret.railgun.medium');
    expect(offered).toContain('module.upgrade.tracking');
  });
});

describe('derived statistics and conservation', () => {
  it('shows the extender and recharger in the ship\'s traces with stacking applied [FUNC-4.4, FUNC-19.6, V02-AC-05]', () => {
    const fit = REFERENCE_FITS.find((candidate) => candidate.id === 'fit.destroyer.artillery')!;
    const { state, shipId } = assemble(fit);
    const ship = shipProjection(state, content, shipId);
    const shield = ship.attributes.find((stat) => stat.attribute === 'shieldHitPoints')!;
    expect(shield.value).toBe(shield.base + 150);
    expect(shield.steps.map((step) => step.sourceId)).toEqual(['module.shield.extender']);
    const tracking = ship.attributes.find((stat) => stat.attribute === 'weapon.turret.tracking')!;
    expect(tracking.value).toBeCloseTo(1.15, 12);
    const recharge = ship.attributes.find((stat) => stat.attribute === 'shieldRechargeSeconds')!;
    expect(recharge.value).toBeCloseTo(recharge.base * 0.7, 9);
  });

  it('never creates capacitor or repairs anything by fitting and removing modules repeatedly [FUNC-9.7, FUNC-22.3, V02-AC-05]', () => {
    let state = buy(wealthy(), 'module.capacitor.battery.small', 1).state;
    state = buy(state, 'module.shield.extender', 1).state;
    const shipId = state.assets.activeShipId!;
    // Leave the ship partly drained and damaged.
    const draft = draftOf(state);
    const condition = draft.assets.ships[shipId]!.condition;
    condition.capacitorCharge = 60;
    condition.damage.armor = 120;
    condition.damage.hull = 30;
    draft.assets.version += 1;
    state = draft as unknown as CampaignState;

    const before = { ...state.assets.ships[shipId]!.condition, damage: { ...state.assets.ships[shipId]!.condition.damage } };
    for (let round = 0; round < 3; round += 1) {
      state = command(state, 'fitting.begin', { shipId }).state;
      state = command(state, 'fitting.set', { slotKind: 'engineering', slotIndex: 0, moduleId: 'module.capacitor.battery.small', online: true }).state;
      state = command(state, 'fitting.set', { slotKind: 'engineering', slotIndex: 1, moduleId: 'module.shield.extender', online: true }).state;
      state = command(state, 'fitting.commit', {}).state;
      state = command(state, 'fitting.begin', { shipId }).state;
      state = command(state, 'fitting.clear', { slotKind: 'engineering', slotIndex: 0 }).state;
      state = command(state, 'fitting.clear', { slotKind: 'engineering', slotIndex: 1 }).state;
      state = command(state, 'fitting.commit', {}).state;
      const after = state.assets.ships[shipId]!.condition;
      expect(after.capacitorCharge).toBeLessThanOrEqual(before.capacitorCharge);
      expect(after.damage.armor).toBe(before.damage.armor);
      expect(after.damage.hull).toBe(before.damage.hull);
    }
  });
});
