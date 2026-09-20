import type { MessageKey } from '@shared';
import { clamp, floorToInteger } from '@shared';

import {
  applyOperation,
  stackingMultiplier,
  type AttributeModifier,
  type ModifierOperation,
  type ModifierStage,
} from './modifiers';

/**
 * The one dependency-aware attribute pipeline
 * (Functional Specification 4.4; Technical Specification 10.2).
 *
 * Every derived ship statistic is produced here, in the order the technical
 * specification prescribes:
 *
 *   1. read the base value;
 *   2. add flat modifiers;
 *   3. group fitted percentage bonuses and penalties separately;
 *   4. sort each group by absolute magnitude and diminish it;
 *   5. apply undiminished intrinsic modifiers;
 *   6. clamp rule-bounded outputs;
 *   7. record the trace.
 *
 * The trace is not decoration. Functional Specification 4.4 requires every
 * derived value to be able to show its base and each applied modifier in
 * calculation order, and 19.6 requires the explanation to substitute the
 * current values into the formula, so the steps are produced by the same pass
 * that produces the number rather than reconstructed afterwards.
 *
 * Ordering inside a stage is made total on purpose: two modifiers of equal
 * magnitude are ordered by source id, so the same fit always produces the same
 * number and the same explanation.
 *
 * @implements FUNC-4.4, FUNC-19.6, TECH-10.2
 */

export interface AttributeTraceStep {
  readonly sourceId: string;
  readonly sourceKey: MessageKey;
  readonly operation: ModifierOperation;
  readonly stage: ModifierStage;
  /** The authored magnitude, before any stacking penalty. */
  readonly value: number;
  /** 1 for the strongest modifier of its direction, less for each next one. */
  readonly stackingMultiplier: number;
  /** The magnitude that was actually applied. */
  readonly effectiveValue: number;
  /** The attribute value after this step. */
  readonly result: number;
}

export interface DerivedAttribute {
  readonly attribute: string;
  readonly base: number;
  readonly value: number;
  /** True when a bound of Functional Specification 4.2 changed the result. */
  readonly clamped: boolean;
  readonly steps: readonly AttributeTraceStep[];
}

export interface AttributeRequest {
  readonly attribute: string;
  readonly base: number;
  readonly modifiers: readonly AttributeModifier[];
  readonly minimum?: number;
  readonly maximum?: number;
  /** Whole-unit attributes are floored at the final step only. */
  readonly whole?: boolean;
  /** Named assumptions that are currently true, such as an active module. */
  readonly conditions?: ReadonlySet<string>;
}

export function evaluateAttribute(request: AttributeRequest): DerivedAttribute {
  const conditions = request.conditions ?? EMPTY_CONDITIONS;
  const applicable = request.modifiers.filter(
    (modifier) =>
      modifier.attribute === request.attribute &&
      (modifier.condition === undefined || conditions.has(modifier.condition)),
  );

  const steps: AttributeTraceStep[] = [];
  let value = request.base;

  for (const modifier of sortedFlat(applicable)) {
    value = record(steps, modifier, 1, value);
  }

  // Bonuses and penalties are diminished separately, so a penalty never
  // consumes a bonus's position in the stacking order.
  for (const group of [byDirection(applicable, 1), byDirection(applicable, -1)]) {
    group.forEach((modifier, position) => {
      value = record(steps, modifier, stackingMultiplier(position), value);
    });
  }

  for (const modifier of sortedIntrinsic(applicable)) {
    value = record(steps, modifier, 1, value);
  }

  const bounded = clamp(
    request.minimum ?? Number.NEGATIVE_INFINITY,
    request.maximum ?? Number.POSITIVE_INFINITY,
    value,
  );
  const final = request.whole === true ? floorToInteger(bounded) : bounded;

  return {
    attribute: request.attribute,
    base: request.base,
    value: final,
    clamped: bounded !== value,
    steps,
  };
}

/** Evaluates several attributes from one modifier list, keyed by attribute. */
export function evaluateAttributes(
  requests: readonly AttributeRequest[],
): Readonly<Record<string, DerivedAttribute>> {
  const derived: Record<string, DerivedAttribute> = {};
  for (const request of requests) {
    derived[request.attribute] = evaluateAttribute(request);
  }
  return derived;
}

const EMPTY_CONDITIONS: ReadonlySet<string> = new Set<string>();

function record(
  steps: AttributeTraceStep[],
  modifier: AttributeModifier,
  multiplier: number,
  value: number,
): number {
  const effectiveValue = modifier.value * multiplier;
  const result = applyOperation(modifier.operation, value, effectiveValue);
  steps.push({
    sourceId: modifier.sourceId,
    sourceKey: modifier.sourceKey,
    operation: modifier.operation,
    stage: modifier.stage,
    value: modifier.value,
    stackingMultiplier: multiplier,
    effectiveValue,
    result,
  });
  return result;
}

function sortedFlat(modifiers: readonly AttributeModifier[]): readonly AttributeModifier[] {
  return modifiers.filter((modifier) => modifier.stage === 'flat').sort(bySource);
}

function sortedIntrinsic(modifiers: readonly AttributeModifier[]): readonly AttributeModifier[] {
  return modifiers.filter((modifier) => modifier.stage === 'intrinsic').sort(bySource);
}

/** Fitted modifiers of one direction, strongest first. */
function byDirection(
  modifiers: readonly AttributeModifier[],
  sign: 1 | -1,
): readonly AttributeModifier[] {
  return modifiers
    .filter(
      (modifier) =>
        modifier.stage === 'fitted' && (sign === 1 ? modifier.value >= 0 : modifier.value < 0),
    )
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || bySource(a, b));
}

function bySource(a: AttributeModifier, b: AttributeModifier): number {
  if (a.sourceId !== b.sourceId) {
    return a.sourceId < b.sourceId ? -1 : 1;
  }
  return a.value - b.value;
}
