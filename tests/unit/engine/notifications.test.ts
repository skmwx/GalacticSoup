import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_HISTORY_LIMIT,
  raiseNotification,
  validateCampaign,
  type CampaignDraft,
  type CampaignState,
  type DomainEvent,
  type DomainEventKind,
  type DomainEventParams,
} from '@engine/domain';
import type { NotificationDefinition } from '@engine/ports';
import { notificationsProjection } from '@engine/projections';
import { raiseNotifications } from '@engine/simulation';
import { deepClone } from '@shared';

import { testCampaign, testDraft, testSimulation } from '../../support/campaign.ts';
import { combatFixture } from '../../support/combat.ts';
import { shippedContent } from '../../support/content.ts';
import { encounterFixture, opponentIds } from '../../support/encounter.ts';
import { command } from '../../support/loss.ts';

/**
 * Semantic notifications: registered triggers, grouping, the bounded history
 * and the immediate-danger list (Functional Specification 19.7; Technical
 * Specification 12.4, 13).
 */

const content = shippedContent();

function definition(id: string): NotificationDefinition {
  const found = content.notification(id);
  if (found === undefined) throw new Error(`No notification ${id}.`);
  return found;
}

function event(draft: CampaignDraft, kind: DomainEventKind, params: DomainEventParams): DomainEvent {
  const ordinal = draft.nextEventOrdinal;
  draft.nextEventOrdinal += 1;
  return { ordinal, kind, simulationTimeMs: draft.time.simulationTimeMs, params };
}

function raised(draft: CampaignDraft): readonly string[] {
  return draft.notifications.entries.map((entry) => entry.definitionId);
}

describe('notification history', () => {
  it('groups repeats inside the window and adds up what accumulates [FUNC-19.7, TECH-12.4]', () => {
    const draft = testDraft();
    const bounty = definition('notify.encounter.bounty');
    const raise = (atMs: number, credits: number) => raiseNotification(draft, {
      definition: bounty, atMs, groupSubject: '', subjectIds: [], params: { credits }, accumulate: ['credits'],
    });

    raise(1_000, 4_000);
    raise(20_000, 5_000);
    const grouped = draft.notifications.entries;
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ count: 2, firstAtMs: 1_000, lastAtMs: 20_000, params: { credits: 9_000 } });

    // Past the thirty-second window a new entry starts.
    raise(60_000, 6_000);
    expect(draft.notifications.entries).toHaveLength(2);
    expect(draft.notifications.sequence).toBe(3);
  });

  it('bounds the history and keeps sequence numbers monotonic [TECH-13, TECH-15.3]', () => {
    const draft = testDraft();
    const docked = definition('notify.navigation.docked');
    for (let index = 0; index < NOTIFICATION_HISTORY_LIMIT + 10; index += 1) {
      raiseNotification(draft, {
        definition: docked, atMs: 0, groupSubject: '', subjectIds: [],
        params: { stationKey: 'content.station.borrell.harbour.name' }, accumulate: [],
      });
    }

    expect(draft.notifications.entries).toHaveLength(NOTIFICATION_HISTORY_LIMIT);
    expect(draft.notifications.entries[0]?.id).toBe(11);
    expect(draft.notifications.sequence).toBe(NOTIFICATION_HISTORY_LIMIT + 10);
    expect(validateCampaign(draft as unknown as CampaignState, content)).toEqual([]);
  });

  it('publishes the history newest first with the severity, cue and hideability of its definition [FUNC-19.7, TECH-7.3]', () => {
    const draft = testDraft();
    raiseNotification(draft, {
      definition: definition('notify.navigation.docked'), atMs: 0, groupSubject: '', subjectIds: [],
      params: {}, accumulate: [],
    });
    raiseNotification(draft, {
      definition: definition('notify.recovery.ship-lost'), atMs: 0, groupSubject: '', subjectIds: [],
      params: {}, accumulate: [],
    });

    const view = notificationsProjection(draft as unknown as CampaignState, content);
    expect(view.entries.map((entry) => entry.definitionId)).toEqual(['notify.recovery.ship-lost', 'notify.navigation.docked']);
    expect(view.entries[0]).toMatchObject({ severity: 'danger', hideable: false, category: 'recovery' });
    expect(view.entries[0]?.cueId).not.toBeNull();
  });
});

describe('immediate danger (Functional Specification 19.7)', () => {
  it('reports the first hostile lock of a site visit, once, naming the attacker [FUNC-19.7, TECH-12.4]', () => {
    const fixture = encounterFixture();
    const attackerId = opponentIds(fixture)[0]!;
    const context = testSimulation(fixture.draft, fixture.content);
    const lock = () => event(fixture.draft, 'combat.lockCompleted', { shipId: attackerId, targetId: fixture.playerId });

    raiseNotifications(context, [lock()], null);
    raiseNotifications(context, [lock()], null);
    expect(raised(fixture.draft).filter((id) => id === 'notify.combat.hostile-lock')).toHaveLength(1);

    const entry = () => fixture.draft.notifications.entries.find((record) => record.definitionId === 'notify.combat.hostile-lock');
    expect(entry()?.count).toBe(1);

    // A new site visit makes the next hostile lock the first again; inside the
    // group window it joins the same entry with a count.
    raiseNotifications(context, [event(fixture.draft, 'navigation.warpArrived', { siteId: 'site.borrell.verge' }), lock()], null);
    expect(entry()?.count).toBe(2);
    expect(entry()?.params['attackerKey']).toBe('content.npc.pirate.scout.name');
    expect(entry()?.subjectIds).toEqual([attackerId]);
  });

  it('ignores the player locking an opponent [FUNC-19.7]', () => {
    const fixture = combatFixture();
    raiseNotifications(testSimulation(fixture.draft, fixture.content),
      [event(fixture.draft, 'combat.lockCompleted', { shipId: fixture.playerId, targetId: fixture.targetId })], null);
    expect(raised(fixture.draft)).not.toContain('notify.combat.hostile-lock');
  });

  it('reports the shield falling through its threshold, and armour and hull first taking damage [FUNC-19.7]', () => {
    const fixture = combatFixture({ armTarget: true });
    const before = deepClone(fixture.draft) as unknown as CampaignState;
    const ship = fixture.draft.assets.ships[fixture.playerId]!;
    // Most of the shield is gone, and the same volley reached armour and hull.
    ship.condition.damage.shield = 1_000_000;
    ship.condition.damage.armor = 1;
    ship.condition.damage.hull = 1;
    const hit = event(fixture.draft, 'combat.damageApplied', {
      attackerId: fixture.targetId, targetId: fixture.playerId, slot: 'weapon:0',
      appliedDamage: 30, shieldDamage: 10, armorDamage: 10, hullDamage: 10,
    });

    raiseNotifications(testSimulation(fixture.draft, fixture.content), [hit], before);

    expect(raised(fixture.draft)).toEqual(expect.arrayContaining([
      'notify.combat.shield-low', 'notify.combat.armor-damaged', 'notify.combat.hull-damaged',
    ]));
    const low = fixture.draft.notifications.entries.find((entry) => entry.definitionId === 'notify.combat.shield-low');
    expect(low?.params['percent']).toBe(25);
  });

  it('reports an active defence waiting for capacitor [FUNC-19.7, FUNC-9.8]', () => {
    const fixture = combatFixture();
    const booster = content.modules().find((module) => module.category === 'shieldBooster')!;
    raiseNotifications(testSimulation(fixture.draft, fixture.content), [event(fixture.draft, 'combat.moduleWaiting', {
      shipId: fixture.playerId, slot: 'system:0', moduleId: booster.id, reason: 'insufficientCapacitor',
    })], null);

    const entry = fixture.draft.notifications.entries[0];
    expect(entry?.definitionId).toBe('notify.combat.defense-starved');
    expect(entry?.params['moduleKey']).toBe(booster.nameKey);
  });

  it('marks ship destruction as danger that cannot be hidden [FUNC-19.7, FUNC-9.12]', () => {
    const lost = definition('notify.recovery.ship-lost');
    expect(lost.severity).toBe('danger');
    expect(lost.hideable).toBe(false);
    for (const danger of content.notifications().filter((entry) => entry.severity === 'danger')) {
      expect(danger.cueId, danger.id).not.toBeNull();
    }
  });
});

describe('explaining what the player would otherwise miss', () => {
  it('warns when the ship undocks on a low capacitor, without refusing the undock [FUNC-9.8, FUNC-10]', () => {
    const start = testCampaign();
    const shipId = start.assets.activeShipId!;
    const drained = deepClone(start) as CampaignDraft;
    drained.assets.ships[shipId]!.condition.capacitorCharge = 5;

    const undocked = command(drained as unknown as CampaignState, 'ship.undock', {});
    const entry = undocked.state.notifications.entries.find((record) => record.definitionId === 'notify.navigation.low-capacitor');
    expect(content.notification(entry?.definitionId ?? '')?.severity).toBe('warning');
    expect(typeof entry?.params['percent']).toBe('number');
    expect(undocked.state.assets.location.kind).not.toBe('station');
  });

  it('tells the player a reloaded weapon is idle while a hostile is still locked [FUNC-9.4]', () => {
    const fixture = encounterFixture();
    const hostileId = opponentIds(fixture)[0]!;
    const combat = fixture.draft.combat.ships[fixture.playerId];
    (fixture.draft.combat.ships as Record<string, unknown>)[fixture.playerId] = {
      ...(combat ?? { weapons: {}, modules: {}, destroyedAtMs: null }),
      locks: [{ targetId: hostileId, status: 'locked', startedAtMs: 0, completesAtMs: null,
        boundaryEntryId: null, outOfRangeSinceMs: null }],
    };
    raiseNotifications(testSimulation(fixture.draft, fixture.content), [event(fixture.draft, 'combat.reloadCompleted', {
      shipId: fixture.playerId, slot: 'weapon:0', ammunitionId: 'ammo.projectile.small.fusion', rounds: 40,
    })], null);

    expect(raised(fixture.draft)).toContain('notify.combat.weapon-idle');
  });
});
