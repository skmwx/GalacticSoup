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
  type CombatData,
  type CommandResultData,
  type DestinationsData,
  type EncounterData,
  type EngineError,
  type FittingDraftData,
  type LocationData,
  type LossReportData,
  type MarketListingsData,
  type RequestPayload,
  type ShipData,
  type SiteData,
  type StationServicesData,
  type UndockValidityData,
  type WreckContentsData,
} from '@protocol';
import type { MessageKey } from '@shared';

/**
 * The presentation store every play surface reads
 * (Technical Specification 7.3, 12.1).
 *
 * It holds nothing authoritative. Every field is an immutable projection the
 * engine answered with, and every player action is a command whose answer is
 * read back before anything is shown. What it does own is the refresh policy:
 * a command reports the projection topics it invalidated, and only those are
 * re-read, so a market purchase does not reload the fitting screen and an
 * elapsed simulation quantum reloads nothing but the tactical view.
 *
 * One store serves the station and the space view because the ship is in one
 * place at a time: the location the engine reports decides which projections
 * are worth asking for, and both screens then read the same snapshot.
 *
 * Which wreck is open is presentation, but its contents are a projection, so
 * the store holds the id the player opened and reads what the engine says the
 * wreck holds - including, when it is out of reach, why it cannot be taken.
 *
 * A pilot whose ship was destroyed may own none (Functional Specification
 * 9.12). The ship-specific projections then read as `null` rather than keep
 * describing the ship that was lost, and the loss report is read wherever the
 * pilot is, because it is what explains how they got there.
 *
 * Autosave triggers are answered here, whether a command or an elapsed
 * quantum raised them, and a trigger that arrives while a save is still being
 * written is folded into one follow-up save rather than queued behind it
 * (Functional Specification 3.4, 9.12; Technical Specification 11.3).
 *
 * @implements TECH-7.3, TECH-12.1, TECH-11.3, FUNC-9.12
 */

export interface PlayProjections {
  readonly assets: AssetsData | null;
  readonly services: StationServicesData | null;
  readonly market: MarketListingsData | null;
  readonly ship: ShipData | null;
  readonly fitting: FittingDraftData | null;
  readonly undock: UndockValidityData | null;
  readonly site: SiteData | null;
  readonly destinations: DestinationsData | null;
  readonly combat: CombatData | null;
  readonly encounter: EncounterData | null;
  /** The contents of the wreck the player opened, or `null`. */
  readonly wreck: WreckContentsData | null;
  /** The loss report: how many ships were lost and the last loss. */
  readonly loss: LossReportData | null;
}

export interface PlayDataState extends PlayProjections {
  readonly loading: boolean;
  /** The last refused command, cleared when the next one starts. */
  readonly error: EngineError | null;
  readonly transportMessageKey: MessageKey | null;
  /** The wreck the player opened, which is presentation state. */
  readonly openWreckId: string | null;
}

export interface PlayData extends PlayDataState {
  /** Where the ship is, according to the last projection read. */
  readonly location: LocationData | null;
  /** True while the ship is docked, which is what the station hub needs. */
  readonly docked: boolean;
  /** Re-reads everything the open surfaces show. */
  refresh(): Promise<void>;
  /** Re-reads only the projections these topics cover. */
  applyInvalidations(topics: readonly string[]): void;
  /** Opens one wreck's contents, or closes them with `null`. */
  openWreck(wreckId: string | null): void;
  /**
   * Answers an autosave trigger. A trigger that arrives while a save is being
   * written is coalesced into one follow-up save, so the snapshot catches up
   * with the latest state without a queue of writes.
   */
  requestAutosave(): Promise<void>;
  /**
   * Sends a command, reports its refusal, re-reads what it invalidated and
   * answers any autosave trigger it carried.
   */
  send<TType extends PlayCommand>(
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

/** The commands a play surface may send. */
export type PlayCommand =
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
  | 'targeting.lock'
  | 'targeting.unlock'
  | 'weapon.activate'
  | 'weapon.deactivate'
  | 'weapon.reload'
  | 'weapon.changeAmmunition'
  | 'module.activate'
  | 'module.deactivate'
  | 'loot.take'
  | 'movement.approach'
  | 'movement.orbit'
  | 'movement.keepRange'
  | 'movement.moveToPoint'
  | 'movement.stop'
  | 'navigation.selectDestination'
  | 'navigation.selectBookmark'
  | 'navigation.warp'
  | 'navigation.warpToBookmark'
  | 'navigation.retreat'
  | 'navigation.dock'
  | 'ship.undock'
  | 'time.set';

type ProjectionName = keyof PlayProjections;

/** Which projection each invalidation topic makes stale. */
const TOPIC_TARGETS: Readonly<Record<string, readonly ProjectionName[]>> = {
  // Whether the ship may undock is a site command, and it moves with the active
  // ship - a pilot who buys a hull after a loss may leave at once.
  assets: ['assets', 'ship', 'undock', 'site'],
  wallet: ['assets'],
  // What the hold carries decides which charges a weapon may change to and
  // how much of a wreck's contents would still fit.
  inventory: ['assets', 'fitting', 'combat', 'wreck'],
  ship: ['ship', 'undock', 'assets', 'fitting', 'combat'],
  fitting: ['fitting', 'ship', 'undock'],
  // Docking and undocking invalidate the station. Nothing station-only is read
  // while the ship is away - including after a campaign reopened in space - so
  // arriving refreshes every surface a docked ship can use.
  station: ['services', 'market', 'fitting', 'undock'],
  market: ['market'],
  repair: ['services', 'ship'],
  resupply: ['services', 'ship', 'assets'],
  insurance: ['services'],
  // A wreck opens and closes with range, which moves whenever the ship does.
  navigation: ['site', 'wreck'],
  site: ['site', 'wreck'],
  // The loss report carries the player's wreck as it is now: whether it is
  // chosen as the destination, how much is left in it and whether it expired.
  destinations: ['destinations', 'loss'],
  combat: ['combat'],
  encounter: ['encounter', 'wreck', 'loss'],
  loss: ['loss'],
};

/** Projections only a docked ship can answer for. */
const STATION_ONLY: readonly ProjectionName[] = ['services', 'market', 'fitting', 'undock'];

/** Projections that say nothing while the ship is docked. */
const SPACE_ONLY: readonly ProjectionName[] = ['combat', 'wreck'];

const EVERYTHING: readonly ProjectionName[] = [
  'assets',
  'services',
  'market',
  'ship',
  'fitting',
  'undock',
  'site',
  'destinations',
  'combat',
  'encounter',
  'wreck',
  'loss',
];

const INITIAL: PlayDataState = {
  loading: true,
  assets: null,
  services: null,
  market: null,
  ship: null,
  fitting: null,
  undock: null,
  site: null,
  destinations: null,
  combat: null,
  encounter: null,
  wreck: null,
  loss: null,
  error: null,
  transportMessageKey: null,
  openWreckId: null,
};

export interface PlayDataOptions {
  readonly gateway: ClientGateway;
  /** Answers autosave triggers, because only the client has a wall clock. */
  readonly session: CampaignSession;
  /** Null while no campaign is open, which empties the store. */
  readonly campaignId: string | null;
}

export function usePlayData(options: PlayDataOptions): PlayData {
  const { gateway, session, campaignId } = options;
  const [state, setState] = useState<PlayDataState>(INITIAL);
  const mounted = useRef(true);
  const inFlight = useRef(0);
  const reading = useRef(false);
  const queued = useRef(new Set<ProjectionName>());
  /** Where the ship was at the last read, so a tactical refresh costs one request. */
  const placement = useRef<{ location: LocationData; shipId: string | null } | null>(null);
  const openWreckId = useRef<string | null>(null);
  /** The autosave being written, and whether another trigger arrived meanwhile. */
  const saving = useRef<Promise<void> | null>(null);
  const saveAgain = useRef(false);

  useEffect(() => {
    // React StrictMode intentionally runs an extra setup/cleanup cycle in
    // development. Restore the flag in setup so the second cycle can publish
    // the projections it reads instead of leaving the play surface loading.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const publish = useCallback((next: Partial<PlayDataState>) => {
    if (mounted.current) {
      setState((previous) => ({ ...previous, ...next }));
    }
  }, []);

  const read = useCallback(
    async (targets: readonly ProjectionName[]): Promise<void> => {
      if (campaignId === null) {
        return;
      }
      const generation = (inFlight.current += 1);
      const wanted = new Set(targets);
      // The location decides which projections can answer, so it is read
      // whenever it is not already known.
      let placed = placement.current;
      let assets: AssetsData | null = null;
      if (placed === null || wanted.has('assets')) {
        const response = await gateway.request('assets.list', EMPTY_PAYLOAD);
        if (!response.ok) {
          publish({ loading: false, error: response.error });
          return;
        }
        assets = response.data;
        placed = { location: assets.location, shipId: assets.activeShipId };
        placement.current = placed;
      }

      const stationId = placed.location.kind === 'station' ? placed.location.stationId : null;
      const docked = stationId !== null;
      // A pilot who lost their only ship has none to describe (Functional
      // Specification 9.12), so nothing ship-specific is asked for.
      const shipId = placed.shipId;
      const ask = (name: ProjectionName): boolean =>
        wanted.has(name) &&
        (docked ? !SPACE_ONLY.includes(name) : !STATION_ONLY.includes(name));
      const wreckId = openWreckId.current;

      const [
        services,
        market,
        ship,
        fitting,
        undock,
        site,
        destinations,
        combat,
        encounter,
        wreck,
        loss,
      ] = await Promise.all([
        ask('services') && stationId !== null ? gateway.request('station.services', { stationId }) : null,
        ask('market') && stationId !== null ? gateway.request('market.listings', { stationId }) : null,
        ask('ship') && shipId !== null ? gateway.request('ship.get', { shipId }) : null,
        ask('fitting') ? gateway.request('fitting.draft', EMPTY_PAYLOAD) : null,
        ask('undock') && shipId !== null
          ? gateway.request('ship.undockValidity', { shipId })
          : null,
        ask('site') ? gateway.request('navigation.site', EMPTY_PAYLOAD) : null,
        ask('destinations') ? gateway.request('navigation.destinations', EMPTY_PAYLOAD) : null,
        ask('combat') ? gateway.request('combat.state', EMPTY_PAYLOAD) : null,
        ask('encounter') ? gateway.request('encounter.state', EMPTY_PAYLOAD) : null,
        ask('wreck') && wreckId !== null ? gateway.request('loot.contents', { wreckId }) : null,
        ask('loss') ? gateway.request('loss.report', EMPTY_PAYLOAD) : null,
      ]);

      // A later read has already published; this one is stale and dropped
      // rather than allowed to overwrite it (Technical Specification 7.3).
      if (generation !== inFlight.current) {
        return;
      }

      publish({
        loading: false,
        ...(assets === null ? {} : { assets }),
        ...(services?.ok === true ? { services: services.data } : {}),
        ...(market?.ok === true ? { market: market.data } : {}),
        ...(ship?.ok === true ? { ship: ship.data } : {}),
        ...(fitting?.ok === true ? { fitting: fitting.data } : {}),
        ...(undock?.ok === true ? { undock: undock.data } : {}),
        ...(site?.ok === true ? { site: site.data } : {}),
        ...(destinations?.ok === true ? { destinations: destinations.data } : {}),
        ...(combat?.ok === true ? { combat: combat.data } : {}),
        ...(encounter?.ok === true ? { encounter: encounter.data } : {}),
        ...(loss?.ok === true ? { loss: loss.data } : {}),
        // Without a ship there is nothing to describe or to undock, and the
        // ship that was lost must not go on being shown as the active one.
        ...(shipId === null && wanted.has('ship') ? { ship: null } : {}),
        ...(shipId === null && wanted.has('undock') ? { undock: null } : {}),
        // A wreck that expired or was left behind answers with an error, and
        // the open panel empties rather than showing what it used to hold.
        ...(wanted.has('wreck')
          ? {
              wreck:
                wreck?.ok === true && wreck.data.wreckId === openWreckId.current
                  ? wreck.data
                  : null,
            }
          : {}),
        // Docked, there is no tactical view to keep showing.
        ...(docked ? { combat: null, wreck: null } : {}),
      });
    },
    [gateway, campaignId, publish],
  );

  /**
   * Runs one read at a time. The tactical topics are invalidated every
   * simulation step, so a second request must replace the pending work rather
   * than queue behind it.
   */
  const readOnce = useCallback(
    async (targets: readonly ProjectionName[]): Promise<void> => {
      for (const target of targets) {
        queued.current.add(target);
      }
      if (reading.current) {
        return;
      }
      reading.current = true;
      try {
        while (queued.current.size > 0) {
          const next = [...queued.current];
          queued.current.clear();
          await read(next);
        }
      } finally {
        reading.current = false;
      }
    },
    [read],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      placement.current = null;
      await readOnce(EVERYTHING);
    } catch (error: unknown) {
      publish({ loading: false, transportMessageKey: describeThrown(error) });
    }
  }, [readOnce, publish]);

  const applyInvalidations = useCallback(
    (topics: readonly string[]): void => {
      const targets = new Set<ProjectionName>();
      for (const topic of topics) {
        for (const target of TOPIC_TARGETS[topic] ?? []) {
          targets.add(target);
        }
      }
      if (targets.size === 0) {
        return;
      }
      // Anything that can move the ship makes the cached placement stale.
      if (targets.has('assets')) {
        placement.current = null;
      }
      void readOnce([...targets]).catch((error: unknown) => {
        publish({ transportMessageKey: describeThrown(error) });
      });
    },
    [readOnce, publish],
  );

  const requestAutosave = useCallback((): Promise<void> => {
    if (saving.current !== null) {
      // A save is already being written. It captured an earlier revision, so
      // one more follows it; further triggers meanwhile fold into that one.
      saveAgain.current = true;
      return saving.current;
    }
    const run = async (): Promise<void> => {
      try {
        do {
          saveAgain.current = false;
          await session.save('auto');
        } while (saveAgain.current && mounted.current);
      } finally {
        saving.current = null;
        saveAgain.current = false;
      }
    };
    saving.current = run();
    return saving.current;
  }, [session]);

  const send = useCallback(
    async <TType extends PlayCommand>(
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
          await requestAutosave();
        }
        return { ok: true, result };
      } catch (error: unknown) {
        publish({ transportMessageKey: describeThrown(error) });
        return { ok: false, error: null };
      }
    },
    [gateway, publish, applyInvalidations, refresh, requestAutosave],
  );

  const openWreck = useCallback(
    (wreckId: string | null): void => {
      openWreckId.current = wreckId;
      publish({ openWreckId: wreckId, wreck: null });
      if (wreckId !== null) {
        void readOnce(['wreck']).catch((error: unknown) => {
          publish({ transportMessageKey: describeThrown(error) });
        });
      }
    },
    [readOnce, publish],
  );

  useEffect(() => {
    if (campaignId === null) {
      placement.current = null;
      openWreckId.current = null;
      setState(INITIAL);
      return;
    }
    void refresh();
  }, [campaignId, refresh]);

  const clearError = useCallback(() => {
    publish({ error: null, transportMessageKey: null });
  }, [publish]);

  const location = state.assets?.location ?? state.site?.location ?? null;

  return useMemo(
    () => ({
      ...state,
      location,
      docked: location?.kind === 'station',
      refresh,
      applyInvalidations,
      openWreck,
      requestAutosave,
      send,
      clearError,
    }),
    [state, location, refresh, applyInvalidations, openWreck, requestAutosave, send, clearError],
  );
}

function describeThrown(error: unknown): MessageKey {
  if (error instanceof GatewayRequestError || error instanceof EngineUnavailableError) {
    return error.messageKey;
  }
  return 'error.gateway.transportFailed';
}
