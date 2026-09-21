import { describe, expect, it } from 'vitest';

import {
  angularVelocity,
  deterministicDirection,
  distance,
  instantiateSite,
  integrateKinematics,
  movementControl,
  normalized,
  transverseVelocity,
  type SiteLocation,
  type SiteObjectState,
} from '@engine/domain';
import { advanceNavigation } from '@engine/simulation';
import type { StationId } from '@shared';
import { testDraft, testSimulation } from '../../support/campaign';
import { shippedContent } from '../../support/content';

const content = shippedContent();
const rules = content.rules.navigation;
const attributes = {
  maxSpeedKmPerSecond: 1,
  accelerationKmPerSecondSquared: 0.5,
  brakingKmPerSecondSquared: 1,
  turnRateRadiansPerSecond: Math.PI / 2,
};
const actor: SiteObjectState = {
  id: 'actor', kind: 'ship', definitionId: 'hull.test.actor', nameKey: 'actor',
  position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, facingRadians: 0,
  radiusKm: 0.1, movable: true,
};
const target: SiteObjectState = {
  id: 'target', kind: 'station', definitionId: 'station.test.target', nameKey: 'target',
  position: { x: 10, y: 0 }, velocity: { x: 0, y: 0 }, facingRadians: 0,
  radiusKm: 1, movable: false,
};

describe('navigation geometry', () => {
  it('handles zero-distance and relative-motion edge cases [FUNC-7.2, TECH-9.3]', () => {
    expect(normalized({ x: 0, y: 0 }, { x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
    expect(angularVelocity({ x: 0, y: 0 }, { x: 10, y: -4 })).toBe(0);
    expect(transverseVelocity({ x: 10, y: 0 }, { x: -2, y: 3 })).toBe(3);
    expect(distance({ x: -3, y: -4 }, { x: 0, y: 0 })).toBe(5);
  });

  it('uses an antisymmetric deterministic direction for exact overlaps [FUNC-5.3, TECH-9.3]', () => {
    const forward = deterministicDirection('alpha', 'beta');
    const reverse = deterministicDirection('beta', 'alpha');
    expect(forward.x).toBeCloseTo(-reverse.x, 12);
    expect(forward.y).toBeCloseTo(-reverse.y, 12);
  });
});

describe('movement controllers', () => {
  it('implements approach, keep range, orbit, move-to-point and stop [MVP-AC-03, FUNC-7.1, FUNC-7.2]', () => {
    expect(movementControl({ kind: 'approach', targetId: target.id, distanceKm: 2 }, actor, target, attributes, rules)?.speedKmPerSecond).toBe(1);
    expect(movementControl({ kind: 'keepRange', targetId: target.id, distanceKm: 10 }, actor, target, attributes, rules)?.speedKmPerSecond).toBe(0);
    const orbit = movementControl({ kind: 'orbit', targetId: target.id, distanceKm: 5 }, actor, target, attributes, rules);
    expect(orbit?.direction.y).toBeLessThan(0);
    expect(movementControl({ kind: 'moveToPoint', point: { x: 0, y: 0 } }, actor, null, attributes, rules)?.speedKmPerSecond).toBe(0);
    expect(movementControl({ kind: 'stop' }, actor, null, attributes, rules)?.speedKmPerSecond).toBe(0);
    const nearby = { ...target, position: { x: 0.2, y: 0 } };
    expect(movementControl({ kind: 'approach', targetId: nearby.id, distanceKm: 0 }, actor, nearby, attributes, rules)?.speedKmPerSecond)
      .toBeLessThan(attributes.maxSpeedKmPerSecond);
  });

  it('constrains turn, acceleration and braking [FUNC-7.2, TECH-9.3]', () => {
    const accelerated = integrateKinematics(
      actor,
      { direction: { x: 0, y: 1 }, speedKmPerSecond: 1 },
      attributes,
      0.5,
    );
    expect(accelerated.facingRadians).toBeCloseTo(Math.PI / 4, 12);
    expect(Math.hypot(accelerated.velocity.x, accelerated.velocity.y)).toBeCloseTo(0.25, 12);

    const stopped = integrateKinematics(
      { position: accelerated.position, velocity: { x: 1, y: 0 }, facingRadians: 0 },
      { direction: { x: 1, y: 0 }, speedKmPerSecond: 0 },
      attributes,
      0.25,
    );
    expect(Math.hypot(stopped.velocity.x, stopped.velocity.y)).toBeCloseTo(0.75, 12);
  });

  it('cancels a targeted order deterministically when its target disappears [FUNC-7.1, FUNC-7.2, TECH-9.2]', () => {
    const draft = testDraft();
    const station = content.requireStation(
      content.rules.economy.startingStationId as StationId,
    );
    const ship = draft.assets.ships[draft.assets.activeShipId];
    if (ship === undefined) throw new Error('The test campaign has no active ship.');
    const location: SiteLocation = {
      kind: 'site',
      systemId: station.systemId,
      siteId: station.siteId,
    };
    draft.navigation.currentSite = instantiateSite(
      draft,
      content,
      station.siteId,
      ship,
      { x: 2, y: 0 },
      0,
    );
    draft.assets.location = location;
    ship.location = location;
    draft.navigation.movement = {
      kind: 'approach',
      targetId: station.id,
      distanceKm: 0,
    };
    delete draft.navigation.currentSite.objects[station.id];
    const context = testSimulation(draft, content);

    advanceNavigation(context, 0, 250);

    expect(draft.navigation.movement).toEqual({ kind: 'stop' });
    expect(draft.navigation.lastCancellation).toEqual({
      orderKind: 'approach',
      reason: 'targetMissing',
      simulationTimeMs: 0,
    });
    expect(context.events.at(-1)?.kind).toBe('navigation.movementCancelled');
  });
});
