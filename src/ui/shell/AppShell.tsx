import type { JSX } from 'react';

import type { ClientGateway, TransportKind } from '@gateway';

import { GameRoot } from '../campaign/GameRoot';
import { useTranslate } from '../localization';
import styles from './AppShell.module.css';
import { CompatibilityFailure } from './CompatibilityFailure';
import { EngineMark } from './EngineMark';
import { useEngineStatus } from './useEngineStatus';

/**
 * The application shell (Technical Specification 12.1, 16).
 *
 * It reports what the engine says about itself and then hands the screen to
 * the game. There is no campaign state in the interface: every value shown
 * here arrived through the gateway, and the build diagnostics are a collapsed
 * panel rather than the main surface.
 *
 * @implements TECH-12.1
 */

export interface AppShellProps {
  readonly gateway: ClientGateway;
}

const TRANSPORT_KEYS: Readonly<Record<TransportKind, string>> = {
  worker: 'shell.transport.worker',
  port: 'shell.transport.port',
  direct: 'shell.transport.direct',
};

export function AppShell({ gateway }: AppShellProps): JSX.Element {
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

  return (
    <div className={styles['shell']}>
      <header className={styles['header']}>
        <EngineMark className={styles['mark']} />
        <div>
          <h1 className={styles['title']}>{translate('app.title')}</h1>
          <p className={styles['tagline']}>{translate('app.tagline')}</p>
        </div>
        <p
          className={styles['status']}
          role="status"
          aria-live="polite"
          aria-label={translate('shell.status.label')}
        >
          {status.kind === 'connecting'
            ? translate('shell.engine.connecting')
            : translate('shell.engine.ready', {
                transport: translate(TRANSPORT_KEYS[status.transport]),
              })}
        </p>
      </header>

      <main className={styles['main']}>
        {status.kind === 'ready' ? <GameRoot gateway={gateway} /> : null}

        {status.kind === 'ready' ? (
          <details className={styles['panel']}>
            <summary className={styles['panelHeading']}>
              {translate('shell.diagnostics.sectionLabel')}
            </summary>

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
        ) : null}
      </main>
    </div>
  );
}
