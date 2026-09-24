import type {
  CombatData,
  CombatEventData,
  EncounterData,
  SiteData,
  WeaponRuntimeData,
} from '@protocol';

/**
 * Presentation helpers for the combat surfaces (Technical Specification 12.1).
 *
 * Nothing here decides a rule. They choose what to show - which locked target
 * the weapon controls are pointed at, how identical weapons are grouped, what
 * to call an id the tactical view mentions - from values the engine already
 * published, and every command they lead to is still refused or accepted by
 * the engine.
 */

/**
 * The target the weapon controls aim at: the selection when the ship holds a
 * completed lock on it, otherwise the first completed lock. Which lock to fire
 * at is the player's choice, and selecting a locked object is how it is made.
 */
export function weaponTargetId(combat: CombatData | null, selectedId: string | null): string | null {
  if (combat === null) {
    return null;
  }
  const locked = combat.locks.filter((lock) => lock.status === 'locked');
  if (selectedId !== null && locked.some((lock) => lock.targetId === selectedId)) {
    return selectedId;
  }
  return locked[0]?.targetId ?? null;
}

/** Which weapons could open fire at the aimed target, and why not. */
export interface FireAvailability {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** The weapons whose activation the engine would accept. */
  readonly weapons: readonly WeaponRuntimeData[];
}

/**
 * Whether "fire" can do anything: some weapon's projected activation is
 * available and there is a locked target to aim it at. The reason offered
 * when it cannot is the first refusal the engine projected, or the absence
 * of a target, which is the one thing the engine cannot say before a target
 * is chosen.
 */
export function fireAvailability(
  combat: CombatData | null,
  targetId: string | null,
): FireAvailability {
  const weapons = combat?.weapons ?? [];
  const ready = weapons.filter((weapon) =>
    weapon.commands.some((entry) => entry.command === 'weapon.activate' && entry.available),
  );
  if (targetId === null) {
    return { available: false, unavailableReason: 'tactical.weapons.noTarget', weapons: ready };
  }
  if (ready.length > 0) {
    return { available: true, unavailableReason: null, weapons: ready };
  }
  const refusal =
    weapons
      .flatMap((weapon) => weapon.commands)
      .find((entry) => entry.command === 'weapon.activate' && entry.unavailableReason !== null)
      ?.unavailableReason ?? 'tactical.weapons.none';
  return { available: false, unavailableReason: refusal, weapons: ready };
}

/**
 * Weapons that fire the same turret with the same charge
 * (Functional Specification 19.3). They share one hit chance against a
 * target, so they are read, and fired, as one group.
 */
export interface WeaponGroup {
  readonly key: string;
  readonly moduleId: string;
  readonly nameKey: string;
  readonly ammunitionNameKey: string | null;
  readonly weapons: readonly WeaponRuntimeData[];
}

export function weaponGroups(weapons: readonly WeaponRuntimeData[]): readonly WeaponGroup[] {
  const groups = new Map<string, { group: WeaponGroup; weapons: WeaponRuntimeData[] }>();
  for (const weapon of weapons) {
    const key = `${weapon.moduleId}|${weapon.ammunitionId ?? ''}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      const members = [weapon];
      groups.set(key, {
        weapons: members,
        group: {
          key,
          moduleId: weapon.moduleId,
          nameKey: weapon.nameKey,
          ammunitionNameKey: weapon.ammunitionNameKey,
          weapons: members,
        },
      });
    } else {
      existing.weapons.push(weapon);
    }
  }
  return [...groups.values()].map((entry) => entry.group);
}

/** How a subject the tactical view mentions is named. */
export type SubjectName =
  | { readonly kind: 'player' }
  | { readonly kind: 'named'; readonly nameKey: string }
  | { readonly kind: 'unknown' };

/**
 * The name of an object the tactical view refers to by id. A destroyed
 * opponent has left the site, so the encounter's roster is asked after the
 * site itself.
 */
export function subjectName(
  id: string,
  site: SiteData | null,
  encounter: EncounterData | null,
  playerShipId: string | null,
): SubjectName {
  if (id === playerShipId) {
    return { kind: 'player' };
  }
  const object = site?.site?.objects.find((candidate) => candidate.id === id);
  if (object !== undefined) {
    return object.player ? { kind: 'player' } : { kind: 'named', nameKey: object.nameKey };
  }
  const npc = encounter?.instance?.npcs.find((candidate) => candidate.shipId === id);
  return npc === undefined ? { kind: 'unknown' } : { kind: 'named', nameKey: npc.nameKey };
}

/** Words for a subject, given the interface's translate function. */
export function describeSubject(
  name: SubjectName,
  translate: (key: string) => string,
): string {
  switch (name.kind) {
    case 'player':
      return translate('space.object.you');
    case 'named':
      return translate(name.nameKey);
    default:
      return translate('tactical.unknownSubject');
  }
}

/** The filters the combat log offers (Functional Specification 19.3). */
export const COMBAT_LOG_FILTERS = ['all', 'incoming', 'outgoing', 'repair', 'destruction'] as const;

export type CombatLogFilter = (typeof COMBAT_LOG_FILTERS)[number];

export function matchesFilter(
  event: CombatEventData,
  filter: CombatLogFilter,
  playerShipId: string | null,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'incoming':
      return event.kind === 'damage' && event.targetId === playerShipId;
    case 'outgoing':
      return event.kind === 'damage' && event.sourceId === playerShipId;
    case 'repair':
      return event.kind === 'repair';
    case 'destruction':
      return event.kind === 'destruction';
    default:
      return true;
  }
}

/** Total of a four-component damage record. */
export function damageTotal(damage: Readonly<Record<string, number>>): number {
  return Object.values(damage).reduce((total, value) => total + value, 0);
}

/**
 * The damage types of a record that carry anything, largest first, so a
 * summary names what actually hurt.
 */
export function damageBreakdown(
  damage: Readonly<Record<string, number>>,
): readonly { readonly damageType: string; readonly amount: number }[] {
  return Object.entries(damage)
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([damageType, amount]) => ({ damageType, amount }));
}
