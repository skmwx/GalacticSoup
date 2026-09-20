import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EngineUnavailableError,
  GatewayRequestError,
  type CampaignSession,
  type ClientGateway,
} from '@gateway';
import {
  EMPTY_PAYLOAD,
  type AssetsData,
  type CommandResultData,
  type EngineError,
  type FittingDraftData,
  type MarketListingsData,
  type RequestPayload,
  type ShipData,
  type StationServicesData,
  type UndockValidityData,
} from '@protocol';
import type { MessageKey } from '@shared';

/**
 * The station's presentation store (Technical Specification 7.3, 12.1).
 *
 * It holds nothing authoritative. Every field is an immutable projection the
 * engine answered with, and every player action is a command whose answer is
 * read back before anything is shown. What it does own is the refresh policy:
 * a command reports the projection topics it invalidated, and only those are
 * re-read, so a market purchase does not reload the fitting screen and an
 * elapsed simulation quantum reloads nothing at all.
 *
 * @implements TECH-7.3, TECH-12.1
 */

export interface StationProjections {
  readonly assets: AssetsData | null;
  readonly services: StationServicesData | null;
  readonly market: MarketListingsData | null;
  readonly ship: ShipData | null;
  readonly fitting: FittingDraftData | null;
  readonly undock: UndockValidityData | null;
}

export interface StationDataState extends StationProjections {
  readonly loading: boolean;
  /** The last refused command, cleared when the next one starts. */
  readonly error: EngineError | null;
  readonly transportMessageKey: MessageKey | null;
}

export interface StationData extends StationDataState {
  /** Re-reads everything the station shows. */
  refresh(): Promise<void>;
  /** Re-reads only the projections these topics cover. */
  applyInvalidations(topics: readonly string[]): void;
  /**
   * Sends a command, reports its refusal, re-reads what it invalidated and
   * answers any autosave trigger it carried.
   */
  send<TType extends StationCommand>(
    type: TType,
    payload: RequestPayload<TType>,
  ): Promise<CommandAnswer>;
  clearError(): void;
}

/**
 * What a sent command answered. A transport failure carries no engine error,
 * because the engine never saw the request.
 */
export type CommandAnswer =
  | { readonly ok: true; readonly result: CommandResultData }
  | { readonly ok: false; readonly error: EngineError | null };

/** The commands a station surface may send. */
export type StationCommand =
  | 'fitting.begin'
  | 'fitting.set'
  | 'fitting.clear'
  | 'fitting.revert'
  | 'fitting.commit'
  | 'inventory.transfer'
  | 'inventory.merge'
  | 'inventory.split'
  | 'market.confirmBuy'
  | 'market.confirmSell'
  | 'repair.confirm'
  | 'resupply.confirm'
  | 'insurance.confirm'
  | 'time.set';

/** Which projection each invalidation topic makes stale. */
const TOPIC_TARGETS: Readonly<Record<string, readonly (keyof StationProjections)[]>> = {
  assets: ['assets', 'ship', 'undock'],
  wallet: ['assets'],
  inventory: ['assets', 'fitting'],
  ship: ['ship', 'undock', 'assets', 'fitting'],
  fitting: ['fitting', 'ship', 'undock'],
  station: ['services'],
  market: ['market'],
  repair: ['services', 'ship'],
  resupply: ['services', 'ship', 'assets'],
  insurance: ['services'],
};

const INITIAL: StationDataState = {
  loading: true,
  assets: null,
  services: null,
  market: null,
  ship: null,
  fitting: null,
  undock: null,
  error: null,
  transportMessageKey: null,
};

export interface StationDataOptions {
  readonly gateway: ClientGateway;
  /** Answers autosave triggers, because only the client has a wall clock. */
  readonly session: CampaignSession;
  /** Null while no campaign is open, which empties the store. */
  readonly campaignId: string | null;
}

export function useStationData(options: StationDataOptions): StationData {
  const { gateway, session, campaignId } = options;
  const [state, setState] = useState<StationDataState>(INITIAL);
  const mounted = useRef(true);
  const inFlight = useRef(0);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const publish = useCallback((next: Partial<StationDataState>) => {
    if (mounted.current) {
      setState((previous) => ({ ...previous, ...next }));
    }
  }, []);

  const read = useCallback(
    async (targets: readonly (keyof StationProjections)[]): Promise<void> => {
      if (campaignId === null) {
        return;
      }
      const generation = (inFlight.current += 1);
      const assets = await gateway.request('assets.list', EMPTY_PAYLOAD);
      if (!assets.ok) {
        publish({ loading: false, error: assets.error });
        return;
      }
      const stationId = assets.data.location.stationId;
      const shipId = assets.data.activeShipId;
      const wanted = new Set(targets);

      const [services, market, ship, fitting, undock] = await Promise.all([
        wanted.has('services') ? gateway.request('station.services', { stationId }) : null,
        wanted.has('market') ? gateway.request('market.listings', { stationId }) : null,
        wanted.has('ship') ? gateway.request('ship.get', { shipId }) : null,
        wanted.has('fitting') ? gateway.request('fitting.draft', EMPTY_PAYLOAD) : null,
        wanted.has('undock') ? gateway.request('ship.undockValidity', { shipId }) : null,
      ]);

      // A later read has already published; this one is stale and dropped
      // rather than allowed to overwrite it (Technical Specification 7.3).
      if (generation !== inFlight.current) {
        return;
      }

      publish({
        loading: false,
        ...(wanted.has('assets') ? { assets: assets.data } : {}),
        ...(services?.ok === true ? { services: services.data } : {}),
        ...(market?.ok === true ? { market: market.data } : {}),
        ...(ship?.ok === true ? { ship: ship.data } : {}),
        ...(fitting?.ok === true ? { fitting: fitting.data } : {}),
        ...(undock?.ok === true ? { undock: undock.data } : {}),
      });
    },
    [gateway, campaignId, publish],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await read(['assets', 'services', 'market', 'ship', 'fitting', 'undock']);
    } catch (error: unknown) {
      publish({ loading: false, transportMessageKey: describeThrown(error) });
    }
  }, [read, publish]);

  const applyInvalidations = useCallback(
    (topics: readonly string[]): void => {
      const targets = new Set<keyof StationProjections>();
      for (const topic of topics) {
        for (const target of TOPIC_TARGETS[topic] ?? []) {
          targets.add(target);
        }
      }
      if (targets.size === 0) {
        return;
      }
      void read([...targets]).catch((error: unknown) => {
        publish({ transportMessageKey: describeThrown(error) });
      });
    },
    [read, publish],
  );

  const send = useCallback(
    async <TType extends StationCommand>(
      type: TType,
      payload: RequestPayload<TType>,
    ): Promise<CommandAnswer> => {
      publish({ error: null, transportMessageKey: null });
      try {
        const response = await gateway.request(type, payload);
        if (!response.ok) {
          publish({ error: response.error });
          // A refusal can still mean the store is out of date - a stale
          // preview, for instance - so what it shows is re-read either way.
          await refresh();
          return { ok: false, error: response.error };
        }
        const result = response.data;
        applyInvalidations(result.invalidations);
        if (result.autosaveRequested) {
          await session.save('auto');
        }
        return { ok: true, result };
      } catch (error: unknown) {
        publish({ transportMessageKey: describeThrown(error) });
        return { ok: false, error: null };
      }
    },
    [gateway, session, publish, applyInvalidations, refresh],
  );

  useEffect(() => {
    if (campaignId === null) {
      setState(INITIAL);
      return;
    }
    void refresh();
  }, [campaignId, refresh]);

  const clearError = useCallback(() => {
    publish({ error: null, transportMessageKey: null });
  }, [publish]);

  return useMemo(
    () => ({ ...state, refresh, applyInvalidations, send, clearError }),
    [state, refresh, applyInvalidations, send, clearError],
  );
}

function describeThrown(error: unknown): MessageKey {
  if (error instanceof GatewayRequestError || error instanceof EngineUnavailableError) {
    return error.messageKey;
  }
  return 'error.gateway.transportFailed';
}
