import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import type { MessageKey } from '@shared';

import { useTranslate } from '../localization';
import { usePreferences } from '../preferences/PreferencesProvider';
import { keyLabel, resolveBindings, type ResolvedBindings } from './bindings';
import { actionById } from './registry';

/**
 * Keyboard shortcuts (Functional Specification 19.2, 20; Technical
 * Specification 12.3).
 *
 * Every surface declares the shortcut handlers it offers with
 * `useActionShortcuts`; one listener on the document turns a key press into
 * the action the player's bindings give it and calls the handler the mounted
 * surfaces registered for that action.
 *
 * A shortcut is a discrete command, never continuous steering: it fires on
 * key-down, ignores auto-repeat and does nothing on key-up. Typing into a
 * field, using a modifier, working inside a modal dialog or choosing a new key
 * in the settings never triggers one, so a shortcut cannot steal a keystroke a
 * form needed. Pause is the exception a list box does not block, so the clock
 * can always be stopped (Functional Specification 20).
 *
 * A key that cannot act says so instead of doing nothing. A handler returns
 * the reason its action is refused - the same reason the button beside it
 * shows - and a bound key no mounted surface offers reports that its action is
 * not available here. The notice is a polite status line, so it is read out
 * without interrupting.
 *
 * @implements FUNC-19.2, FUNC-20, TECH-12.3, MVP-AC-10
 */

/** A handler's answer: nothing when it acted, or the reason it could not. */
export type ShortcutOutcome = MessageKey | null | undefined | void;
export type ShortcutHandlers = Readonly<Record<string, (() => ShortcutOutcome) | undefined>>;

/** Marks an element whose key presses are being captured as a new binding. */
export const SHORTCUT_CAPTURE_ATTRIBUTE = 'data-shortcut-capture';

/** Actions a focused list box does not block, because stopping must always work. */
const ALWAYS_REACHABLE = new Set(['time.toggle']);

/** How long a refusal notice stays, in real milliseconds. */
export const SHORTCUT_NOTICE_MS = 5_000;

export interface ShortcutNoticeData {
  readonly actionId: string;
  readonly key: string;
  readonly reasonKey: MessageKey;
  /** Distinguishes two identical notices in a row, so each is announced. */
  readonly serial: number;
}

interface ShortcutHub {
  register(handlers: { readonly current: ShortcutHandlers }): () => void;
  readonly notice: ShortcutNoticeData | null;
}

const ShortcutContext = createContext<ShortcutHub | null>(null);

/** The binding table the player's preferences produce. */
export function useBindings(): ResolvedBindings {
  const { preferences } = usePreferences();
  return useMemo(() => resolveBindings(preferences.bindings), [preferences.bindings]);
}

/** The key currently bound to one action, or `null`. */
export function useBinding(actionId: string): string | null {
  return useBindings().byAction.get(actionId) ?? null;
}

/**
 * Owns the one keyboard listener for everything inside it and the notice a
 * refused key produces.
 */
export function ShortcutProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const bindings = useBindings();
  const registered = useRef<{ readonly current: ShortcutHandlers }[]>([]);
  const [notice, setNotice] = useState<ShortcutNoticeData | null>(null);
  const latestBindings = useRef(bindings);
  latestBindings.current = bindings;

  const register = useCallback((handlers: { readonly current: ShortcutHandlers }) => {
    registered.current = [...registered.current, handlers];
    return () => {
      registered.current = registered.current.filter((entry) => entry !== handlers);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let serial = 0;
    const onKeyDown = (event: KeyboardEvent): void => {
      const actionId = shortcutAction(event, latestBindings.current);
      if (actionId === null) return;
      event.preventDefault();
      // The most recently mounted surface that offers the action handles it.
      const handler = [...registered.current].reverse()
        .map((entry) => entry.current[actionId])
        .find((candidate) => candidate !== undefined);
      const outcome = handler === undefined ? 'shortcut.notHere' : handler();
      if (typeof outcome === 'string') {
        serial += 1;
        setNotice({ actionId, key: event.key.toLowerCase(), reasonKey: outcome, serial });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = setTimeout(() => {
      setNotice(null);
    }, SHORTCUT_NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  const hub = useMemo(() => ({ register, notice }), [register, notice]);
  return <ShortcutContext.Provider value={hub}>{children}</ShortcutContext.Provider>;
}

/**
 * Offers shortcut handlers while the calling surface is mounted. Outside a
 * `ShortcutProvider` - a surface rendered on its own - the hook listens for
 * itself.
 */
export function useActionShortcuts(
  handlers: ShortcutHandlers,
  options: { readonly enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  const hub = useContext(ShortcutContext);
  const bindings = useBindings();
  const latest = useRef(handlers);
  latest.current = handlers;
  const latestBindings = useRef(bindings);
  latestBindings.current = bindings;

  useEffect(() => {
    if (!enabled) return undefined;
    if (hub !== null) return hub.register(latest);
    if (typeof document === 'undefined') return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      const actionId = shortcutAction(event, latestBindings.current);
      const handler = actionId === null ? undefined : latest.current[actionId];
      if (handler === undefined) return;
      event.preventDefault();
      handler();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
    // The hub's identity changes with its notice; registration does not.
  }, [enabled, hub?.register]);
}

/** The latest refused shortcut, for the notice line. */
export function useShortcutNotice(): ShortcutNoticeData | null {
  return useContext(ShortcutContext)?.notice ?? null;
}

/** The status line that says why a key did nothing. */
export function ShortcutNotice({ className }: { readonly className?: string | undefined }): JSX.Element {
  const translate = useTranslate();
  const notice = useShortcutNotice();
  return (
    <p className={className} role="status" aria-live="polite" data-shortcut-notice={notice === null ? 'none' : notice.actionId}>
      {notice === null
        ? null
        : translate('shortcut.refused', {
            key: keyLabel(notice.key),
            action: translate(actionById(notice.actionId).labelKey),
            reason: translate(notice.reasonKey),
          })}
    </p>
  );
}

/** The action a key press asks for, or `null` when it is not a shortcut here. */
function shortcutAction(event: KeyboardEvent, bindings: ResolvedBindings): string | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
    return null;
  }
  const actionId = bindings.byKey.get(event.key.toLowerCase());
  if (actionId === undefined) return null;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest(`[${SHORTCUT_CAPTURE_ATTRIBUTE}]`) !== null) {
    return null;
  }
  if (isTextEntry(target, ALWAYS_REACHABLE.has(actionId)) || isInsideDialog(target)) {
    return null;
  }
  return actionId;
}

function isTextEntry(target: EventTarget | null, listBoxAllowed: boolean): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target.tagName === 'SELECT') {
    return !listBoxAllowed;
  }
  if (target.tagName === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    // A checkbox, radio button or slider takes no letters, so a shortcut
    // pressed on one is still a shortcut.
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(type);
  }
  return target.tagName === 'TEXTAREA';
}

function isInsideDialog(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('[role="dialog"]') !== null;
}
