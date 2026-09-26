import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  assignKey,
  isBindableKey,
  normaliseKey,
  REMAPPABLE_ACTIONS,
  resolveBindings,
  shortcutParameterName,
  shortcutParameters,
} from '@ui';

/**
 * Remappable keyboard shortcuts (Functional Specification 19.2, 20;
 * Technical Specification 12.3).
 */

describe('key bindings', () => {
  it('binds every default shortcut to exactly one action [TECH-12.3, FUNC-20]', () => {
    const bindings = resolveBindings();
    const withShortcut = ACTIONS.filter((action) => action.shortcut !== null);
    expect(REMAPPABLE_ACTIONS.map((action) => action.id)).toEqual(withShortcut.map((action) => action.id));
    for (const action of withShortcut) {
      expect(bindings.byAction.get(action.id)).toBe(action.shortcut);
      expect(bindings.byKey.get(action.shortcut ?? '')).toBe(action.id);
    }
    expect(bindings.byKey.size).toBe(withShortcut.length);
  });

  it('accepts single printable keys and function keys, never a key the page needs [FUNC-20, TECH-12.3]', () => {
    expect(normaliseKey('Z')).toBe('z');
    expect(normaliseKey(']')).toBe(']');
    expect(normaliseKey('F5')).toBe('f5');
    for (const reserved of ['Enter', 'Tab', 'Escape', ' ', 'ArrowUp', 'Shift', 'Backspace', 'F13']) {
      expect(normaliseKey(reserved)).toBeNull();
    }
    expect(isBindableKey('z')).toBe(true);
    expect(isBindableKey('Z')).toBe(false);
    expect(isBindableKey('enter')).toBe(false);
  });

  it('moves an action to a free key and frees its old one [FUNC-20, TECH-12.3]', () => {
    const { overrides, displaced } = assignKey({}, 'targeting.lock', 'z');
    expect(displaced).toBeNull();
    expect(overrides).toEqual({ 'targeting.lock': 'z' });
    const bindings = resolveBindings(overrides);
    expect(bindings.byKey.get('z')).toBe('targeting.lock');
    expect(bindings.byKey.has('l')).toBe(false);
  });

  it('takes a held key from its action, which is left without one, so no key has two actions [FUNC-20, TECH-12.3]', () => {
    const { overrides, displaced } = assignKey({}, 'targeting.lock', 's');
    expect(displaced).toBe('movement.stop');
    const bindings = resolveBindings(overrides);
    expect(bindings.byKey.get('s')).toBe('targeting.lock');
    expect(bindings.byAction.get('movement.stop')).toBeNull();
    const keys = [...bindings.byAction.values()].filter((key) => key !== null);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('forgets an override that matches the default, and can leave an action without a key [FUNC-20]', () => {
    const moved = assignKey({}, 'targeting.lock', 'z').overrides;
    expect(assignKey(moved, 'targeting.lock', 'l').overrides).toEqual({});
    const cleared = assignKey({}, 'weapons.fire', null).overrides;
    expect(cleared).toEqual({ 'weapons.fire': null });
    expect(resolveBindings(cleared).byKey.has('e')).toBe(false);
  });

  it('settles a hand-edited store that gives two actions one key in registry order [TECH-3.1, TECH-14]', () => {
    const bindings = resolveBindings({ 'movement.approach': 'z', 'targeting.lock': 'z' });
    expect(bindings.byKey.get('z')).toBe('movement.approach');
    expect(bindings.byAction.get('targeting.lock')).toBeNull();
  });

  it('refuses an action without a shortcut and a key that cannot be bound [TECH-12.3]', () => {
    expect(() => assignKey({}, 'market.buy', 'z')).toThrow();
    expect(() => assignKey({}, 'targeting.lock', 'Enter')).toThrow();
  });

  it('names each key as a message parameter, so guidance text follows the binding [FUNC-20, TECH-12.5]', () => {
    expect(shortcutParameterName('targeting.lock')).toBe('keyTargetingLock');
    expect(shortcutParameterName('module.toggle.1')).toBe('keyModuleToggle1');
    const parameters = shortcutParameters(resolveBindings({ 'targeting.lock': 'z', 'weapons.fire': null }), 'no key');
    expect(parameters['keyTargetingLock']).toBe('Z');
    expect(parameters['keyWeaponsFire']).toBe('no key');
    expect(parameters['keySpaceSelectNext']).toBe(']');
  });
});
