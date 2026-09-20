import {
  HARDPOINT_KINDS,
  SLOT_KINDS,
  type ContentRepository,
  type HardpointKind,
  type HullDefinition,
  type SlotKind,
} from '@engine/ports';

import { attributeValue, type DerivedShipAttributes } from '../attributes/shipAttributes';

import type { FitDescription, FitViolation, FitViolationCode, SlotRef } from './types';

/**
 * Fitting constraints and undock validity (Functional Specification 8.4).
 *
 * A fit is valid only when no slot or hardpoint count is exceeded, online
 * power and processing stay within what the ship supplies, and every loaded
 * charge belongs in the weapon holding it. The MVP catalog gates nothing on
 * skills, so no item is refused for a missing skill; the check stays a
 * deliberate absence rather than an assumption baked into this code.
 *
 * Every violation carries the slot and the numbers behind it, because the
 * interface must be able to say why undocking is unavailable
 * (Functional Specification 22.10).
 *
 * @implements FUNC-8.4, FUNC-22.10, TECH-10.2
 */

export interface ResourceUse {
  readonly used: number;
  readonly available: number;
}

export interface FitAssessment {
  readonly violations: readonly FitViolation[];
  readonly power: ResourceUse;
  readonly processing: ResourceUse;
  readonly slots: Readonly<Record<SlotKind, ResourceUse>>;
  readonly hardpoints: Readonly<Record<HardpointKind, ResourceUse>>;
}

export interface FitAssessmentInput {
  readonly hull: HullDefinition;
  readonly fit: FitDescription;
  readonly content: ContentRepository;
  /** Derived from the same fit, so available power reflects what is fitted. */
  readonly derived: DerivedShipAttributes;
}

export function assessFit(input: FitAssessmentInput): FitAssessment {
  const { hull, fit, content } = input;
  const violations: FitViolation[] = [];
  const slotUse = countsOf(SLOT_KINDS);
  const hardpointUse = countsOf(HARDPOINT_KINDS);
  let power = 0;
  let processing = 0;

  for (const fitted of fit) {
    const slot = fitted.slot;
    const module = content.module(fitted.moduleId);
    if (module === undefined) {
      violations.push(violation('moduleUnknown', slot, { moduleId: fitted.moduleId }));
      continue;
    }

    slotUse[slot.kind] += 1;

    if (module.slot !== slot.kind) {
      violations.push(
        violation('slotKindMismatch', slot, { moduleId: module.id, requires: module.slot }),
      );
    }
    if (slot.index < 0 || slot.index >= hull.slots[slot.kind]) {
      violations.push(
        violation('slotUnavailable', slot, {
          index: slot.index,
          available: hull.slots[slot.kind],
        }),
      );
    }

    if (module.hardpoint !== undefined) {
      const hardpoint = module.hardpoint;
      hardpointUse[hardpoint] += 1;
      if (hull.hardpoints[hardpoint] === 0) {
        violations.push(violation('hardpointMismatch', slot, { hardpoint, moduleId: module.id }));
      } else if (hardpointUse[hardpoint] > hull.hardpoints[hardpoint]) {
        violations.push(
          violation('hardpointUnavailable', slot, {
            hardpoint,
            used: hardpointUse[hardpoint],
            available: hull.hardpoints[hardpoint],
          }),
        );
      }
    }

    if (fitted.online) {
      power += module.fitting.powerUse;
      processing += module.fitting.processingUse;
    }

    if (fitted.charge === null) {
      continue;
    }
    const charge = content.ammunition(fitted.charge.ammunitionId);
    if (module.category !== 'turret') {
      violations.push(
        violation('chargeNotAccepted', slot, { moduleId: module.id, category: module.category }),
      );
    } else if (charge === undefined) {
      violations.push(
        violation('ammunitionUnknown', slot, { ammunitionId: fitted.charge.ammunitionId }),
      );
    } else if (charge.group !== module.turret.ammunitionGroup) {
      violations.push(
        violation('ammunitionMismatch', slot, {
          ammunitionId: charge.id,
          group: charge.group,
          requires: module.turret.ammunitionGroup,
        }),
      );
    } else if (fitted.charge.quantity > module.turret.magazineSize) {
      violations.push(
        violation('magazineExceeded', slot, {
          loaded: fitted.charge.quantity,
          magazineSize: module.turret.magazineSize,
        }),
      );
    }
  }

  for (const kind of SLOT_KINDS) {
    if (slotUse[kind] > hull.slots[kind]) {
      violations.push(
        violation('slotUnavailable', null, {
          slotKind: kind,
          used: slotUse[kind],
          available: hull.slots[kind],
        }),
      );
    }
  }

  const powerOutput = attributeValue(input.derived, 'powerOutput');
  const processingOutput = attributeValue(input.derived, 'processingOutput');
  if (power > powerOutput) {
    violations.push(violation('powerExceeded', null, { used: power, available: powerOutput }));
  }
  if (processing > processingOutput) {
    violations.push(
      violation('processingExceeded', null, { used: processing, available: processingOutput }),
    );
  }

  return {
    violations,
    power: { used: power, available: powerOutput },
    processing: { used: processing, available: processingOutput },
    slots: resourceMap(SLOT_KINDS, slotUse, (kind) => hull.slots[kind]),
    hardpoints: resourceMap(HARDPOINT_KINDS, hardpointUse, (kind) => hull.hardpoints[kind]),
  };
}

/** A ship may not undock while its active fit breaks a fitting rule. */
export function isUndockable(assessment: FitAssessment): boolean {
  return assessment.violations.length === 0;
}

/**
 * Violations of a budget rather than of the ship's physical layout.
 *
 * An over-committed power grid is a fit the player may keep and correct, so it
 * blocks undocking rather than the fitting change itself
 * (Functional Specification 8.4). Everything else describes a fit that could
 * not physically exist and is refused when it is made.
 */
export const RESOURCE_VIOLATIONS: readonly FitViolationCode[] = [
  'powerExceeded',
  'processingExceeded',
];

export function structuralViolations(
  violations: readonly FitViolation[],
): readonly FitViolation[] {
  return violations.filter((violation) => !RESOURCE_VIOLATIONS.includes(violation.code));
}

function violation(
  code: FitViolation['code'],
  slot: SlotRef | null,
  params: FitViolation['params'],
): FitViolation {
  return { code, slot, params };
}

function countsOf<TKey extends string>(keys: readonly TKey[]): Record<TKey, number> {
  const counts = {} as Record<TKey, number>;
  for (const key of keys) {
    counts[key] = 0;
  }
  return counts;
}

function resourceMap<TKey extends string>(
  keys: readonly TKey[],
  used: Record<TKey, number>,
  available: (key: TKey) => number,
): Readonly<Record<TKey, ResourceUse>> {
  const map = {} as Record<TKey, ResourceUse>;
  for (const key of keys) {
    map[key] = { used: used[key], available: available(key) };
  }
  return map;
}
