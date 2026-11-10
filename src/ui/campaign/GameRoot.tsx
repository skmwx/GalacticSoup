import { useRef, useState, type JSX, type ReactNode } from 'react';

import type { ClientGateway } from '@gateway';

import { useActionRunner } from '../actions';
import { GameMenu } from '../frame/GameMenu';
import { PlayScreen } from '../frame/PlayScreen';
import { PreferencesProvider, type PreferenceStorage } from '../preferences';
import { SettingsPanel } from '../settings';
import { EngineMark } from '../shell/EngineMark';
import { CampaignPanel, StorageWarnings } from './CampaignPanel';
import styles from './CampaignPanel.module.css';
import { useCampaignSession } from './useCampaignSession';

/**
 * The gameplay surface, and the one place the campaign session lives
 * (Functional Specification 3.1, 19.1, 20).
 *
 * Before a campaign is open there is one decision to make - start or resume -
 * so that is the whole screen, under a slim bar with the game's mark and the
 * game menu. Once one is open the persistent frame and the station take over,
 * and they share the session this owns so that a save, a close and an
 * autosave trigger all go through the same policy.
 *
 * It also owns the two things every surface shares: the player's preferences,
 * so a change made in Settings reaches the play view at once, and the
 * Settings panel itself, which the game menu opens from either screen. Closing
 * Settings returns focus to the game-menu trigger.
 *
 * @implements FUNC-3.1, FUNC-19.1, FUNC-20, TECH-12.1, TECH-12.3
 */

export interface GameRootProps {
  readonly gateway: ClientGateway;
  /** Further Settings sections, such as the shell's build diagnostics. */
  readonly settingsExtras?: ReactNode;
  /**
   * Where preferences are kept; `null` keeps them in memory. Ignored inside an
   * outer `PreferencesProvider`, which already owns the one set.
   */
  readonly preferenceStorage?: PreferenceStorage | null;
}

const SETTINGS_PANEL_ID = 'gs-settings';

export function GameRoot({ preferenceStorage, ...rest }: GameRootProps): JSX.Element {
  return (
    <PreferencesProvider {...(preferenceStorage === undefined ? {} : { storage: preferenceStorage })}>
      <Root {...rest} />
    </PreferencesProvider>
  );
}

function Root({ gateway, settingsExtras }: Omit<GameRootProps, 'preferenceStorage'>): JSX.Element {
  const { state, session } = useCampaignSession(gateway);
  const runner = useActionRunner();
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const open = state.session?.campaign ?? null;

  const closeSettings = (): void => {
    setSettingsOpen(false);
    menuTrigger.current?.focus();
  };
  const toggleSettings = (): void => {
    if (settingsOpen) closeSettings();
    else setSettingsOpen(true);
  };

  const settings = settingsOpen ? (
    <SettingsPanel id={SETTINGS_PANEL_ID} focusOnOpen onClose={closeSettings}>
      {settingsExtras}
    </SettingsPanel>
  ) : null;

  if (open === null) {
    return (
      <>
        <header className={styles['bar']}>
          <EngineMark className={styles['mark']} />
          <GameMenu
            runner={runner}
            triggerRef={menuTrigger}
            settingsOpen={settingsOpen}
            onToggleSettings={toggleSettings}
          />
        </header>
        {settings}
        <CampaignPanel session={session} state={state} />
      </>
    );
  }

  return (
    <>
      <PlayScreen
        gateway={gateway}
        session={session}
        sessionState={state}
        settings={settings}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
        menuTrigger={menuTrigger}
      />
      {state.slot === null ? null : <StorageWarnings status={state.slot.status} />}
    </>
  );
}
