import type { JSX } from 'react';

import type { ClientGateway } from '@gateway';

import { PlayScreen } from '../frame/PlayScreen';
import { CampaignPanel, StorageWarnings } from './CampaignPanel';
import { useCampaignSession } from './useCampaignSession';

/**
 * The gameplay surface, and the one place the campaign session lives
 * (Functional Specification 3.1, 19.1).
 *
 * Before a campaign is open there is one decision to make - start or resume -
 * so that is the whole screen. Once one is open the persistent frame and the
 * station take over, and they share the session this owns so that a save, a
 * close and an autosave trigger all go through the same policy.
 *
 * @implements FUNC-3.1, FUNC-19.1, TECH-12.1
 */

export interface GameRootProps {
  readonly gateway: ClientGateway;
}

export function GameRoot({ gateway }: GameRootProps): JSX.Element {
  const { state, session } = useCampaignSession(gateway);
  const open = state.session?.campaign ?? null;

  if (open === null) {
    return <CampaignPanel session={session} state={state} />;
  }

  return (
    <>
      <PlayScreen gateway={gateway} session={session} sessionState={state} />
      {state.slot === null ? null : <StorageWarnings status={state.slot.status} />}
    </>
  );
}
