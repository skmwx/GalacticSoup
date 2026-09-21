import { setMovementOrder, type MovementOrder } from '@engine/domain';

import type { SimulationContext } from './context';

/**
 * Putting a standing movement order in place (Technical Specification 8.2,
 * 10.3).
 *
 * A movement order belongs to the ship that holds it, and both the player's
 * command handler and the opponent command adapter route through this one
 * operation, so an opponent cannot change course by a path the player does not
 * have.
 *
 * It lives apart from the movement integrator because the encounter lifecycle
 * and the navigation systems both need it, and the two may not import each
 * other (Technical Specification 4.3).
 *
 * @implements TECH-8.2, TECH-10.3, FUNC-7.1
 */
export function orderMovement(
  context: SimulationContext,
  shipId: string,
  order: MovementOrder | null,
): void {
  setMovementOrder(context.draft, shipId, order);
  context.draft.navigation.version += 1;
  context.invalidate('navigation');
  context.invalidate('site');
  context.invalidate('frame');
}
