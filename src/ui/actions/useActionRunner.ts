import { useCallback, useEffect, useRef, useState } from 'react';

import { defaultShortcuts } from './registry';

/**
 * Running a registered action once (Technical Specification 12.1, 12.3).
 *
 * A control with a command in flight must not submit it again, because the
 * engine would treat a second request id as a second command. The runner keys
 * pending work by action id and refuses a second start while the first is
 * still running, which is what lets every button in the station share one rule
 * instead of each guarding itself.
 *
 * It holds no gameplay value. What a command did is read back from the engine.
 *
 * @implements TECH-12.1, TECH-12.3
 */

export interface ActionRunner {
  /** True while this action's command is in flight. */
  isPending(actionId: string): boolean;
  /** True while any command is in flight. */
  readonly busy: boolean;
  /**
   * Starts an action unless the same action is already running. Returns false
   * when the call was refused as a duplicate.
   */
  run(actionId: string, work: () => Promise<void>): boolean;
}

export function useActionRunner(): ActionRunner {
  const [pending, setPending] = useState<readonly string[]>([]);
  const active = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const publish = useCallback(() => {
    if (mounted.current) {
      setPending([...active.current].sort());
    }
  }, []);

  const run = useCallback(
    (actionId: string, work: () => Promise<void>): boolean => {
      if (active.current.has(actionId)) {
        return false;
      }
      active.current.add(actionId);
      publish();
      void work()
        .catch(() => {
          // The caller reports failures; the runner only tracks that the
          // command is no longer in flight.
        })
        .finally(() => {
          active.current.delete(actionId);
          publish();
        });
      return true;
    },
    [publish],
  );

  return {
    isPending: (actionId: string) => pending.includes(actionId),
    busy: pending.length > 0,
    run,
  };
}

/**
 * Binds the registry's default shortcuts (Technical Specification 12.3).
 *
 * A shortcut is a discrete command, never continuous steering: it fires on
 * key-down and does nothing on key-up. Typing into a field, using a modifier
 * or working inside a modal dialog never triggers one, so a shortcut cannot
 * steal a keystroke a form needed.
 */
export function useActionShortcuts(
  handlers: Readonly<Record<string, (() => void) | undefined>>,
  options: { readonly enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      return undefined;
    }

    const bindings = defaultShortcuts();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
        return;
      }
      if (isTextEntry(event.target) || isInsideDialog(event.target)) {
        return;
      }
      const actionId = bindings.get(event.key.toLowerCase());
      const handler = actionId === undefined ? undefined : latest.current[actionId];
      if (handler === undefined) {
        return;
      }
      event.preventDefault();
      handler();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isInsideDialog(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('[role="dialog"]') !== null;
}
