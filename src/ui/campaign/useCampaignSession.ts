import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  createCampaignSession,
  type CampaignSession,
  type CampaignSessionState,
  type ClientGateway,
} from '@gateway';

/**
 * Subscribes a view to the campaign session (Technical Specification 12.1).
 *
 * The session object holds the save policy and the wall clock; this hook only
 * makes React re-render when it publishes. No authoritative value is derived
 * or stored here: every value in the state arrived from the engine.
 *
 * @implements TECH-12.1
 */

export interface CampaignSessionView {
  readonly state: CampaignSessionState;
  readonly session: CampaignSession;
}

export function useCampaignSession(gateway: ClientGateway): CampaignSessionView {
  const session = useMemo(() => createCampaignSession({ gateway }), [gateway]);

  const subscribe = useCallback(
    (listener: () => void) => session.subscribe(listener),
    [session],
  );
  const snapshot = useCallback(() => session.state, [session]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    void session.refresh();
  }, [session]);

  return { state, session };
}
