import type { NavigationRules } from '@engine/ports';
import {
  add,
  angleOf,
  distance,
  magnitude,
  moveVectorToward,
  normalized,
  scale,
  subtract,
  turnToward,
  vectorFromAngle,
} from './geometry';
import type { MovementOrder, MutableKinematics, SiteObjectState, Vector2 } from './types';

export interface MovementAttributes {
  readonly maxSpeedKmPerSecond: number;
  readonly accelerationKmPerSecondSquared: number;
  readonly brakingKmPerSecondSquared: number;
  readonly turnRateRadiansPerSecond: number;
}

export interface MovementControl {
  readonly direction: Vector2;
  readonly speedKmPerSecond: number;
}

export function movementControl(
  order: MovementOrder,
  actor: SiteObjectState,
  target: SiteObjectState | null,
  attributes: MovementAttributes,
  rules: NavigationRules,
): MovementControl | null {
  if (order.kind === 'stop') {
    return { direction: vectorFromAngle(actor.facingRadians), speedKmPerSecond: 0 };
  }
  if (order.kind === 'moveToPoint') {
    const offset = subtract(order.point, actor.position);
    const remaining = magnitude(offset);
    return {
      direction: normalized(offset, vectorFromAngle(actor.facingRadians)),
      speedKmPerSecond: stoppingSpeed(
        remaining - rules.approachToleranceKm,
        attributes,
      ),
    };
  }
  if (target === null) return null;

  const toward = subtract(target.position, actor.position);
  const range = magnitude(toward);
  const inward = normalized(toward, vectorFromAngle(actor.facingRadians));
  const desiredRange = order.distanceKm;

  if (order.kind === 'approach') {
    return {
      direction: inward,
      speedKmPerSecond: stoppingSpeed(
        range - desiredRange - rules.approachToleranceKm,
        attributes,
      ),
    };
  }

  if (order.kind === 'keepRange') {
    const tolerance = Math.max(
      rules.minimumKeepRangeToleranceKm,
      desiredRange * rules.keepRangeToleranceFraction,
    );
    if (Math.abs(range - desiredRange) <= tolerance) {
      return { direction: inward, speedKmPerSecond: 0 };
    }
    return {
      direction: range > desiredRange ? inward : scale(inward, -1),
      speedKmPerSecond: stoppingSpeed(Math.abs(range - desiredRange) - tolerance, attributes),
    };
  }

  // Clockwise tangent, corrected radially toward the requested orbit. A
  // radial correction of one means a 45-degree intercept; it diminishes as
  // the ship converges on the requested radius.
  const tangent = { x: inward.y, y: -inward.x };
  const correction = Math.max(-1, Math.min(1, (range - desiredRange) / Math.max(desiredRange, 0.1)));
  return {
    direction: normalized(add(tangent, scale(inward, correction)), tangent),
    speedKmPerSecond: attributes.maxSpeedKmPerSecond,
  };
}

export function integrateKinematics(
  current: MutableKinematics,
  control: MovementControl,
  attributes: MovementAttributes,
  elapsedSeconds: number,
): MutableKinematics {
  const desiredAngle = angleOf(control.direction);
  const facingRadians = turnToward(
    current.facingRadians,
    desiredAngle,
    attributes.turnRateRadiansPerSecond * elapsedSeconds,
  );
  const desiredVelocity = scale(vectorFromAngle(facingRadians), control.speedKmPerSecond);
  const currentSpeed = magnitude(current.velocity);
  const acceleration =
    control.speedKmPerSecond < currentSpeed
      ? attributes.brakingKmPerSecondSquared
      : attributes.accelerationKmPerSecondSquared;
  const velocity = moveVectorToward(current.velocity, desiredVelocity, acceleration * elapsedSeconds);
  return {
    facingRadians,
    velocity,
    position: add(current.position, scale(velocity, elapsedSeconds)),
  };
}

export function rangeTo(actor: SiteObjectState, target: SiteObjectState): number {
  return distance(actor.position, target.position);
}

/** Maximum desired speed from which the ship can still brake over the distance. */
function stoppingSpeed(
  remainingKm: number,
  attributes: MovementAttributes,
): number {
  if (remainingKm <= 0) return 0;
  return Math.min(
    attributes.maxSpeedKmPerSecond,
    Math.sqrt(2 * attributes.brakingKmPerSecondSquared * remainingKm),
  );
}
