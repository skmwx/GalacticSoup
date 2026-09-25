import type { ContentRepository, DamageProfile } from '@engine/ports';
import type { MessageKey } from '@shared';

import { stacksIn } from '../assets/inventory';
import type { CampaignState } from '../campaign/state';
import type { AggregatedDamageEvent } from '../combat/types';
import { shipFit } from '../fitting/fit';

import type {
  LossDamageSourceRecord,
  LossDisablingEffectRecord,
  LossFinalDamageRecord,
} from './types';

/**
 * The parts of a loss report read from the fight itself
 * (Functional Specification 9.12; Technical Specification 10.3).
 *
 * The combat recorder already keeps a bounded, aggregated history of who hit
 * whom with what; the report freezes the stretch of it that ended the ship,
 * because the attackers, their ships and the recorder's window will all move
 * on once the destruction commits.
 *
 * @implements FUNC-9.12, TECH-10.3
 */

/** Resolves the name an attacker is shown by. */
export type SourceName = (sourceId: string) => MessageKey;

/** Incoming damage by attacker, in the order each first hit the ship. */
export function incomingDamage(
  state: CampaignState,
  shipId: string,
  sinceMs: number,
  nameOf: SourceName,
): readonly LossDamageSourceRecord[] {
  const bySource = new Map<string, LossDamageSourceRecord>();
  for (const event of damageAgainst(state, shipId, sinceMs)) {
    const previous = bySource.get(event.sourceId);
    bySource.set(event.sourceId, previous === undefined
      ? {
          sourceId: event.sourceId,
          nameKey: nameOf(event.sourceId),
          hits: event.count,
          firstAtMs: event.firstAtMs,
          lastAtMs: event.lastAtMs,
          rawDamage: { ...event.rawDamage },
          appliedDamage: { ...event.appliedDamage },
          layerDamage: { ...event.layerDamage },
        }
      : {
          ...previous,
          hits: previous.hits + event.count,
          lastAtMs: Math.max(previous.lastAtMs, event.lastAtMs),
          rawDamage: addProfiles(previous.rawDamage, event.rawDamage),
          appliedDamage: addProfiles(previous.appliedDamage, event.appliedDamage),
          layerDamage: {
            shield: round(previous.layerDamage.shield + event.layerDamage.shield),
            armor: round(previous.layerDamage.armor + event.layerDamage.armor),
            hull: round(previous.layerDamage.hull + event.layerDamage.hull),
          },
        });
  }
  return [...bySource.values()];
}

/** The last burst of fire before the hull gave out. */
export function finalDamage(
  state: CampaignState,
  shipId: string,
  sinceMs: number,
  nameOf: SourceName,
): LossFinalDamageRecord | null {
  // Shots committed in the same instant as the killing one still land, on a
  // hull that is already gone, and remove nothing: the burst that ended the
  // ship is the last one that removed hit points.
  const events = damageAgainst(state, shipId, sinceMs);
  const last = [...events].reverse().find((event) => totalOf(event.appliedDamage) > 0) ?? events.at(-1);
  if (last === undefined) return null;
  return {
    sourceId: last.sourceId,
    nameKey: nameOf(last.sourceId),
    slotKey: last.slotKey,
    hits: last.count,
    atMs: last.lastAtMs,
    rawDamage: { ...last.rawDamage },
    appliedDamage: { ...last.appliedDamage },
  };
}

/**
 * What had stopped working by the end: an active module the capacitor could
 * no longer pay for, and a weapon with nothing left to load.
 */
export function disablingEffects(
  state: CampaignState,
  content: ContentRepository,
  shipId: string,
): readonly LossDisablingEffectRecord[] {
  const ship = state.assets.ships[shipId];
  if (ship === undefined) return [];
  const effects: LossDisablingEffectRecord[] = [];
  const cargo = stacksIn(state.assets, ship.cargoInventoryId);
  for (const fitted of shipFit(state.assets, shipId)) {
    const module = content.module(fitted.moduleId);
    if (module === undefined || !fitted.online) continue;
    const cost = module.activation?.capacitorPerCycle ?? 0;
    if (cost > 0 && ship.condition.capacitorCharge + 1e-9 < cost) {
      effects.push({ kind: 'capacitorDepleted', slot: { ...fitted.slot }, moduleId: fitted.moduleId });
    }
    if (module.category !== 'turret') continue;
    const loaded = fitted.charge?.quantity ?? 0;
    const reloadable = cargo.some((stack) =>
      stack.state.kind === 'plain' &&
      content.ammunition(stack.definitionId)?.group === module.turret.ammunitionGroup);
    if (loaded === 0 && !reloadable) {
      effects.push({ kind: 'ammunitionExhausted', slot: { ...fitted.slot }, moduleId: fitted.moduleId });
    }
  }
  return effects;
}

function damageAgainst(
  state: CampaignState,
  shipId: string,
  sinceMs: number,
): readonly AggregatedDamageEvent[] {
  return state.combat.events.filter(
    (event): event is AggregatedDamageEvent =>
      event.kind === 'damage' && event.targetId === shipId && event.lastAtMs >= sinceMs,
  );
}

function addProfiles(a: DamageProfile, b: DamageProfile): DamageProfile {
  return {
    electromagnetic: round(a.electromagnetic + b.electromagnetic),
    thermal: round(a.thermal + b.thermal),
    kinetic: round(a.kinetic + b.kinetic),
    explosive: round(a.explosive + b.explosive),
  };
}

function totalOf(profile: DamageProfile): number {
  return profile.electromagnetic + profile.thermal + profile.kinetic + profile.explosive;
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
