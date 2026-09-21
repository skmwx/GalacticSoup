import type { Vector2 } from './types';

export const TAU = Math.PI * 2;
const EPSILON = 1e-12;

/** Dependency-free geometry shared by movement, targeting and projections. */
export function add(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(vector: Vector2, amount: number): Vector2 {
  return { x: vector.x * amount, y: vector.y * amount };
}

export function magnitudeSquared(vector: Vector2): number {
  return vector.x * vector.x + vector.y * vector.y;
}

export function magnitude(vector: Vector2): number {
  return Math.sqrt(magnitudeSquared(vector));
}

export function distance(a: Vector2, b: Vector2): number {
  return magnitude(subtract(a, b));
}

export function dot(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y;
}

/** Two-dimensional scalar cross product. */
export function cross(a: Vector2, b: Vector2): number {
  return a.x * b.y - a.y * b.x;
}

export function normalized(vector: Vector2, fallback: Vector2 = { x: 1, y: 0 }): Vector2 {
  const length = magnitude(vector);
  return length <= EPSILON ? { ...fallback } : scale(vector, 1 / length);
}

export function vectorFromAngle(radians: number): Vector2 {
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

export function angleOf(vector: Vector2): number {
  return Math.atan2(vector.y, vector.x);
}

export function normalizeAngle(radians: number): number {
  const wrapped = ((radians + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function angularDifference(fromRadians: number, toRadians: number): number {
  return normalizeAngle(toRadians - fromRadians);
}

export function turnToward(fromRadians: number, toRadians: number, maximumTurn: number): number {
  const difference = angularDifference(fromRadians, toRadians);
  const applied = Math.max(-maximumTurn, Math.min(maximumTurn, difference));
  return normalizeAngle(fromRadians + applied);
}

/** Moves one velocity toward another without exceeding the acceleration budget. */
export function moveVectorToward(current: Vector2, desired: Vector2, maximumDelta: number): Vector2 {
  const delta = subtract(desired, current);
  const length = magnitude(delta);
  return length <= maximumDelta || length <= EPSILON
    ? { ...desired }
    : add(current, scale(delta, maximumDelta / length));
}

export function radialSpeed(relativePosition: Vector2, relativeVelocity: Vector2): number {
  return dot(relativeVelocity, normalized(relativePosition));
}

export function transverseVelocity(relativePosition: Vector2, relativeVelocity: Vector2): number {
  const radial = normalized(relativePosition);
  return Math.abs(cross(radial, relativeVelocity));
}

export function angularVelocity(relativePosition: Vector2, relativeVelocity: Vector2): number {
  const squared = magnitudeSquared(relativePosition);
  return squared <= EPSILON ? 0 : Math.abs(cross(relativePosition, relativeVelocity)) / squared;
}

/** A stable fallback direction for two objects at exactly the same point. */
export function deterministicDirection(firstId: string, secondId: string): Vector2 {
  const pair = firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;
  let hash = 2166136261;
  for (let index = 0; index < pair.length; index += 1) {
    hash ^= pair.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const direction = vectorFromAngle((hash / 0x1_0000_0000) * TAU);
  return firstId < secondId ? direction : scale(direction, -1);
}

