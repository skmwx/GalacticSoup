import type { JSX } from 'react';

import { AppShell, CompatibilityFailure, LocalizationProvider } from '@ui';

import type { EngineConnection } from './engineConnection';

/**
 * Top-level composition (Technical Specification 4.3).
 *
 * The root wires the localizer and the engine connection into the interface.
 * It holds no gameplay state of its own.
 */
export interface AppRootProps {
  readonly connection: EngineConnection;
}

export function AppRoot({ connection }: AppRootProps): JSX.Element {
  return (
    <LocalizationProvider>
      {connection.kind === 'ready' ? (
        <AppShell gateway={connection.gateway} />
      ) : (
        <CompatibilityFailure messageKey={connection.messageKey} />
      )}
    </LocalizationProvider>
  );
}
