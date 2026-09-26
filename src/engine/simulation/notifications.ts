import {
  activeAttributeConditions,
  attributeValue,
  deriveShipAttributes,
  forgetSiteNotifications,
  groupKeyOf,
  npcOf,
  objectAttitude,
  parseSlotKey,
  raisedThisSite,
  raiseNotification,
  shipCombat,
  shipFit,
  weaponState,
  type CampaignState,
  type DomainEvent,
  type DomainEventKind,
  type NotificationParamValue,
} from '@engine/domain';
import type {
  ContentRepository,
  DefenseLayer,
  NotificationDefinition,
  NotificationTrigger,
  NotificationTriggerKind,
} from '@engine/ports';

import type { SimulationContext } from './context';

/**
 * Semantic notifications (Functional Specification 19.7; Technical
 * Specification 9.2 step 10, 12.4).
 *
 * After a transaction has applied its change, each authored notification's
 * trigger - a registered engine operation - reads what the transaction did and
 * decides whether something worth telling the player happened. The engine
 * decides severity, grouping and the cue; the interface decides placement,
 * duration and whether the player has hidden that category.
 *
 * Operations and the localization parameters they pass (a name ending in
 * `Key` is a message key the interface resolves first):
 *
 * | Trigger | Raised when | Parameters |
 * |---|---|---|
 * | hostileLock | a hostile ship completes a lock on the player | attackerKey |
 * | playerLayerBelow | a defensive layer falls below the fraction | percent |
 * | playerLayerDamaged | a layer loses hit points to a shot | - |
 * | playerModuleStarved | an active module of those categories waits for capacitor | moduleKey |
 * | playerWeaponStopped | a weapon stops repeating for one of the reasons | moduleKey |
 * | playerWeaponIdle | a reload completes on an idle weapon while a hostile is locked | moduleKey |
 * | playerLockLost | a lock breaks for one of the reasons | targetKey |
 * | undockedLowCapacitor | the ship undocks below the capacitor fraction | percent |
 * | encounterCompleted | a site is cleared | encounterKey |
 * | bountyPaid | a bounty is credited (grouped repeats add up) | credits |
 * | wreckCreated | an opponent leaves a wreck | - |
 * | lootTaken | loot moves to the hold (grouped per item) | itemKey, quantity |
 * | shipLost | the player's ship is destroyed | hullKey |
 * | insurancePaid | insurance pays out after a loss | credits |
 * | recoveryShipGranted | the recovery service supplies a ship | - |
 * | docked / undocked / warpArrived | the ship docks, undocks or arrives | stationKey / - / siteKey |
 * | marketTransaction | a purchase or sale on that side | itemKey, quantity, credits |
 * | repairCompleted / resupplyCompleted / insurancePurchased | a station service is bought | credits (and rounds) |
 * | fitCommitted | a new fit is applied | - |
 * | guidanceStepCompleted | a guidance step completes while guidance is shown | stepKey |
 *
 * @implements FUNC-19.7, TECH-12.4, MVP-AC-04, MVP-AC-10
 */

/** Leaving one site for another resets what counts as "first" (Functional Specification 19.7). */
const SITE_CHANGES: ReadonlySet<DomainEventKind> = new Set<DomainEventKind>([
  'navigation.undocked',
  'navigation.warpArrived',
  'navigation.docked',
  'recovery.shipLost',
]);

interface Occurrence {
  readonly atMs: number;
  readonly groupSubject: string;
  readonly subjectIds: readonly string[];
  readonly params: Readonly<Record<string, NotificationParamValue>>;
  readonly accumulate?: readonly string[];
}

interface Reading {
  readonly state: CampaignState;
  readonly before: CampaignState | null;
  readonly content: ContentRepository;
  readonly player: string | null;
}

type EventOperation = (trigger: NotificationTrigger, event: DomainEvent, reading: Reading) => Occurrence | null;

export function raiseNotifications(
  context: SimulationContext,
  events: readonly DomainEvent[],
  before: CampaignState | null,
): void {
  const definitions = context.content.notifications();
  if (definitions.length === 0) return;
  const byEvent = new Map<DomainEventKind, NotificationDefinition[]>();
  const diffs: NotificationDefinition[] = [];
  for (const definition of definitions) {
    const listens = EVENT_OF[definition.trigger.kind];
    if (listens === null) {
      diffs.push(definition);
      continue;
    }
    const list = byEvent.get(listens) ?? [];
    list.push(definition);
    byEvent.set(listens, list);
  }

  for (const event of events) {
    if (SITE_CHANGES.has(event.kind)) forgetSiteNotifications(context.draft);
    for (const definition of byEvent.get(event.kind) ?? []) {
      const reading: Reading = {
        state: context.draft,
        before,
        content: context.content,
        player: context.draft.assets.activeShipId,
      };
      const occurrence = OPERATIONS[definition.trigger.kind]?.(definition.trigger, event, reading) ?? null;
      if (occurrence !== null) raise(context, definition, occurrence);
    }
  }

  const playerHit = events.some((event) =>
    event.kind === 'combat.damageApplied' && event.params?.['targetId'] === context.draft.assets.activeShipId);
  if (!playerHit || before === null) return;
  for (const definition of diffs) {
    const trigger = definition.trigger;
    if (trigger.kind !== 'playerLayerBelow') continue;
    const occurrence = layerFell(before, context.draft, context.content, trigger.layer, trigger.fraction);
    if (occurrence !== null) raise(context, definition, occurrence);
  }
}

function raise(context: SimulationContext, definition: NotificationDefinition, occurrence: Occurrence): void {
  const groupKey = groupKeyOf(definition.id, occurrence.groupSubject);
  if (definition.repeat === 'oncePerSite' && raisedThisSite(context.draft, groupKey)) return;
  const record = raiseNotification(context.draft, {
    definition,
    atMs: occurrence.atMs,
    groupSubject: occurrence.groupSubject,
    subjectIds: occurrence.subjectIds,
    params: occurrence.params,
    accumulate: occurrence.accumulate ?? [],
  });
  context.publish('notification.raised', {
    definitionId: definition.id,
    entryId: record.id,
    sequence: record.sequence,
    severity: definition.severity,
  });
  context.invalidate('notifications');
}

/** The domain event each event-driven trigger listens to; `null` for a state comparison. */
const EVENT_OF: Readonly<Record<NotificationTriggerKind, DomainEventKind | null>> = {
  hostileLock: 'combat.lockCompleted',
  playerLayerBelow: null,
  playerLayerDamaged: 'combat.damageApplied',
  playerModuleStarved: 'combat.moduleWaiting',
  playerWeaponStopped: 'combat.weaponStopped',
  playerWeaponIdle: 'combat.reloadCompleted',
  playerLockLost: 'combat.lockLost',
  undockedLowCapacitor: 'navigation.undocked',
  encounterCompleted: 'encounter.completed',
  bountyPaid: 'encounter.bountyPaid',
  wreckCreated: 'encounter.wreckCreated',
  lootTaken: 'encounter.lootTaken',
  shipLost: 'recovery.shipLost',
  insurancePaid: 'recovery.insurancePaid',
  recoveryShipGranted: 'recovery.shipGranted',
  docked: 'navigation.docked',
  undocked: 'navigation.undocked',
  warpArrived: 'navigation.warpArrived',
  marketTransaction: 'market.transactionCommitted',
  repairCompleted: 'repair.completed',
  resupplyCompleted: 'resupply.completed',
  insurancePurchased: 'insurance.enhancedPurchased',
  fitCommitted: 'fitting.committed',
  guidanceStepCompleted: 'onboarding.stepCompleted',
};

const OPERATIONS: Partial<Record<NotificationTriggerKind, EventOperation>> = {
  hostileLock: (_trigger, event, reading) => {
    const attackerId = text(event, 'shipId');
    if (reading.player === null || text(event, 'targetId') !== reading.player) return null;
    if (objectAttitude(reading.state, attackerId) !== 'hostile') return null;
    return occurrence(event, '', [attackerId], { attackerKey: objectNameKey(reading, attackerId) });
  },
  playerLayerDamaged: (trigger, event, reading) => {
    if (trigger.kind !== 'playerLayerDamaged') return null;
    if (reading.player === null || text(event, 'targetId') !== reading.player) return null;
    if (number(event, `${trigger.layer}Damage`) <= 0) return null;
    return occurrence(event, '', [text(event, 'attackerId')], {});
  },
  playerModuleStarved: (trigger, event, reading) => {
    if (trigger.kind !== 'playerModuleStarved' || !isPlayer(event, reading)) return null;
    const module = reading.content.module(text(event, 'moduleId'));
    if (module === undefined || !trigger.categories.includes(module.category)) return null;
    return occurrence(event, text(event, 'slot'), [], { moduleKey: module.nameKey });
  },
  playerWeaponStopped: (trigger, event, reading) => {
    if (trigger.kind !== 'playerWeaponStopped' || !isPlayer(event, reading)) return null;
    if (!trigger.reasons.includes(text(event, 'reason'))) return null;
    const moduleKey = fittedModuleKey(reading, text(event, 'slot'));
    return moduleKey === null ? null : occurrence(event, text(event, 'slot'), [], { moduleKey });
  },
  playerWeaponIdle: (_trigger, event, reading) => {
    if (!isPlayer(event, reading) || number(event, 'rounds') <= 0) return null;
    const combat = shipCombat(reading.state, reading.player!);
    const weapon = weaponState(combat, text(event, 'slot'));
    if (weapon.repeating || weapon.cycle !== null || weapon.reload !== null) return null;
    const hostileLocked = combat.locks.some((lock) =>
      lock.status === 'locked' && objectAttitude(reading.state, lock.targetId) === 'hostile');
    if (!hostileLocked) return null;
    const moduleKey = fittedModuleKey(reading, text(event, 'slot'));
    return moduleKey === null ? null : occurrence(event, text(event, 'slot'), [], { moduleKey });
  },
  playerLockLost: (trigger, event, reading) => {
    if (trigger.kind !== 'playerLockLost' || !isPlayer(event, reading)) return null;
    if (!trigger.reasons.includes(text(event, 'reason'))) return null;
    const targetId = text(event, 'targetId');
    return occurrence(event, targetId, [targetId], { targetKey: objectNameKey(reading, targetId) });
  },
  undockedLowCapacitor: (trigger, event, reading) => {
    if (trigger.kind !== 'undockedLowCapacitor' || reading.player === null) return null;
    const fraction = capacitorFraction(reading.state, reading.content, reading.player);
    if (fraction === null || fraction >= trigger.fraction) return null;
    return occurrence(event, '', [reading.player], { percent: Math.floor(fraction * 1000) / 10 });
  },
  encounterCompleted: (_trigger, event, reading) => {
    const encounter = reading.content.encounter(text(event, 'encounterId'));
    return encounter === undefined ? null
      : occurrence(event, encounter.id, [], { encounterKey: encounter.nameKey });
  },
  bountyPaid: (_trigger, event) =>
    occurrence(event, '', [], { credits: number(event, 'credits') }, ['credits']),
  wreckCreated: (_trigger, event) => occurrence(event, '', [text(event, 'wreckId')], {}),
  lootTaken: (_trigger, event, reading) => {
    const item = reading.content.tradeable(text(event, 'definitionId'));
    return item === undefined ? null
      : occurrence(event, item.id, [], { itemKey: item.nameKey, quantity: number(event, 'quantity') }, ['quantity']);
  },
  shipLost: (_trigger, event, reading) => {
    const loss = reading.state.recovery.lastLoss;
    const hull = loss === null ? undefined : reading.content.hull(loss.hullId);
    return hull === undefined ? null : occurrence(event, '', [text(event, 'shipId')], { hullKey: hull.nameKey });
  },
  insurancePaid: (_trigger, event) =>
    number(event, 'credits') > 0 ? occurrence(event, '', [], { credits: number(event, 'credits') }) : null,
  recoveryShipGranted: (_trigger, event) => occurrence(event, '', [text(event, 'shipId')], {}),
  docked: (_trigger, event, reading) => {
    const station = reading.content.station(text(event, 'stationId'));
    return station === undefined ? null : occurrence(event, '', [], { stationKey: station.nameKey });
  },
  undocked: (_trigger, event) => occurrence(event, '', [], {}),
  warpArrived: (_trigger, event, reading) => {
    const site = reading.content.site(text(event, 'siteId'));
    return site === undefined ? null : occurrence(event, '', [], { siteKey: site.nameKey });
  },
  marketTransaction: (trigger, event, reading) => {
    if (trigger.kind !== 'marketTransaction' || text(event, 'side') !== trigger.side) return null;
    const itemId = text(event, 'itemId');
    const nameKey = reading.content.tradeable(itemId)?.nameKey ?? reading.content.hull(itemId)?.nameKey;
    return nameKey === undefined ? null : occurrence(event, '', [], {
      itemKey: nameKey,
      quantity: number(event, 'quantity'),
      credits: number(event, 'totalCredits'),
    });
  },
  repairCompleted: (_trigger, event) => occurrence(event, '', [], { credits: number(event, 'totalCredits') }),
  resupplyCompleted: (_trigger, event) =>
    occurrence(event, '', [], { credits: number(event, 'totalCredits'), rounds: number(event, 'rounds') }),
  insurancePurchased: (_trigger, event) =>
    occurrence(event, '', [], { credits: number(event, 'premiumCredits') }),
  fitCommitted: (_trigger, event) => occurrence(event, '', [], {}),
  guidanceStepCompleted: (_trigger, event, reading) => {
    if (reading.state.onboarding.hidden) return null;
    const step = reading.content.guidanceStep(text(event, 'stepId'));
    return step === undefined ? null : occurrence(event, step.id, [], { stepKey: step.titleKey });
  },
};

function occurrence(
  event: DomainEvent,
  groupSubject: string,
  subjectIds: readonly string[],
  params: Readonly<Record<string, NotificationParamValue>>,
  accumulate: readonly string[] = [],
): Occurrence {
  return {
    atMs: event.simulationTimeMs,
    groupSubject,
    subjectIds: subjectIds.filter((id) => id.length > 0),
    params,
    accumulate,
  };
}

/**
 * The layer crossed below the fraction during this transaction. Shield
 * regenerates, so the warning can be raised again once it has recovered and
 * falls a second time; the group window folds a flicker into one entry.
 */
function layerFell(
  before: CampaignState,
  after: CampaignState,
  content: ContentRepository,
  layer: DefenseLayer,
  fraction: number,
): Occurrence | null {
  const player = after.assets.activeShipId;
  if (player === null || before.assets.activeShipId !== player) return null;
  const was = layerFraction(before, content, player, layer);
  const now = layerFraction(after, content, player, layer);
  if (was === null || now === null || !(was >= fraction && now < fraction)) return null;
  return {
    atMs: after.time.simulationTimeMs,
    groupSubject: '',
    subjectIds: [player],
    params: { percent: Math.round(fraction * 1000) / 10 },
  };
}

function layerFraction(
  state: CampaignState,
  content: ContentRepository,
  shipId: string,
  layer: DefenseLayer,
): number | null {
  const ship = state.assets.ships[shipId];
  const hull = ship === undefined ? undefined : content.hull(ship.hullId);
  if (ship === undefined || hull === undefined || ship.location.kind !== 'site') return null;
  const fit = shipFit(state.assets, shipId);
  const conditions = activeAttributeConditions(fit, content, shipCombat(state, shipId));
  const derived = deriveShipAttributes({ hull, fit, content, conditions });
  const maximum = attributeValue(derived, `${layer}HitPoints`);
  return maximum > 0 ? Math.max(0, maximum - ship.condition.damage[layer]) / maximum : null;
}

function capacitorFraction(state: CampaignState, content: ContentRepository, shipId: string): number | null {
  const ship = state.assets.ships[shipId];
  const hull = ship === undefined ? undefined : content.hull(ship.hullId);
  if (ship === undefined || hull === undefined) return null;
  const fit = shipFit(state.assets, shipId);
  const derived = deriveShipAttributes({ hull, fit, content, conditions: new Set<string>() });
  const capacity = attributeValue(derived, 'capacitorCapacity');
  return capacity > 0 ? ship.condition.capacitorCharge / capacity : null;
}

/** The name the player meets a ship by: the encounter's opponent, else its hull. */
function objectNameKey(reading: Reading, objectId: string): string {
  const npc = npcOf(reading.state, objectId) ?? (reading.before === null ? null : npcOf(reading.before, objectId));
  const profileKey = npc === null ? undefined : reading.content.npcProfile(npc.profileId)?.nameKey;
  if (profileKey !== undefined) return profileKey;
  const object = reading.state.navigation.currentSite?.objects[objectId];
  if (object !== undefined) return object.nameKey;
  const ship = reading.state.assets.ships[objectId];
  return (ship === undefined ? undefined : reading.content.hull(ship.hullId)?.nameKey) ?? 'content.notify.unknown';
}

function fittedModuleKey(reading: Reading, slotKey: string): string | null {
  if (reading.player === null) return null;
  const slot = parseSlotKey(slotKey);
  if (slot === null) return null;
  const fitted = shipFit(reading.state.assets, reading.player)
    .find((entry) => entry.slot.kind === slot.kind && entry.slot.index === slot.index);
  return fitted === undefined ? null : (reading.content.module(fitted.moduleId)?.nameKey ?? null);
}

function isPlayer(event: DomainEvent, reading: Reading): boolean {
  return reading.player !== null && event.params?.['shipId'] === reading.player;
}

function text(event: DomainEvent, name: string): string {
  const value = event.params?.[name];
  return typeof value === 'string' ? value : '';
}

function number(event: DomainEvent, name: string): number {
  const value = event.params?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
