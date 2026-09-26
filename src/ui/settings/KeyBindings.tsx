import { useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import {
  ACTION_CATEGORIES,
  assignKey,
  keyLabel,
  normaliseKey,
  REMAPPABLE_ACTIONS,
  SHORTCUT_CAPTURE_ATTRIBUTE,
  useBindings,
  type ActionDefinition,
} from '../actions';
import { useTranslate } from '../localization';
import { usePreferences } from '../preferences';
import styles from './Settings.module.css';

/**
 * Remapping the keyboard shortcuts (Functional Specification 19.2, 20;
 * Technical Specification 12.3).
 *
 * Every action that has a shortcut is listed by category with its current
 * key. "Change" waits for the next key and binds it; Escape cancels, and a key
 * the page itself needs - Tab, Enter, Space, the arrows - is refused with the
 * reason. A key another action held moves to the new one, and the line below
 * says which action lost it, so a conflict is never silent. Each action can
 * also be left without a key, and the defaults can be restored at once.
 *
 * While a key is being captured no shortcut fires, so choosing L for one
 * action cannot also lock a target.
 *
 * @implements FUNC-19.2, FUNC-20, TECH-12.3
 */
export function KeyBindings(): JSX.Element {
  const translate = useTranslate();
  const { preferences, update } = usePreferences();
  const bindings = useBindings();
  const [capturing, setCapturing] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const label = (action: ActionDefinition): string => bindingLabel(action, translate);

  const bind = (action: ActionDefinition, key: string | null): void => {
    const assignment = assignKey(preferences.bindings, action.id, key);
    update((current) => ({ ...current, bindings: assignment.overrides }));
    const displacedAction =
      REMAPPABLE_ACTIONS.find((candidate) => candidate.id === assignment.displaced) ?? null;
    if (key === null) {
      setMessage(translate('settings.keys.cleared', { action: label(action) }));
    } else if (displacedAction === null) {
      setMessage(translate('settings.keys.bound', { action: label(action), key: keyLabel(key) }));
    } else {
      setMessage(translate('settings.keys.moved', {
        action: label(action),
        key: keyLabel(key),
        previous: label(displacedAction),
      }));
    }
  };

  const onCaptureKey = (action: ActionDefinition, event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(event.key)) {
      return;
    }
    if (event.key === 'Tab') {
      // Tab keeps moving focus; leaving the control ends the capture.
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setCapturing(null);
    if (event.key === 'Escape') {
      setMessage(translate('settings.keys.cancelled', { action: label(action) }));
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
      setMessage(translate('settings.keys.modifier'));
      return;
    }
    const key = normaliseKey(event.key);
    if (key === null) {
      setMessage(translate('settings.keys.reserved', {
        key: event.key === ' ' ? translate('settings.keys.space') : event.key,
      }));
      return;
    }
    bind(action, key);
  };

  // A binding changed to what the player just pressed must not be
  // (re)interpreted as a shortcut by the document listener.
  const captureAttribute = { [SHORTCUT_CAPTURE_ATTRIBUTE]: 'true' };

  return (
    <section className={styles['group']} aria-labelledby="settings-keys-heading" data-settings-keys>
      <h3 id="settings-keys-heading" className={styles['groupHeading']}>{translate('settings.keys.heading')}</h3>
      <p className={styles['muted']}>{translate('settings.keys.detail')}</p>
      <table className={styles['table']}>
        <caption className={styles['caption']}>{translate('settings.keys.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{translate('settings.keys.action')}</th>
            <th scope="col">{translate('settings.keys.key')}</th>
            <th scope="col">{translate('settings.keys.change')}</th>
          </tr>
        </thead>
        {ACTION_CATEGORIES.map((category) => {
          const actions = REMAPPABLE_ACTIONS.filter((action) => action.category === category);
          if (actions.length === 0) return null;
          return (
            <tbody key={category}>
              <tr>
                <th scope="colgroup" colSpan={3} className={styles['category']}>
                  {translate(`settings.keys.category.${category}`)}
                </th>
              </tr>
              {actions.map((action) => {
                const key = bindings.byAction.get(action.id) ?? null;
                const name = label(action);
                const isCapturing = capturing === action.id;
                return (
                  <tr key={action.id} data-binding={action.id}>
                    <th scope="row">{name}</th>
                    <td>
                      {key === null
                        ? <span className={styles['muted']}>{translate('settings.keys.none')}</span>
                        : <kbd className={styles['key']}>{keyLabel(key)}</kbd>}
                    </td>
                    <td className={styles['keyControls']}>
                      <button
                        type="button"
                        className={styles['button']}
                        aria-label={isCapturing
                          ? translate('settings.keys.capturing', { action: name })
                          : translate('settings.keys.changeFor', { action: name })}
                        aria-pressed={isCapturing}
                        {...(isCapturing ? captureAttribute : {})}
                        onClick={() => {
                          if (!isCapturing) {
                            setCapturing(action.id);
                            setMessage(translate('settings.keys.prompt', { action: name }));
                          }
                        }}
                        onKeyDown={isCapturing ? (event) => {
                          onCaptureKey(action, event);
                        } : undefined}
                        onBlur={() => {
                          if (isCapturing) setCapturing(null);
                        }}
                      >
                        {isCapturing ? translate('settings.keys.pressKey') : translate('settings.keys.change')}
                      </button>
                      <button
                        type="button"
                        className={styles['button']}
                        disabled={key === null}
                        aria-label={translate('settings.keys.clearFor', { action: name })}
                        onClick={() => {
                          bind(action, null);
                        }}
                      >
                        {translate('settings.keys.clear')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
      <p className={styles['status']} role="status" aria-live="polite" data-binding-message>
        {message}
      </p>
      <button
        type="button"
        className={styles['button']}
        onClick={() => {
          update((current) => ({ ...current, bindings: {} }));
          setMessage(translate('settings.keys.restored'));
        }}
      >
        {translate('settings.keys.restore')}
      </button>
    </section>
  );
}

/** A remappable action's name; the four module toggles are told apart by position. */
export function bindingLabel(
  action: ActionDefinition,
  translate: ReturnType<typeof useTranslate>,
): string {
  const toggle = /^module\.toggle\.(\d+)$/.exec(action.id);
  return toggle === null
    ? translate(action.labelKey)
    : translate('settings.keys.moduleToggle', { position: Number(toggle[1]) });
}
