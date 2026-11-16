import {
  allocateEntityId,
  mutableSpeedEffects,
  recordControlEvent,
  speedEffectFrom,
  SPEED_EFFECT_EXPIRY_KIND,
  type ActiveModuleContext,
  type CombatantContext,
  type SchedulerEntry,
  type SpeedEffectState,
} from '@engine/domain';
import { webEffectDurationSeconds, type WebModuleDefinition } from '@engine/ports';

import type { SimulationContext } from './context';
import { cancelBoundary, scheduleBoundary } from './scheduler';

/**
 * Temporary speed reductions from webs (Functional Specification 9.9;
 * FeatureSpec02 6.3; Technical Specification 9.2, 10.3).
 *
 * A completed web cycle applies an effect to its target, or refreshes the
 * one that source already holds there: the same source never stacks with
 * itself. Effects of different sources are separate records and multiply in
 * the attribute pipeline, above the speed floor. The effect lowers only the
 * target's maximum normal speed, so the ordinary movement controller brakes
 * the ship down to it; nothing here moves a ship.
 *
 * Each effect owns its expiry boundary, which runs after every completion at
 * the same instant, so a refresh due exactly as the previous application
 * expires wins and the effect never lapses (Functional Specification 4.2).
 * The source is a retained attribution, so an effect outlives its source's
 * destruction or departure until it expires; the target leaving the site or
 * being destroyed removes every effect on it.
 *
 * @implements FUNC-9.9, TECH-8.2, TECH-9.2, TECH-10.3, V02-AC-07, V02-AC-13
 */

export const SPEED_EFFECT_EXPIRY_BOUNDARY = SPEED_EFFECT_EXPIRY_KIND;

/** After every completion at the instant (module cycles are 30), so a refresh wins a tie. */
const EXPIRY_PRIORITY = 75;

/** Applies or refreshes one source's effect on one target. */
export function applySpeedEffect(
  context: SimulationContext,
  source: CombatantContext,
  operated: ActiveModuleContext & { readonly module: WebModuleDefinition },
  targetId: string,
): SpeedEffectState {
  const draft = context.draft;
  const now = draft.time.simulationTimeMs;
  const speedFactor = round(1 - operated.module.web.speedReductionFraction);
  const expiresAtMs = now + Math.max(1, Math.round(webEffectDurationSeconds(operated.module) * 1000));
  const effects = mutableSpeedEffects(draft);
  const existing = speedEffectFrom(draft, source.shipId, operated.key, targetId);

  const id = existing?.id ?? allocateEntityId(draft);
  if (existing !== null) cancelBoundary(draft, existing.expiryBoundaryEntryId);
  const expiry = scheduleBoundary(draft, {
    kind: SPEED_EFFECT_EXPIRY_BOUNDARY,
    dueAtMs: expiresAtMs,
    priority: EXPIRY_PRIORITY,
    ownerId: id,
  });
  const effect: SpeedEffectState = {
    id,
    targetId: targetId as SpeedEffectState['targetId'],
    sourceShipId: source.shipId,
    sourceSlotKey: operated.key,
    moduleId: operated.module.id,
    speedFactor,
    appliedAtMs: now,
    expiresAtMs,
    expiryBoundaryEntryId: expiry.entryId,
  };
  const index = existing === null ? -1 : effects.findIndex((candidate) => candidate.id === existing.id);
  if (index < 0) effects.push(effect);
  else effects[index] = effect;

  recordControlEvent(draft, {
    sourceId: source.shipId,
    targetId,
    slotKey: operated.key,
    moduleId: operated.module.id,
    speedFactor,
    expiresAtMs,
  });
  context.publish('combat.speedEffectApplied', {
    effectId: id,
    sourceId: source.shipId,
    targetId,
    slot: operated.key,
    moduleId: operated.module.id,
    speedFactor,
    expiresAtMs,
    refreshed: existing !== null,
  });
  changed(context);
  return effect;
}

/** The effect ran its duration without a refresh. */
export function resolveSpeedEffectExpiry(context: SimulationContext, entry: SchedulerEntry): void {
  const effects = mutableSpeedEffects(context.draft);
  const index = effects.findIndex(
    (candidate) => candidate.id === entry.ownerId && candidate.expiryBoundaryEntryId === entry.entryId,
  );
  if (index < 0) return;
  const [effect] = effects.splice(index, 1);
  if (effect !== undefined) publishRemoved(context, effect, 'expired');
  changed(context);
}

/**
 * Ends every effect on one ship, because it was destroyed or left the site
 * (Functional Specification 9.9). Effects the ship applied to others stay.
 */
export function removeSpeedEffectsOn(context: SimulationContext, shipId: string): void {
  const effects = mutableSpeedEffects(context.draft);
  if (!effects.some((effect) => effect.targetId === shipId)) return;
  const kept: SpeedEffectState[] = [];
  for (const effect of effects) {
    if (effect.targetId !== shipId) {
      kept.push(effect);
      continue;
    }
    cancelBoundary(context.draft, effect.expiryBoundaryEntryId);
    publishRemoved(context, effect, 'targetGone');
  }
  effects.length = 0;
  effects.push(...kept);
  changed(context);
}

/** Nothing stays applied once the site it belongs to is unloaded. */
export function clearSpeedEffects(context: SimulationContext): void {
  const effects = mutableSpeedEffects(context.draft);
  if (effects.length === 0) return;
  for (const effect of effects) {
    cancelBoundary(context.draft, effect.expiryBoundaryEntryId);
    publishRemoved(context, effect, 'siteLeft');
  }
  effects.length = 0;
  changed(context);
}

function publishRemoved(
  context: SimulationContext,
  effect: SpeedEffectState,
  reason: 'expired' | 'targetGone' | 'siteLeft',
): void {
  context.publish('combat.speedEffectExpired', {
    effectId: effect.id,
    sourceId: effect.sourceShipId,
    targetId: effect.targetId,
    slot: effect.sourceSlotKey,
    moduleId: effect.moduleId,
    reason,
  });
}

function changed(context: SimulationContext): void {
  context.draft.combat.version += 1;
  context.invalidate('combat');
  context.invalidate('navigation');
  context.invalidate('site');
  context.invalidate('frame');
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
