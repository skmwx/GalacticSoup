import type { DamageProfile, DefenseLayer } from '@engine/ports';

import type { CampaignDraft } from '../campaign/state';

import { addProfiles, emptyDamageProfile } from './damage';
import type { CombatEventRecord } from './types';

/** Bounded significant-event recorder (Technical Specification 10.3, 13). */
export const COMBAT_EVENT_LIMIT = 128;
export const COMBAT_EVENT_AGGREGATION_WINDOW_MS = 5_000;

export function recordDamageEvent(
  draft: CampaignDraft,
  event: {
    readonly sourceId: string;
    readonly targetId: string;
    readonly slotKey: string;
    readonly rawDamage: DamageProfile;
    readonly appliedDamage: DamageProfile;
  },
): void {
  const now = draft.time.simulationTimeMs;
  const events = mutableEvents(draft);
  const previous = events.at(-1);
  if (
    previous?.kind === 'damage' &&
    previous.sourceId === event.sourceId &&
    previous.targetId === event.targetId &&
    previous.slotKey === event.slotKey &&
    now - previous.lastAtMs <= COMBAT_EVENT_AGGREGATION_WINDOW_MS
  ) {
    events[events.length - 1] = {
      ...previous,
      lastAtMs: now,
      count: previous.count + 1,
      rawDamage: addProfiles(previous.rawDamage, event.rawDamage),
      appliedDamage: addProfiles(previous.appliedDamage, event.appliedDamage),
    };
  } else {
    events.push({
      kind: 'damage',
      firstAtMs: now,
      lastAtMs: now,
      sourceId: event.sourceId,
      targetId: event.targetId,
      slotKey: event.slotKey,
      count: 1,
      rawDamage: addProfiles(emptyDamageProfile(), event.rawDamage),
      appliedDamage: addProfiles(emptyDamageProfile(), event.appliedDamage),
    });
  }
  trim(events);
}

export function recordRepairEvent(
  draft: CampaignDraft,
  event: {
    readonly shipId: string;
    readonly slotKey: string;
    readonly layer: DefenseLayer;
    readonly repairedHitPoints: number;
  },
): void {
  const now = draft.time.simulationTimeMs;
  const events = mutableEvents(draft);
  const previous = events.at(-1);
  if (
    previous?.kind === 'repair' &&
    previous.shipId === event.shipId &&
    previous.slotKey === event.slotKey &&
    previous.layer === event.layer &&
    now - previous.lastAtMs <= COMBAT_EVENT_AGGREGATION_WINDOW_MS
  ) {
    events[events.length - 1] = {
      ...previous,
      lastAtMs: now,
      count: previous.count + 1,
      repairedHitPoints: round(previous.repairedHitPoints + event.repairedHitPoints),
    };
  } else {
    events.push({
      kind: 'repair',
      firstAtMs: now,
      lastAtMs: now,
      shipId: event.shipId,
      slotKey: event.slotKey,
      layer: event.layer,
      count: 1,
      repairedHitPoints: event.repairedHitPoints,
    });
  }
  trim(events);
}

export function recordDestructionEvent(draft: CampaignDraft, shipId: string): void {
  const now = draft.time.simulationTimeMs;
  const events = mutableEvents(draft);
  events.push({
    kind: 'destruction',
    firstAtMs: now,
    lastAtMs: now,
    shipId,
    count: 1,
  });
  trim(events);
}

function mutableEvents(draft: CampaignDraft): CombatEventRecord[] {
  return draft.combat.events as CombatEventRecord[];
}

function trim(events: CombatEventRecord[]): void {
  if (events.length > COMBAT_EVENT_LIMIT) {
    events.splice(0, events.length - COMBAT_EVENT_LIMIT);
  }
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
