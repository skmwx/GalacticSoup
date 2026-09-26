import { useCallback, useEffect, useRef, useState } from 'react';

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
