import {
  attributeValue,
  deriveShipAttributes,
  isStepOpen,
  recordStep,
  shipFit,
  type CampaignState,
  type DomainEvent,
} from '@engine/domain';
import type { ContentRepository, GuidancePredicate, GuidanceStepDefinition } from '@engine/ports';

import type { SimulationContext } from './context';

/**
 * Guidance progress (Functional Specification 3.2; Technical Specification
 * 9.2 step 9, 10.6).
 *
 * After a transaction has applied its change, every open guidance step is
 * checked against what that transaction did. A predicate is a registered
 * engine operation: most read the transaction's own domain events, and the
 * ready-check reads the ship's state. Nothing here issues a command, draws a
 * random number or changes anything but guidance progress.
 *
 * A step that completes may open another, which is checked against the same
 * transaction, so doing two things at once is never counted as one.
 *
 * @implements FUNC-3.2, TECH-10.6, MVP-AC-10
 */

export function advanceGuidance(
  context: SimulationContext,
  events: readonly DomainEvent[],
): void {
  const { draft, content } = context;
  const chains = content.guidanceChains();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const chain of chains) {
      for (const step of chain.steps) {
        if (!isStepOpen(draft.onboarding, step)) continue;
        if (!satisfied(step, draft, content, events)) continue;
        if (!recordStep(draft, step.id, 'completed')) continue;
        context.publish('onboarding.stepCompleted', { chainId: chain.id, stepId: step.id });
        context.invalidate('onboarding');
        progressed = true;
      }
    }
  }
}

function satisfied(
  step: GuidanceStepDefinition,
  state: CampaignState,
  content: ContentRepository,
  events: readonly DomainEvent[],
): boolean {
  const predicate = step.predicate;
  if (predicate.kind === 'shipReady') return shipReady(state, content, predicate.capacitorFraction);
  if (predicate.kind === 'ammunitionInHold') return spareRounds(state, content) >= predicate.minimumRounds;
  return events.some((event) => matches(predicate, event, state, content));
}

/** Whether one event satisfies an event-driven predicate. */
function matches(
  predicate: Exclude<GuidancePredicate, { readonly kind: 'shipReady' | 'ammunitionInHold' }>,
  event: DomainEvent,
  state: CampaignState,
  content: ContentRepository,
): boolean {
  const player = state.assets.activeShipId;
  const params = event.params ?? {};
  switch (predicate.kind) {
    case 'destinationSelected':
      return event.kind === 'navigation.destinationSelected';
    case 'undocked':
      return event.kind === 'navigation.undocked';
    case 'encounterEntered': {
      if (event.kind !== 'encounter.started') return false;
      const encounter = content.encounter(String(params['encounterId']));
      return encounter !== undefined && encounter.tier >= predicate.minimumTier;
    }
    case 'movementOrdered':
      return event.kind === 'navigation.movementOrdered' &&
        (predicate.orders as readonly string[]).includes(String(params['kind']));
    case 'targetLocked':
      return event.kind === 'combat.lockCompleted' && player !== null && params['shipId'] === player;
    case 'weaponFired':
      return event.kind === 'combat.weaponActivated' && player !== null && params['shipId'] === player;
    case 'defenseActivated': {
      if (event.kind !== 'combat.moduleActivated' || player === null || params['shipId'] !== player) {
        return false;
      }
      const category = content.module(String(params['moduleId']))?.category;
      return category === 'shieldBooster' || category === 'armorRepairer';
    }
    case 'encounterCompleted':
      return event.kind === 'encounter.completed';
    case 'lootTaken':
      return event.kind === 'encounter.lootTaken';
    case 'docked':
      return event.kind === 'navigation.docked';
    case 'itemSold':
      return event.kind === 'market.transactionCommitted' && params['side'] === 'sell';
    case 'fitCommitted':
      return event.kind === 'fitting.committed';
    default:
      return assertNever(predicate);
  }
}

/**
 * Docked in a ship that is repaired, has every online turret's magazine full
 * and holds at least the given share of its capacitor
 * (Functional Specification 9.4, 9.8, 10).
 */
export function shipReady(state: CampaignState, content: ContentRepository, capacitorFraction: number): boolean {
  if (state.assets.location.kind !== 'station') return false;
  const shipId = state.assets.activeShipId;
  if (shipId === null) return false;
  const ship = state.assets.ships[shipId];
  const hull = ship === undefined ? undefined : content.hull(ship.hullId);
  if (ship === undefined || hull === undefined) return false;
  const damage = ship.condition.damage;
  if (damage.shield > 0 || damage.armor > 0 || damage.hull > 0) return false;

  const fit = shipFit(state.assets, shipId);
  for (const fitted of fit) {
    const module = content.module(fitted.moduleId);
    if (!fitted.online || module?.category !== 'turret') continue;
    if (fitted.charge === null || fitted.charge.quantity < module.turret.magazineSize) return false;
  }

  const derived = deriveShipAttributes({ hull, fit, content, conditions: new Set<string>() });
  const capacity = attributeValue(derived, 'capacitorCapacity');
  return capacity <= 0 || ship.condition.capacitorCharge >= capacitorFraction * capacity - 1e-9;
}

/**
 * Rounds in the active ship's hold that one of its online turrets can load: the
 * reserve a weapon reloads from once its magazine is empty (Functional
 * Specification 9.4).
 */
export function spareRounds(state: CampaignState, content: ContentRepository): number {
  const shipId = state.assets.activeShipId;
  const ship = shipId === null ? undefined : state.assets.ships[shipId];
  if (shipId === null || ship === undefined) return 0;
  const groups = new Set<string>();
  for (const fitted of shipFit(state.assets, shipId)) {
    const module = content.module(fitted.moduleId);
    if (fitted.online && module?.category === 'turret') groups.add(module.turret.ammunitionGroup);
  }
  let rounds = 0;
  for (const stack of Object.values(state.assets.stacks)) {
    if (stack.inventoryId !== ship.cargoInventoryId || stack.state.kind !== 'plain') continue;
    const charge = content.ammunition(stack.definitionId);
    if (charge !== undefined && groups.has(charge.group)) rounds += stack.quantity;
  }
  return rounds;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled guidance predicate: ${JSON.stringify(value)}`);
}
