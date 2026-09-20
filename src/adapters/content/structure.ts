import {
  findStructuralViolation as findViolation,
  type StructuralViolation,
  type StructuralViolationReason,
} from '@shared';

import { CONTENT_LIMITS } from './limits.ts';

/**
 * Applies the content limits to a value (Technical Specification 14).
 *
 * @implements TECH-14
 */

export type { StructuralViolation, StructuralViolationReason };

/**
 * Returns the first structural violation in `value`, or `null` when it is
 * within every content limit.
 */
export function findStructuralViolation(
  value: unknown,
  rootPath = '',
): StructuralViolation | null {
  return findViolation(value, CONTENT_LIMITS, rootPath);
}
