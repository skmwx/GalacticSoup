import type { ContentRepository } from '@engine/ports';
import { isDefinitionIdIn } from '@shared';

import type { SpeedEffectInput } from '../attributes';
import { isEntityId } from '../campaign/identity';
import type { CampaignDraft, CampaignState } from '../campaign/state';
import { parseSlotKey } from '../fitting/types';

import type { SpeedEffectState } from './types';

/**
 * Temporary speed reductions (Functional Specification 9.9; Technical
 * Specification 8.2, 9.2, 15.3).
 *
 * An effect is a record of the loaded site that names the ship it slows. Its
 * expiry is a scheduled boundary owned by the effect itself, so it never
 * dangles when its source is destroyed or leaves: the source is a retained
 * attribution. A refresh from the same source replaces the expiry, and since
 * a completion resolves before an expiry at the same instant, a web that keeps
 * cycling keeps its effect without a gap (Functional Specification 4.2).
 *
 * The boundary kind is spelled out here rather than imported because the
 * domain may not reach the simulation package; a unit test holds the lists
 * together.
 *
 * @implements FUNC-9.9, TECH-8.2, TECH-9.2, TECH-15.3, V02-AC-07, V02-AC-13
 */

export const SPEED_EFFECT_EXPIRY_KIND = 'combat.speedEffectExpiry';

/** The effects of a draft, as a list the simulation may change. */
export function mutableSpeedEffects(draft: CampaignDraft): SpeedEffectState[] {
  return draft.combat.speedEffects as SpeedEffectState[];
}

/** Effects on one ship, in application order. */
export function speedEffectsOn(state: CampaignState, shipId: string): readonly SpeedEffectState[] {
  return state.combat.speedEffects.filter((effect) => effect.targetId === shipId);
}

/** The effect one source module holds on one target, if any. */
export function speedEffectFrom(
  state: CampaignState,
  sourceShipId: string,
  sourceSlotKey: string,
  targetId: string,
): SpeedEffectState | null {
  return state.combat.speedEffects.find((effect) =>
    effect.sourceShipId === sourceShipId &&
    effect.sourceSlotKey === sourceSlotKey &&
    effect.targetId === targetId) ?? null;
}

/**
 * What the attribute pipeline needs to apply the effects on one ship: each
 * source's factor and the label its trace step carries.
 */
export function speedEffectInputs(
  state: CampaignState,
  content: ContentRepository,
  shipId: string,
): readonly SpeedEffectInput[] {
  return speedEffectsOn(state, shipId).map((effect) => ({
    sourceId: effect.moduleId,
    sourceKey: content.module(effect.moduleId)?.nameKey ?? effect.moduleId,
    speedFactor: effect.speedFactor,
  }));
}

const SPEED_EFFECT_KEYS = [
  'id', 'targetId', 'sourceShipId', 'sourceSlotKey', 'moduleId', 'speedFactor',
  'appliedAtMs', 'expiresAtMs', 'expiryBoundaryEntryId',
] as const;

export function isSpeedEffectState(value: unknown): value is SpeedEffectState {
  if (!shape(value, SPEED_EFFECT_KEYS)) return false;
  const factor = value['speedFactor'];
  return (
    isEntityId(value['id']) &&
    isEntityId(value['targetId']) &&
    isEntityId(value['sourceShipId']) &&
    typeof value['sourceSlotKey'] === 'string' && parseSlotKey(value['sourceSlotKey']) !== null &&
    isDefinitionIdIn(value['moduleId'], 'module') &&
    typeof factor === 'number' && Number.isFinite(factor) && factor > 0 && factor < 1 &&
    count(value['appliedAtMs']) &&
    count(value['expiresAtMs']) && (value['expiresAtMs'] as number) >= (value['appliedAtMs'] as number) &&
    isEntityId(value['expiryBoundaryEntryId'])
  );
}

/**
 * Effect consistency (Technical Specification 15.3, checks 7 and 8): each
 * effect slows a ship present in the loaded site, owns its pending expiry,
 * has not outlived it, and is the only effect of its source on its target.
 * Nothing may survive the site being unloaded.
 */
export function validateSpeedEffects(
  state: CampaignState,
  fail: (path: string, detail: string) => void,
  content?: ContentRepository,
): void {
  const site = state.navigation.currentSite;
  const ids = new Set<string>();
  const sources = new Set<string>();
  state.combat.speedEffects.forEach((effect, index) => {
    const path = `speedEffects[${String(index)}]`;
    if (ids.has(effect.id)) fail(path, 'A speed effect id is used twice.');
    ids.add(effect.id);
    const source = `${effect.sourceShipId}|${effect.sourceSlotKey}|${effect.targetId}`;
    if (sources.has(source)) fail(path, 'One source holds at most one effect on one target.');
    sources.add(source);
    if (site === null) {
      fail(path, 'A speed effect cannot remain once its site is unloaded.');
      return;
    }
    const target = site.objects[effect.targetId];
    if (target === undefined || target.kind !== 'ship') {
      fail(path, 'A speed effect must slow a ship present in the loaded site.');
    }
    if (state.combat.ships[effect.targetId]?.destroyedAtMs != null) {
      fail(path, 'A destroyed ship carries no speed effect.');
    }
    if (effect.appliedAtMs > state.time.simulationTimeMs) {
      fail(path, 'A speed effect cannot have been applied in the future.');
    }
    if (effect.expiresAtMs < state.time.simulationTimeMs) {
      fail(path, 'A speed effect cannot outlive its duration.');
    }
    if (content !== undefined && content.module(effect.moduleId)?.category !== 'web') {
      fail(path, `"${effect.moduleId}" is not a speed-control module.`);
    }
    const entry = state.scheduler.entries.find((candidate) => candidate.entryId === effect.expiryBoundaryEntryId);
    if (entry === undefined || entry.ownerId !== effect.id || entry.kind !== SPEED_EFFECT_EXPIRY_KIND) {
      fail(path, `The ${SPEED_EFFECT_EXPIRY_KIND} boundary must exist and belong to this effect.`);
    } else if (entry.dueAtMs !== effect.expiresAtMs) {
      fail(path, 'A speed effect expires when its expiry boundary is due.');
    }
  });
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
