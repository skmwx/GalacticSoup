import { afterAll } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { createEngineHost, DEFAULT_SAVE_RETENTION, type ContentRepository, type SaveEnvelope } from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import type { AssetsData, EncounterData, RequestPayload, RequestType } from '@protocol';

/**
 * Gateways and projections for the golden campaign files
 * (`tests/integration/goldenCampaign*.test.ts`). Every gateway made here is
 * disposed of after the file that made it.
 */
export function goldenGateways(content: ContentRepository): {
  readonly directGateway: (saves?: ReturnType<typeof createMemorySaveStore>) => ClientGateway;
  readonly channelGateway: () => ClientGateway;
  readonly gatewayHolding: (envelope: SaveEnvelope) => Promise<ClientGateway>;
  readonly projections: (gateway: ClientGateway) => Promise<Record<string, unknown>>;
} {
  const disposers: (() => void)[] = [];
  afterAll(() => {
    while (disposers.length > 0) disposers.pop()?.();
  });

  function directGateway(saves = createMemorySaveStore()): ClientGateway {
    const gateway = createDirectGateway({ host: createEngineHost({ content, saves }), defaultTimeoutMs: 20_000 });
    disposers.push(() => gateway.dispose());
    return gateway;
  }

  function channelGateway(): ClientGateway {
    const channel = createChannelGateway({
      host: createEngineHost({ content, saves: createMemorySaveStore() }),
      defaultTimeoutMs: 20_000,
    });
    disposers.push(() => channel.close());
    return channel.gateway;
  }

  /** A gateway whose store already holds one save, as a browser that was closed would. */
  async function gatewayHolding(envelope: SaveEnvelope): Promise<ClientGateway> {
    const saves = createMemorySaveStore();
    await saves.write({ envelope, retention: DEFAULT_SAVE_RETENTION });
    return directGateway(saves);
  }

  /**
   * Every projection the interface can ask for at this point, keyed by request.
   * An answer is kept whole, refusals included, so two campaigns in the same
   * state must agree on what they refuse as well as on what they show.
   */
  async function projections(gateway: ClientGateway): Promise<Record<string, unknown>> {
    const answers: Record<string, unknown> = {};
    const ask = async (type: string, payload: unknown = {}): Promise<unknown> => {
      const response = await gateway.request(type as RequestType, payload as RequestPayload<RequestType>);
      const { requestId: _requestId, ...answer } = response;
      void _requestId;
      answers[`${type} ${JSON.stringify(payload)}`] = answer;
      return response.ok ? response.data : null;
    };

    for (const type of [
      'campaign.session', 'campaign.frame', 'wallet.get', 'navigation.site', 'navigation.destinations',
      'combat.state', 'loss.report', 'onboarding.state', 'notifications.list', 'fitting.draft',
    ]) await ask(type);

    const stationId = content.rules.economy.startingStationId;
    for (const type of ['inventory.hangar', 'station.services', 'market.listings']) await ask(type, { stationId });

    const assets = (await ask('assets.list')) as AssetsData;
    for (const ship of assets.ships) {
      for (const type of [
        'ship.get', 'ship.undockValidity', 'inventory.cargo', 'repair.preview', 'resupply.preview', 'insurance.preview',
      ]) await ask(type, { shipId: ship.id });
    }
    const encounter = (await ask('encounter.state')) as EncounterData;
    for (const wreck of encounter.wrecks) await ask('loot.contents', { wreckId: wreck.wreckId });
    return answers;
  }

  return { directGateway, channelGateway, gatewayHolding, projections };
}
