import { useId, type JSX } from 'react';

import { NOTIFICATION_CATEGORY_NAMES, type NotificationCategoryName } from '@protocol';

import { ActionButton, type ActionRunner } from '../actions';
import { formatPercent } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import { AUDIO_CHANNEL_NAMES, usePreferences, type AudioChannelName } from '../preferences';
import styles from './Notifications.module.css';

/**
 * Notification and sound settings (Functional Specification 19.7, 20;
 * Technical Specification 12.3).
 *
 * Each category can be shown or hidden and heard or muted; sound can be
 * switched off altogether and each channel has its own volume. Ship
 * destruction and save failures stay visible whatever is chosen here.
 *
 * @implements FUNC-19.7, FUNC-20, TECH-12.3
 */
export function NotificationSettings({ runner }: { readonly runner: ActionRunner }): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const { preferences, update, restoreDefaults } = usePreferences();
  const headingId = useId();

  const setCategory = (category: NotificationCategoryName, field: 'visible' | 'sound', value: boolean): void => {
    update((current) => ({
      ...current,
      notifications: {
        ...current.notifications,
        [category]: { ...current.notifications[category], [field]: value },
      },
    }));
  };
  const setChannel = (channel: AudioChannelName, value: number): void => {
    update((current) => ({
      ...current,
      audio: { ...current.audio, channels: { ...current.audio.channels, [channel]: value } },
    }));
  };

  return (
    <section className={styles['panel']} aria-labelledby={headingId} data-notification-settings>
      <h3 id={headingId} className={styles['heading']}>{translate('notifications.settings.heading')}</h3>
      <p className={styles['muted']}>{translate('notifications.settings.detail')}</p>
      <table className={styles['table']}>
        <caption className={styles['caption']}>{translate('notifications.settings.categories')}</caption>
        <thead>
          <tr>
            <th scope="col">{translate('notifications.settings.category')}</th>
            <th scope="col">{translate('notifications.settings.show')}</th>
            <th scope="col">{translate('notifications.settings.sound')}</th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_CATEGORY_NAMES.map((category) => {
            const entry = preferences.notifications[category];
            const name = translate(`notifications.category.${category}`);
            return (
              <tr key={category}>
                <th scope="row">{name}</th>
                <td>
                  <input
                    type="checkbox"
                    checked={entry.visible}
                    aria-label={translate('notifications.settings.showCategory', { category: name })}
                    onChange={(event) => {
                      setCategory(category, 'visible', event.target.checked);
                    }}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={entry.sound}
                    aria-label={translate('notifications.settings.soundCategory', { category: name })}
                    onChange={(event) => {
                      setCategory(category, 'sound', event.target.checked);
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles['muted']}>{translate('notifications.settings.alwaysShown')}</p>

      <fieldset className={styles['fieldset']}>
        <legend>{translate('notifications.settings.audio')}</legend>
        <label className={styles['check']}>
          <input
            type="checkbox"
            checked={preferences.audio.enabled}
            onChange={(event) => {
              update((current) => ({ ...current, audio: { ...current.audio, enabled: event.target.checked } }));
            }}
          />
          {translate('notifications.settings.audioEnabled')}
        </label>
        <VolumeSlider
          label={translate('notifications.settings.master')}
          value={preferences.audio.master}
          locale={locale}
          onChange={(value) => {
            update((current) => ({ ...current, audio: { ...current.audio, master: value } }));
          }}
        />
        {AUDIO_CHANNEL_NAMES.map((channel) => (
          <VolumeSlider
            key={channel}
            label={translate(`notifications.settings.channel.${channel}`)}
            value={preferences.audio.channels[channel]}
            locale={locale}
            onChange={(value) => {
              setChannel(channel, value);
            }}
          />
        ))}
      </fieldset>

      <ActionButton actionId="preferences.restoreDefaults" runner={runner} onRun={restoreDefaults} />
    </section>
  );
}

function VolumeSlider({
  label,
  value,
  locale,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly locale: string;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className={styles['slider']}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        aria-valuetext={formatPercent(value, locale)}
        onChange={(event) => {
          onChange(Number(event.target.value) / 100);
        }}
      />
      <output htmlFor={id}>{formatPercent(value, locale)}</output>
    </div>
  );
}
