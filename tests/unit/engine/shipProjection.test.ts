import { describe, expect, it } from 'vitest';

import { runCommand } from '@engine/application';
import type { CampaignState } from '@engine/domain';
import {
  comparisonProjection,
  fittingDraftProjection,
  shipProjection,
  undockValidityProjection,
} from '@engine/projections';
import { catalogFor, DEFAULT_LOCALE } from '@ui';

import { testCampaign } from '../../support/campaign';
import { shippedContent } from '../../support/content';

/**
 * Ship, fitting-draft and comparison projections
 * (Functional Specification 8.2-8.5, 19.6; Technical Specification 7.3).
 */

const content = shippedContent();
const catalog = catalogFor(DEFAULT_LOCALE);

function committed(state: CampaignState, type: Parameters<typeof runCommand>[0]['type'], payload: unknown): CampaignState {
  const result = runCommand({ campaign: state, content, type, payload });
  if (result.kind !== 'committed' || result.campaign === null) {
    throw new Error(`Expected a committed campaign, got ${JSON.stringify(result)}`);
  }
  return result.campaign;
}

function opened(): CampaignState {
  const state = testCampaign();
  return committed(state, 'fitting.begin', { shipId: state.assets.activeShipId });
}

describe('the ship projection', () => {
  it('describes every slot the hull offers, occupied or not [FUNC-8.2, FUNC-8.4]', () => {
    const state = testCampaign();
    const ship = shipProjection(state, content, state.assets.activeShipId);
    const hull = content.requireHull(state.assets.ships[state.assets.activeShipId]!.hullId);

    const total = Object.values(hull.slots).reduce((sum, count) => sum + count, 0);
    expect(ship.slots).toHaveLength(total);
    expect(ship.slots.filter((slot) => slot.module !== null).map((slot) => slot.module?.definitionId)).toEqual([
      'module.turret.autocannon.small',
      'module.shield.booster.small',
    ]);
    expect(ship.slots[0]?.charge?.quantity).toBe(20);
    expect(ship.slots[1]?.module).toBeNull();
    expect(ship.slotUse['weapon']).toEqual({ used: 1, available: hull.slots.weapon });
    expect(ship.hardpointUse['turret']).toEqual({ used: 1, available: hull.hardpoints.turret });
  });

  it('reports fitting resources, condition and undock validity [FUNC-8.2, FUNC-8.4]', () => {
    const state = testCampaign();
    const ship = shipProjection(state, content, state.assets.activeShipId);
    const hull = content.requireHull(state.assets.ships[state.assets.activeShipId]!.hullId);

    expect(ship.power).toEqual({ used: 10, available: hull.fitting.powerOutput });
    expect(ship.processing).toEqual({ used: 28, available: hull.fitting.processingOutput });
    expect(ship.undockable).toBe(true);
    expect(ship.violations).toEqual([]);

    const shield = ship.layers.find((layer) => layer.layer === 'shield');
    expect(shield?.hitPoints).toBe(hull.defenses.shield.hitPoints);
    expect(shield?.maximumHitPoints).toBe(hull.defenses.shield.hitPoints);
    expect(shield?.resistances.map((entry) => entry.damageType)).toEqual([
      'electromagnetic',
      'thermal',
      'kinetic',
      'explosive',
    ]);
    expect(ship.capacitor.charge).toBe(hull.capacitor.capacity);
  });

  it('carries a labelled, explainable trace with every derived value [FUNC-4.4, FUNC-19.6]', () => {
    const state = testCampaign();
    const ship = shipProjection(state, content, state.assets.activeShipId);

    expect(ship.attributes.length).toBeGreaterThan(0);
    for (const stat of ship.attributes) {
      expect(stat.labelKey, stat.attribute).toBe(`stat.${stat.attribute}`);
      expect(Object.prototype.hasOwnProperty.call(catalog, stat.labelKey), stat.labelKey).toBe(true);
      for (const step of stat.steps) {
        expect(step.sourceId.length).toBeGreaterThan(0);
        expect(step.stackingMultiplier).toBeGreaterThanOrEqual(0);
      }
    }
    // The starting fit changes no ship attribute, so every value is the hull's.
    expect(ship.attributes.every((stat) => stat.base === stat.value)).toBe(true);
  });

  it('says why undocking is unavailable and names a key for it [FUNC-8.4, FUNC-22.10]', () => {
    const state = testCampaign();
    const shipId = state.assets.activeShipId;
    const ship = state.assets.ships[shipId]!;
    const stacks = { ...state.assets.stacks };
    // Move the fitted turret to a slot the hull does not have.
    for (const stack of Object.values(stacks)) {
      if (stack.state.kind === 'fitted' && stack.definitionId.startsWith('module.turret')) {
        stacks[stack.id] = { ...stack, state: { kind: 'fitted', slot: { kind: 'weapon', index: 7 }, online: true } };
      }
    }
    const broken: CampaignState = { ...state, assets: { ...state.assets, stacks } };
    const validity = undockValidityProjection(broken, content, ship.id);

    expect(validity.undockable).toBe(false);
    expect(validity.unavailableReason).toBe('fitting.undock.invalidFit');
    expect(validity.violations[0]?.messageKey).toBe('fitting.violation.slotUnavailable');
    expect(validity.violations[0]?.slot).toEqual({ kind: 'weapon', index: 7 });
    expect(Object.prototype.hasOwnProperty.call(catalog, validity.violations[0]!.messageKey)).toBe(true);
  });
});

describe('the fitting-draft projection', () => {
  it('is empty while no draft is open [TECH-7.3]', () => {
    expect(fittingDraftProjection(testCampaign(), content).draft).toBeNull();
  });

  it('shows an unchanged draft as the fit the ship already wears [FUNC-8.4]', () => {
    const draft = fittingDraftProjection(opened(), content).draft;

    expect(draft?.changed).toBe(false);
    expect(draft?.committable).toBe(true);
    expect(draft?.missing).toEqual([]);
    expect(draft?.slots.map((slot) => slot.module?.definitionId)).toEqual([
      'module.shield.booster.small',
      'module.turret.autocannon.small',
    ]);
  });

  it('previews the derived result of a planned change before it is committed [FUNC-8.5, FUNC-22.4]', () => {
    const state = committed(opened(), 'fitting.clear', { slotKind: 'weapon', slotIndex: 0 });
    const draft = fittingDraftProjection(state, content).draft;
    const current = shipProjection(state, content, state.assets.activeShipId);

    expect(draft?.changed).toBe(true);
    expect(draft?.preview?.power.used).toBe(5);
    expect(current.power.used).toBe(10);
    expect(draft?.preview?.warnings.map((warning) => warning.code)).toContain('noWeapon');
  });

  it('lists what the plan needs and cannot find [FUNC-8.5, MVP-AC-02]', () => {
    const state = committed(opened(), 'fitting.set', {
      slotKind: 'weapon',
      slotIndex: 1,
      moduleId: 'module.turret.railgun.small',
      online: true,
    });
    const draft = fittingDraftProjection(state, content).draft;

    expect(draft?.committable).toBe(false);
    expect(draft?.missing).toEqual([
      {
        definitionId: 'module.turret.railgun.small',
        nameKey: content.requireModule('module.turret.railgun.small' as never).nameKey,
        required: 1,
        available: 0,
      },
    ]);
    // The preview still shows what the fit would do once the item is bought.
    expect(draft?.preview?.slots.filter((slot) => slot.module !== null)).toHaveLength(3);
  });

  it('offers every slot the hull has, whether or not the draft fills it [FUNC-8.4, TECH-12.3]', () => {
    const draft = fittingDraftProjection(opened(), content).draft;
    const hull = content.requireHull('hull.independent.starter' as never);
    const total = Object.values(hull.slots).reduce((sum, count) => sum + count, 0);

    expect(draft?.options).toHaveLength(total);
    expect(draft?.options.map((option) => `${option.slot.kind}:${String(option.slot.index)}`)).toEqual([
      'weapon:0', 'weapon:1', 'system:0', 'system:1', 'engineering:0', 'engineering:1',
    ]);
  });

  it('offers only modules the player owns locally and the slot accepts [FUNC-8.4]', () => {
    const draft = fittingDraftProjection(opened(), content).draft;
    const weapon = draft?.options.find((option) => option.slot.kind === 'weapon');
    const system = draft?.options.find((option) => option.slot.kind === 'system');
    const engineering = draft?.options.find((option) => option.slot.kind === 'engineering');

    // The starting fit is the only thing owned: one autocannon and one shield
    // booster, both of them currently worn by the ship.
    expect(weapon?.candidates.map((candidate) => candidate.module.definitionId)).toEqual([
      'module.turret.autocannon.small',
    ]);
    expect(system?.candidates.map((candidate) => candidate.module.definitionId)).toEqual([
      'module.shield.booster.small',
    ]);
    expect(engineering?.candidates).toEqual([]);
  });

  it('counts a fitted module as available, because a commit takes it off first [FUNC-8.4]', () => {
    const draft = fittingDraftProjection(opened(), content).draft;
    const weapon = draft?.options.find((option) => option.slot.kind === 'weapon');

    expect(weapon?.candidates[0]?.available).toBe(1);
    expect(weapon?.candidates[0]?.powerUse).toBe(
      content.requireModule('module.turret.autocannon.small' as never).fitting.powerUse,
    );
    expect(weapon?.candidates[0]?.hardpoint).toBe('turret');
  });

  it('offers a turret only the ammunition it accepts and the player holds [FUNC-8.4]', () => {
    const draft = fittingDraftProjection(opened(), content).draft;
    const weapon = draft?.options.find((option) => option.slot.kind === 'weapon');

    // Hybrid charges exist in the catalogue but are neither owned nor accepted
    // by a projectile turret.
    expect(weapon?.candidates[0]?.charges.map((charge) => charge.definitionId)).toEqual([
      'ammo.projectile.small.fusion',
    ]);
  });

  it('offers a module the moment the player owns one [FUNC-8.4, MVP-AC-02]', () => {
    const state = opened();
    const before = fittingDraftProjection(state, content).draft;
    expect(
      before?.options.find((option) => option.slot.kind === 'engineering')?.candidates,
    ).toEqual([]);

    const hangar = Object.values(state.assets.inventories).find(
      (inventory) => inventory.location.kind === 'hangar',
    );
    const bought: CampaignState = {
      ...state,
      assets: {
        ...state.assets,
        stacks: {
          ...state.assets.stacks,
          'stack-plating': {
            id: 'stack-plating' as never,
            inventoryId: (hangar?.id ?? '') as never,
            definitionId: 'module.plating.armor.small' as never,
            quantity: 2,
            state: { kind: 'plain' },
            provenance: { grantedQuantity: 0, purchasedQuantity: 2, purchaseCostCredits: 8000 },
          },
        },
      },
    };

    const after = fittingDraftProjection(bought, content).draft;
    const engineering = after?.options.find((option) => option.slot.kind === 'engineering');
    expect(engineering?.candidates.map((candidate) => candidate.module.definitionId)).toEqual([
      'module.plating.armor.small',
    ]);
    expect(engineering?.candidates[0]?.available).toBe(2);
    expect(engineering?.candidates[0]?.charges).toEqual([]);
  });
});

describe('comparison', () => {
  it('groups differences and names the direction each one reads in [FUNC-19.6]', () => {
    const state = testCampaign();
    const comparison = comparisonProjection(
      state,
      content,
      'module.turret.autocannon.small',
      'module.turret.railgun.small',
    );
    const entry = (key: string) => comparison.entries.find((candidate) => candidate.key === key);

    expect(comparison.comparable).toBe(true);
    expect(entry('optimalRangeKm')?.direction).toBe('worse');
    expect(entry('trackingRadiansPerSecond')?.direction).toBe('better');
    expect(entry('powerUse')?.direction).toBe('better');
    expect(entry('referenceValueCredits')?.group).toBe('value');
    // A value whose meaning depends on the situation is never dressed up.
    expect(entry('signatureResolutionMetres')?.direction).toBe('equal');
    expect(entry('cycleSeconds')?.direction).toBe('neutral');

    for (const row of comparison.entries) {
      expect(row.labelKey).toBe(`stat.${row.key}`);
      expect(Object.prototype.hasOwnProperty.call(catalog, row.labelKey), row.labelKey).toBe(true);
    }
  });

  it('compares two charges and stays neutral about their range trade [FUNC-19.6]', () => {
    const comparison = comparisonProjection(
      testCampaign(),
      content,
      'ammo.projectile.small.fusion',
      'ammo.projectile.small.phased',
    );
    const entry = (key: string) => comparison.entries.find((candidate) => candidate.key === key);

    expect(comparison.comparable).toBe(true);
    expect(entry('damagePerShot.explosive')?.direction).toBe('better');
    expect(entry('damagePerShot.thermal')?.direction).toBe('worse');
    expect(entry('optimalRangeMultiplier')?.direction).toBe('neutral');
  });

  it('reports two unlike entries as not comparable [FUNC-19.6]', () => {
    const comparison = comparisonProjection(
      testCampaign(),
      content,
      'module.turret.autocannon.small',
      'module.shield.booster.small',
    );

    expect(comparison.comparable).toBe(false);
    // The rows they share are still shown, and the rest are absent.
    expect(comparison.entries.map((entry) => entry.key)).toContain('powerUse');
    expect(comparison.entries.find((entry) => entry.key === 'optimalRangeKm')?.right).toBeNull();
  });
});
