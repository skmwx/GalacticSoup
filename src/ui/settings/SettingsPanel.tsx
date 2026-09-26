import { useId, type JSX } from 'react';

import { formatPercent } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import {
  CONFIRMATION_NAMES,
  CONTRAST_MODES,
  DEFAULT_CONFIRMATIONS,
  DEFAULT_DISPLAY,
  MOTION_MODES,
  SCALE_STEPS,
  usePreferences,
  type DisplayPreferences,
} from '../preferences';
import { KeyBindings } from './KeyBindings';
import styles from './Settings.module.css';

/**
 * The player's presentation settings (Functional Specification 20;
 * Technical Specification 12.3).
 *
 * Interface size and text size are independent. Contrast and motion either
 * follow the browser or override it. The optional confirmations can be
 * switched off - those the rules require are listed as always asked - and the
 * keyboard shortcuts can be remapped. Each group restores its own defaults.
 *
 * Every change applies at once and belongs to this browser, not to the
 * campaign: it is kept in local storage and never saved in a snapshot. The
 * panel is non-modal, so it does not trap focus; Escape closes it and returns
 * focus to the control that opened it.
 *
 * @implements FUNC-20, FUNC-19.2, TECH-12.3, TECH-12.5, MVP-AC-10
 */
export interface SettingsPanelProps {
  /** Closes the panel; focus goes back to what opened it. */
  readonly onClose: () => void;
  readonly id?: string;
}

export function SettingsPanel({ onClose, id }: SettingsPanelProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const { preferences, update } = usePreferences();
  const display = preferences.display;

  const setDisplay = (change: Partial<DisplayPreferences>): void => {
    update((current) => ({ ...current, display: { ...current.display, ...change } }));
  };

  return (
    <section
      id={id}
      className={styles['settings']}
      aria-labelledby="settings-heading"
      data-settings
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className={styles['header']}>
        <h2 id="settings-heading" className={styles['heading']}>{translate('settings.heading')}</h2>
        <button type="button" className={styles['button']} onClick={onClose}>
          {translate('settings.close')}
        </button>
      </div>
      <p className={styles['muted']}>{translate('settings.detail')}</p>

      <div className={styles['groups']}>
        <section className={styles['group']} aria-labelledby="settings-display-heading" data-settings-display>
          <h3 id="settings-display-heading" className={styles['groupHeading']}>
            {translate('settings.display.heading')}
          </h3>
          <Choice
            label={translate('settings.display.uiScale')}
            value={String(display.uiScale)}
            options={SCALE_STEPS.map((step) => ({ value: String(step), label: formatPercent(step, locale) }))}
            onChange={(value) => {
              setDisplay({ uiScale: Number(value) });
            }}
          />
          <Choice
            label={translate('settings.display.textScale')}
            value={String(display.textScale)}
            options={SCALE_STEPS.map((step) => ({ value: String(step), label: formatPercent(step, locale) }))}
            onChange={(value) => {
              setDisplay({ textScale: Number(value) });
            }}
          />
          <Choice
            label={translate('settings.display.contrast')}
            value={display.contrast}
            options={CONTRAST_MODES.map((mode) => ({ value: mode, label: translate(`settings.contrast.${mode}`) }))}
            onChange={(value) => {
              setDisplay({ contrast: value as DisplayPreferences['contrast'] });
            }}
          />
          <Choice
            label={translate('settings.display.motion')}
            value={display.motion}
            options={MOTION_MODES.map((mode) => ({ value: mode, label: translate(`settings.motion.${mode}`) }))}
            onChange={(value) => {
              setDisplay({ motion: value as DisplayPreferences['motion'] });
            }}
          />
          <p className={styles['muted']}>{translate('settings.display.motionDetail')}</p>
          <button
            type="button"
            className={styles['button']}
            onClick={() => {
              update((current) => ({ ...current, display: DEFAULT_DISPLAY }));
            }}
          >
            {translate('settings.display.restore')}
          </button>
        </section>

        <section className={styles['group']} aria-labelledby="settings-confirm-heading" data-settings-confirmations>
          <h3 id="settings-confirm-heading" className={styles['groupHeading']}>
            {translate('settings.confirmations.heading')}
          </h3>
          {CONFIRMATION_NAMES.map((name) => (
            <label key={name} className={styles['check']}>
              <input
                type="checkbox"
                checked={preferences.confirmations[name]}
                onChange={(event) => {
                  const checked = event.target.checked;
                  update((current) => ({
                    ...current,
                    confirmations: { ...current.confirmations, [name]: checked },
                  }));
                }}
              />
              {translate(`settings.confirmations.${name}`)}
            </label>
          ))}
          <p className={styles['muted']}>{translate('settings.confirmations.always')}</p>
          <button
            type="button"
            className={styles['button']}
            onClick={() => {
              update((current) => ({ ...current, confirmations: DEFAULT_CONFIRMATIONS }));
            }}
          >
            {translate('settings.confirmations.restore')}
          </button>
        </section>
      </div>

      <KeyBindings />
    </section>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className={styles['field']}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
