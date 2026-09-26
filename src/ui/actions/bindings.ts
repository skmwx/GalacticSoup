import { ACTIONS, type ActionDefinition } from './registry';

/**
 * Remappable keyboard shortcuts (Functional Specification 19.2, 20;
 * Technical Specification 12.3).
 *
 * The registry names each action's default key. The player may move any of
 * those actions to another key or leave one without a key; what they changed
 * is kept as overrides in their local preferences, and this module turns the
 * defaults plus the overrides into the one binding table every surface reads.
 *
 * A key belongs to at most one action. Giving an action a key another action
 * holds takes it from that action, which is then left without one, so the
 * table can never hold a conflict for the keyboard handler to guess at.
 *
 * Only single keys are bindable, and never one the page itself needs: Tab
 * moves focus, Enter and Space activate the focused control, Escape closes
 * what is open and the arrows move inside lists and fields. A key held down
 * repeats nothing and steers nothing; each press is one discrete action.
 *
 * @implements FUNC-19.2, FUNC-20, TECH-12.3
 */

/** Action id to key, or `null` for an action the player left without one. */
export type BindingOverrides = Readonly<Record<string, string | null>>;

export interface ResolvedBindings {
  /** Every remappable action's key, or `null` when it has none. */
  readonly byAction: ReadonlyMap<string, string | null>;
  /** Key to the one action it triggers. */
  readonly byKey: ReadonlyMap<string, string>;
}

/** The actions the player can remap: those that have a default key. */
export const REMAPPABLE_ACTIONS: readonly ActionDefinition[] = ACTIONS.filter(
  (action) => action.shortcut !== null,
);

const REMAPPABLE_IDS = new Set(REMAPPABLE_ACTIONS.map((action) => action.id));

export function isRemappableAction(actionId: string): boolean {
  return REMAPPABLE_IDS.has(actionId);
}

const FUNCTION_KEY = /^f([1-9]|1[0-2])$/;

/**
 * Normalises a `KeyboardEvent.key` to the form bindings are stored in: one
 * printable character in lower case, or a function key such as `f5`.
 * Returns `null` for anything that cannot be a shortcut.
 */
export function normaliseKey(key: string): string | null {
  if (key.length === 1) {
    const lower = key.toLowerCase();
    return lower.trim() === '' ? null : lower;
  }
  const lower = key.toLowerCase();
  return FUNCTION_KEY.test(lower) ? lower : null;
}

/** True when a stored or pressed key may be bound. */
export function isBindableKey(key: string): boolean {
  return normaliseKey(key) === key;
}

/** How a key is written on a control: letters in capitals, `F5` for a function key. */
export function keyLabel(key: string): string {
  return key.toUpperCase();
}

/**
 * The binding table the defaults and the overrides produce.
 *
 * An override wins over a default for the same key. Two overrides that name
 * the same key - which only a hand-edited store can contain - are settled in
 * registry order, and the later action is left without a key.
 */
export function resolveBindings(overrides: BindingOverrides = {}): ResolvedBindings {
  const byAction = new Map<string, string | null>();
  const byKey = new Map<string, string>();

  for (const action of REMAPPABLE_ACTIONS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, action.id)) continue;
    const key = overrides[action.id] ?? null;
    if (key === null || !isBindableKey(key) || byKey.has(key)) {
      byAction.set(action.id, null);
      continue;
    }
    byAction.set(action.id, key);
    byKey.set(key, action.id);
  }
  for (const action of REMAPPABLE_ACTIONS) {
    if (byAction.has(action.id)) continue;
    const key = action.shortcut;
    if (key === null || byKey.has(key)) {
      byAction.set(action.id, null);
      continue;
    }
    byAction.set(action.id, key);
    byKey.set(key, action.id);
  }

  return { byAction, byKey };
}

export interface KeyAssignment {
  readonly overrides: BindingOverrides;
  /** The action the key was taken from, if another one held it. */
  readonly displaced: string | null;
}

/**
 * Gives one action a key, taking it from whichever action held it. Passing
 * `null` leaves the action without a key.
 */
export function assignKey(
  overrides: BindingOverrides,
  actionId: string,
  key: string | null,
): KeyAssignment {
  if (!isRemappableAction(actionId)) {
    throw new Error(`The action "${actionId}" has no remappable shortcut.`);
  }
  if (key !== null && !isBindableKey(key)) {
    throw new Error(`"${key}" cannot be a shortcut.`);
  }
  const current = resolveBindings(overrides);
  const holder = key === null ? undefined : current.byKey.get(key);
  const displaced = holder === undefined || holder === actionId ? null : holder;

  const next: Record<string, string | null> = { ...overrides, [actionId]: key };
  if (displaced !== null) {
    next[displaced] = null;
  }
  return { overrides: withoutDefaults(next), displaced };
}

/** Drops overrides that say what the default already says, so the store stays small. */
function withoutDefaults(overrides: Record<string, string | null>): BindingOverrides {
  const kept: Record<string, string | null> = {};
  const defaults = resolveBindings({});
  for (const action of REMAPPABLE_ACTIONS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, action.id)) continue;
    const key = overrides[action.id] ?? null;
    if (key !== defaults.byAction.get(action.id)) {
      kept[action.id] = key;
    }
  }
  // A default that lost its key to an override must be recorded as keyless,
  // or it would take its key back the next time the table is resolved.
  const resolved = resolveBindings(kept);
  for (const action of REMAPPABLE_ACTIONS) {
    if (resolved.byAction.get(action.id) === null && defaults.byAction.get(action.id) !== null) {
      kept[action.id] = null;
    }
  }
  return kept;
}

/**
 * The name a message template uses for an action's key: `keyTargetingLock`
 * for `targeting.lock`, so guidance text can say "Lock target
 * ({keyTargetingLock})" and follow the player's own binding.
 */
export function shortcutParameterName(actionId: string): string {
  return `key${actionId
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;
}

/** Every remappable action's key as message parameters; `unbound` names a missing one. */
export function shortcutParameters(
  bindings: ResolvedBindings,
  unbound: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    REMAPPABLE_ACTIONS.map((action) => {
      const key = bindings.byAction.get(action.id) ?? null;
      return [shortcutParameterName(action.id), key === null ? unbound : keyLabel(key)];
    }),
  );
}
