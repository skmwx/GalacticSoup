import { describe, expect, it } from 'vitest';

import {
  campaignStateHash,
  createCampaign,
  runCommand,
  type CampaignState,
} from '@engine';
import { onboardingProjection } from '@engine/projections';
import { canonicalJson } from '@shared';

import { testCampaign } from '../../support/campaign.ts';
import { shippedContent } from '../../support/content.ts';
import { fixtureRepository } from '../../support/contentFixtures.ts';
import { command, reasonOf, refusal } from '../../support/loss.ts';

/**
 * Guidance progress: the declarative objective chain, its skip and hide
 * behaviour and its one-time grants (Functional Specification 3.2; Technical
 * Specification 10.6, 15.3 check 9).
 */

const content = shippedContent();
const SCOUT = 'encounter.borrell.pirate-scout';

function statusOf(state: CampaignState, stepId: string): string | undefined {
  return onboardingProjection(state, content).chains
    .flatMap((chain) => chain.steps)
    .find((step) => step.id === stepId)?.status;
}

describe('guidance progress', () => {
  it('starts every campaign at the first step, shown [FUNC-3.2, MVP-AC-10]', () => {
    const view = onboardingProjection(testCampaign(), content);

    expect(view.hidden).toBe(false);
    expect(view.currentStepId).toBe('guide.loop.choose-site');
    expect(view.chains[0]?.completedCount).toBe(0);
    expect(view.chains[0]?.steps.every((step) => step.recordedAtMs === null)).toBe(true);
  });

  it('completes a step when the player does what it asks, inside the same transaction [FUNC-3.2, TECH-10.6]', () => {
    const chosen = command(testCampaign(), 'navigation.selectDestination', { encounterId: SCOUT });

    expect(chosen.state.onboarding.steps['guide.loop.choose-site']).toEqual({
      outcome: 'completed',
      atMs: chosen.state.time.simulationTimeMs,
    });
    expect(chosen.data.events.map((event) => event.kind)).toEqual([
      'navigation.destinationSelected',
      'onboarding.stepCompleted',
      'notification.raised',
    ]);
    expect(chosen.data.invalidations).toEqual(expect.arrayContaining(['onboarding', 'notifications']));
    expect(onboardingProjection(chosen.state, content).currentStepId).toBe('guide.loop.carry-rounds');
  });

  it('grants a step once however often its event recurs [TECH-10.6, TECH-15.3]', () => {
    const once = command(testCampaign(), 'navigation.selectDestination', { encounterId: SCOUT });
    const twice = command(once.state, 'navigation.selectDestination', {
      encounterId: 'encounter.borrell.pirate-patrol',
    });

    expect(twice.data.events.map((event) => event.kind)).toEqual(['navigation.destinationSelected']);
    expect(twice.state.onboarding).toEqual(once.state.onboarding);
  });

  it('counts a step done early rather than asking for it again [FUNC-3.2]', () => {
    // Undocking is the second step; doing it first still completes it.
    const undocked = command(testCampaign(), 'ship.undock', {});

    expect(statusOf(undocked.state, 'guide.loop.undock')).toBe('completed');
    expect(statusOf(undocked.state, 'guide.loop.choose-site')).toBe('current');
  });

  it('asks for spare rounds in the hold, where a gun reloads from [FUNC-3.2, FUNC-9.4]', () => {
    const start = testCampaign();
    const ship = start.assets.ships[start.assets.activeShipId!]!;
    const spare = Object.values(start.assets.stacks).find((stack) =>
      stack.definitionId === 'ammo.projectile.small.fusion' && stack.state.kind === 'plain')!;
    expect(statusOf(start, 'guide.loop.carry-rounds')).toBe('open');

    const few = command(start, 'inventory.transfer', {
      stackId: spare.id, destinationInventoryId: ship.cargoInventoryId, quantity: 10,
    });
    expect(few.state.onboarding.steps['guide.loop.carry-rounds']).toBeUndefined();

    const carried = Object.values(few.state.assets.stacks).find((stack) =>
      stack.inventoryId === spare.inventoryId && stack.definitionId === spare.definitionId)!;
    const enough = command(few.state, 'inventory.transfer', {
      stackId: carried.id, destinationInventoryId: ship.cargoInventoryId, quantity: carried.quantity,
    });
    expect(enough.state.onboarding.steps['guide.loop.carry-rounds']?.outcome).toBe('completed');
  });

  it('opens a step only once what it requires is behind the player [TECH-10.6]', () => {
    const start = testCampaign();
    // A new ship is already repaired, supplied and charged, but the ready-check
    // belongs after a sortie, so it waits for the return.
    expect(statusOf(start, 'guide.loop.ready')).toBe('waiting');
    const paused = command(start, 'time.set', { paused: false, rate: 1 });
    expect(paused.state.onboarding.steps['guide.loop.ready']).toBeUndefined();
  });

  it('skips a step without granting anything, and says why a skip is refused [FUNC-3.2, FUNC-22.10]', () => {
    const start = testCampaign();
    const skipped = command(start, 'onboarding.skipStep', { stepId: 'guide.loop.choose-site' });

    expect(skipped.state.onboarding.steps['guide.loop.choose-site']?.outcome).toBe('skipped');
    expect(skipped.state.assets).toEqual(start.assets);
    expect(skipped.data.events.map((event) => event.kind)).toEqual(['onboarding.stepSkipped']);
    expect(reasonOf(refusal(skipped.state, 'onboarding.skipStep', { stepId: 'guide.loop.choose-site' })))
      .toBe('guidanceStepRecorded');
    expect(reasonOf(refusal(start, 'onboarding.skipStep', { stepId: 'guide.loop.nowhere' })))
      .toBe('guidanceStepUnknown');

    const fixtures = fixtureRepository();
    const minimal = {
      ...createCampaign({ displayName: 'Test', seed: '0123456789abcdef0123456789abcdef',
        createdAtRealMs: 0, initialRate: 1 }, fixtures),
      revision: 1,
    };
    expect(reasonOf(refusal(minimal, 'onboarding.skipStep', { stepId: 'guide.test.undock' }, fixtures)))
      .toBe('guidanceStepNotSkippable');
  });

  it('can always reach the end by skipping, so no step is a dead end [FUNC-3.2, TECH-10.6]', () => {
    let state = testCampaign();
    for (const step of content.guidanceChains().flatMap((chain) => chain.steps)) {
      expect(step.skippable, step.id).toBe(true);
      // Skipping one step can open another the ship already satisfies - the
      // ready-check, for a new ship - which then completes by itself.
      if (state.onboarding.steps[step.id] !== undefined) continue;
      state = command(state, 'onboarding.skipStep', { stepId: step.id }).state;
    }
    const view = onboardingProjection(state, content);
    expect(view.currentStepId).toBeNull();
    expect(view.chains.every((chain) => chain.finished)).toBe(true);
  });

  it('hides and shows the guidance, and keeps recording while hidden [FUNC-3.2]', () => {
    const hidden = command(testCampaign(), 'onboarding.hide', {});
    expect(hidden.state.onboarding.hidden).toBe(true);
    expect(runCommand({ campaign: hidden.state, content, type: 'onboarding.hide', payload: {} }).kind)
      .toBe('unchanged');

    const chosen = command(hidden.state, 'navigation.selectDestination', { encounterId: SCOUT });
    expect(chosen.state.onboarding.steps['guide.loop.choose-site']?.outcome).toBe('completed');
    // A hidden guidance does not announce its steps.
    expect(chosen.data.events.map((event) => event.kind)).not.toContain('notification.raised');

    const shown = command(chosen.state, 'onboarding.show', {});
    expect(shown.state.onboarding.hidden).toBe(false);
    expect(onboardingProjection(shown.state, content).currentStepId).toBe('guide.loop.carry-rounds');
  });

  it('never completes a step while a campaign is only being restored [TECH-9.5, TECH-11.4]', () => {
    // A snapshot whose ship is ready and whose return step is behind it: the
    // ready-check would complete on the next observed transaction.
    const base = testCampaign();
    const snapshot: CampaignState = {
      ...base,
      onboarding: {
        ...base.onboarding,
        version: 2,
        steps: { 'guide.loop.undock': { outcome: 'skipped', atMs: 0 }, 'guide.loop.return': { outcome: 'skipped', atMs: 0 } },
      },
    };
    const resumed = runCommand({ campaign: null, content, type: 'campaign.resume', payload: { state: snapshot } });
    expect(resumed.kind).toBe('committed');
    if (resumed.kind !== 'committed' || resumed.campaign === null) return;
    expect(campaignStateHash(resumed.campaign)).toBe(campaignStateHash(snapshot));

    const running = command(resumed.campaign, 'time.set', { paused: false, rate: 1 });
    expect(running.state.onboarding.steps['guide.loop.ready']?.outcome).toBe('completed');
  });

  it('draws no random number and moves only guidance and notification state [TECH-9.4, TECH-9.5]', () => {
    const start = testCampaign();
    const plain = command(start, 'onboarding.skipStep', { stepId: 'guide.loop.undock' });
    const chosen = command(plain.state, 'navigation.selectDestination', { encounterId: SCOUT });

    expect(canonicalJson(chosen.state.random)).toBe(canonicalJson(start.random));
    expect(chosen.state.assets).toEqual(start.assets);
  });
});
