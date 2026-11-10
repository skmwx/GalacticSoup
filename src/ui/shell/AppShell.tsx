import type { JSX } from 'react';

import type { ClientGateway, TransportKind } from '@gateway';

import { GameRoot } from '../campaign/GameRoot';
import { useTranslate } from '../localization';
import { PreferencesProvider, type PreferenceStorage } from '../preferences';
import styles from './AppShell.module.css';
import { CompatibilityFailure } from './CompatibilityFailure';
import { EngineMark } from './EngineMark';
import { useEngineStatus, type EngineStatus } from './useEngineStatus';

/**
 * The application shell (Technical Specification 12.1, 16).
 *
 * It reports what the engine says about itself and then hands the screen to
 * the game. There is no campaign state in the interface: every value shown
 * here arrived through the gateway.
 *
 * It draws no header band of its own. While the engine is connecting it shows
 * the game's mark and that it is connecting; once the engine is ready the
 * readiness is only announced to assistive technology, and the game's own
 * header - the slim start bar, or the campaign header in play - is the only
 * one on screen. A failed start replaces everything with the compatibility
 * failure. The build diagnostics are a collapsed section of Settings.
 *
 * It owns the player's presentation preferences, so interface size, text
 * size, contrast and motion apply to every screen - including the one where a
 * campaign is started - and the settings are reachable from the game menu
 * everywhere (Functional Specification 19.1, 20).
 *
 * @implements TECH-12.1, FUNC-19.1, FUNC-20
 */

export interface AppShellProps {
  readonly gateway: ClientGateway;
  /** Overrides where preferences are kept; `null` keeps them in memory. */
  readonly preferenceStorage?: PreferenceStorage | null;
}

const TRANSPORT_KEYS: Readonly<Record<TransportKind, string>> = {
  worker: 'shell.transport.worker',
  port: 'shell.transport.port',
  direct: 'shell.transport.direct',
};

export function AppShell({ gateway, preferenceStorage }: AppShellProps): JSX.Element {
  return (
    <PreferencesProvider {...(preferenceStorage === undefined ? {} : { storage: preferenceStorage })}>
      <Shell gateway={gateway} />
    </PreferencesProvider>
  );
}

function Shell({ gateway }: { readonly gateway: ClientGateway }): JSX.Element {
  const translate = useTranslate();
  const status = useEngineStatus(gateway);

  if (status.kind === 'failed') {
    return (
      <CompatibilityFailure
        messageKey={status.messageKey}
        {...(status.params === undefined ? {} : { params: status.params })}
      />
    );
  }

  const connecting = status.kind === 'connecting';
  return (
    <div className={styles['shell']}>
      <h1 className={styles['visuallyHidden']}>{translate('app.title')}</h1>
      <div className={connecting ? styles['connecting'] : styles['visuallyHidden']}>
        {connecting ? <EngineMark className={styles['mark']} /> : null}
        <p
          className={styles['status']}
          role="status"
          aria-live="polite"
          aria-label={translate('shell.status.label')}
        >
          {connecting
            ? translate('shell.engine.connecting')
            : translate('shell.engine.ready', {
                transport: translate(TRANSPORT_KEYS[status.transport]),
              })}
        </p>
      </div>

      <main className={styles['main']}>
        {status.kind === 'ready' ? (
          <GameRoot gateway={gateway} settingsExtras={<EngineDiagnostics status={status} />} />
        ) : null}
      </main>
    </div>
  );
}

/** What the engine and content are, for a bug report rather than for play. */
function EngineDiagnostics({ status }: { readonly status: Extract<EngineStatus, { kind: 'ready' }> }): JSX.Element {
  const translate = useTranslate();
  return (
    <details className={styles['diagnostics']}>
      <summary className={styles['panelHeading']}>{translate('shell.diagnostics.sectionLabel')}</summary>

      <dl className={styles['facts']}>
        <div className={styles['fact']}>
          <dt>{translate('shell.engine.transport')}</dt>
          <dd>{status.transport}</dd>
        </div>
        <div className={styles['fact']}>
          <dt>{translate('shell.engine.version')}</dt>
          <dd>{status.health.engineVersion}</dd>
        </div>
        <div className={styles['fact']}>
          <dt>{translate('shell.engine.protocolVersion')}</dt>
          <dd>{status.health.protocolVersion}</dd>
        </div>
        <div className={styles['fact']}>
          <dt>{translate('shell.engine.requestTypes')}</dt>
          <dd>
            {translate('shell.engine.requestTypeCount', {
              count: status.capabilities.requestTypes.length,
            })}
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt>{translate('shell.content.version')}</dt>
          <dd>{status.content.contentVersion}</dd>
        </div>
        <div className={styles['fact']}>
          <dt>{translate('shell.content.definitions')}</dt>
          <dd>
            {translate('shell.content.definitionCount', {
              count: Object.values(status.content.definitionCounts).reduce(
                (total, count) => total + count,
                0,
              ),
              kinds: Object.keys(status.content.definitionCounts).length,
            })}
          </dd>
        </div>
      </dl>
    </details>
  );
}
