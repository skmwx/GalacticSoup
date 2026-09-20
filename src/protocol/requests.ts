/**
 * Protocol version 1 request catalogue (Technical Specification 7.1, 18).
 *
 * Version 1 exposes engine health, capability reporting, content identity, the
 * campaign session, time control and a diagnostic state hash. Gameplay command
 * and query families are declared by the phases that implement them.
 *
 * A request type is added to a version rather than incrementing it while no
 * released client exists: `system.capabilities` reports the accepted types, so
 * a client discovers what this host answers instead of assuming it. The
 * version increments when a payload or response shape that has shipped
 * changes incompatibly.
 */

import type { EngineError } from './errors';

/** Payload for requests that take no arguments. */
export type EmptyPayload = Record<string, never>;

export const EMPTY_PAYLOAD: EmptyPayload = {};

export interface HealthData {
  readonly status: 'ready';
  readonly engineVersion: string;
  readonly protocolVersion: number;
}

export interface CapabilitiesData {
  readonly protocolVersion: number;
  readonly engineVersion: string;
  /** Request types this host accepts, sorted for stable comparison. */
  readonly requestTypes: readonly string[];
}

/**
 * Identity of the content the engine loaded (Technical Specification 6.3).
 *
 * The version and hash are recorded in every save, so the interface and the
 * diagnostics surface report exactly what the engine is running on. The counts
 * are informational and keyed by content kind in stable order.
 */
export interface ContentSummaryData {
  readonly contentVersion: string;
  readonly contentHash: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly definitionCounts: Readonly<Record<string, number>>;
}

/** Payload of `campaign.create` (Functional Specification 3.1). */
export interface CreateCampaignPayload {
  readonly displayName: string;
  /**
   * 128 bits of client randomness as lowercase hexadecimal. The engine is
   * deterministic and has no entropy source of its own, so the seed - and
   * through it the campaign identity and every random stream - arrives with
   * the command (Technical Specification 9.4).
   */
  readonly seed: string;
  /** Wall-clock creation time, kept for display only and never read by a rule. */
  readonly createdAtRealMs: number;
}

/** Payload of `time.set` (Functional Specification 3.3). */
export interface SetTimePayload {
  readonly paused: boolean;
  /** One of the rates the content rules offer. Pausing does not change it. */
  readonly rate: number;
}

/**
 * Payload of `time.advance` (Technical Specification 9.1).
 *
 * The main thread supplies monotonic elapsed frame deltas. The engine caps a
 * single delta, scales it by the selected rate and accumulates fixed quanta;
 * it never derives simulation time from a real timestamp.
 */
export interface AdvanceTimePayload {
  readonly elapsedRealMs: number;
}

/** One published domain event (Technical Specification 7.2, step 8). */
export interface DomainEventData {
  readonly ordinal: number;
  readonly kind: string;
  readonly simulationTimeMs: number;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * What every command answers with (Technical Specification 7.2, step 9).
 *
 * `committed` is false when the command was legal but changed nothing - an
 * elapsed delta while paused, for example. Nothing was written, no revision
 * was consumed and no projection went stale.
 */
export interface CommandResultData {
  readonly campaignId: string | null;
  readonly revision: number;
  readonly simulationTimeMs: number;
  readonly committed: boolean;
  /**
   * The command reached a point at which the campaign must be durable
   * (Functional Specification 3.4). The client answers by sending
   * `campaign.save`, because only the client has a wall clock to stamp the
   * snapshot with.
   */
  readonly autosaveRequested: boolean;
  /** Projection topics whose cached view models are now stale. */
  readonly invalidations: readonly string[];
  readonly events: readonly DomainEventData[];
}

export interface TimeControlData {
  readonly paused: boolean;
  readonly rate: number;
  /** Rates the content rules offer, ascending. Pause is always available. */
  readonly availableRates: readonly number[];
  readonly quantumMs: number;
}

export interface CampaignIdentityData {
  readonly campaignId: string;
  readonly displayName: string;
  readonly createdAtRealMs: number;
  readonly stateVersion: number;
}

/**
 * The persistent frame's slow-changing view model
 * (Functional Specification 19.1; Technical Specification 7.3).
 *
 * It answers what campaign is open, how time is configured and what build is
 * running - values that change only when the player changes them. Where the
 * clock currently stands belongs to `FrameData`, which is republished as
 * simulation time moves; duplicating it here would make this projection stale
 * on every frame and defeat topic-based invalidation.
 */
export interface SessionData {
  /** `null` while no campaign is open. */
  readonly campaign: CampaignIdentityData | null;
  readonly time: TimeControlData;
  readonly engineVersion: string;
  readonly contentVersion: string;
  readonly contentHash: string;
}

/** The revisioned frame published as simulation time moves (Technical Specification 7.3). */
export interface FrameData {
  readonly revision: number;
  readonly simulationTimeMs: number;
  readonly paused: boolean;
  readonly rate: number;
  readonly scheduledBoundaryCount: number;
  /** Simulation timestamp of the next scheduled boundary, or `null`. */
  readonly nextBoundaryAtMs: number | null;
}

/**
 * Canonical hash of authoritative state (Technical Specification 9.5).
 *
 * Read-only and free of side effects. Replay tests compare it at checkpoints,
 * and the development diagnostics panel shows it.
 */
export interface StateHashData {
  readonly campaignId: string | null;
  readonly revision: number;
  readonly simulationTimeMs: number;
  readonly stateHash: string | null;
  readonly contentHash: string;
}

/** Save kinds a campaign slot holds (Functional Specification 3.4). */
export const SAVE_KIND_NAMES = ['auto', 'manual'] as const;

export type SaveKindName = (typeof SAVE_KIND_NAMES)[number];

/**
 * Payload of `campaign.save` (Technical Specification 11.3).
 *
 * The engine has no wall clock, so the real timestamp a snapshot carries for
 * display arrives with the request that asks for it.
 */
export interface SaveCampaignPayload {
  readonly kind: SaveKindName;
  readonly savedAtRealMs: number;
}

/** Payload of `campaign.close` (Functional Specification 3.4). */
export interface CloseCampaignPayload {
  readonly savedAtRealMs: number;
}

/** What the browser says about the space saves have (Technical Specification 11.1). */
export interface StorageReportData {
  /** `null` when the browser does not answer. */
  readonly persistent: boolean | null;
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  /** True when the interface must warn that saving may soon fail. */
  readonly lowSpace: boolean;
}

export const SAVE_STATES = ['idle', 'pending', 'saved', 'failed'] as const;

export type SaveStateName = (typeof SAVE_STATES)[number];

/**
 * What the save subsystem is doing (Technical Specification 11.3).
 *
 * Saving is asynchronous and never blocks the simulation, so the interface
 * reports progress from this projection rather than from a command response.
 */
export interface SaveStatusData {
  readonly state: SaveStateName;
  /** Which store implementation is in use, for diagnostics. */
  readonly backend: string;
  readonly slotId: string;
  readonly lastSavedRevision: number | null;
  readonly lastSavedAtRealMs: number | null;
  readonly lastSaveKind: SaveKindName | null;
  readonly pendingWrites: number;
  readonly storage: StorageReportData;
  /** The failure that put the subsystem in `failed`, or `null`. */
  readonly error: EngineError | null;
}

/** The snapshot `campaign.resume` would open (Functional Specification 3.4). */
export interface ResumableSaveData {
  readonly saveId: string;
  readonly campaignId: string;
  readonly displayName: string;
  readonly kind: SaveKindName;
  readonly revision: number;
  readonly simulationTimeMs: number;
  readonly savedAtRealMs: number;
  readonly formatVersion: number;
  readonly contentVersion: string;
  /** False when the save was written against different content. */
  readonly contentMatches: boolean;
}

/**
 * The campaign slot (MVP Scope 6; Technical Specification 11.1).
 *
 * The MVP exposes one slot and resumes its newest valid snapshot; the deferred
 * save-management surfaces would read the same projection.
 */
export interface SaveSlotData {
  readonly slotId: string;
  readonly saveCount: number;
  readonly resumable: ResumableSaveData | null;
  readonly status: SaveStatusData;
}

export interface ProtocolContract {
  'system.health': { payload: EmptyPayload; data: HealthData };
  'system.capabilities': { payload: EmptyPayload; data: CapabilitiesData };
  'content.summary': { payload: EmptyPayload; data: ContentSummaryData };
  'campaign.close': { payload: CloseCampaignPayload; data: CommandResultData };
  'campaign.create': { payload: CreateCampaignPayload; data: CommandResultData };
  'campaign.reset': { payload: EmptyPayload; data: CommandResultData };
  'campaign.resume': { payload: EmptyPayload; data: CommandResultData };
  'campaign.save': { payload: SaveCampaignPayload; data: SaveStatusData };
  'campaign.saves': { payload: EmptyPayload; data: SaveSlotData };
  'campaign.session': { payload: EmptyPayload; data: SessionData };
  'campaign.frame': { payload: EmptyPayload; data: FrameData };
  'time.set': { payload: SetTimePayload; data: CommandResultData };
  'time.advance': { payload: AdvanceTimePayload; data: CommandResultData };
  'diagnostics.stateHash': { payload: EmptyPayload; data: StateHashData };
}

export type RequestType = keyof ProtocolContract;

export type RequestPayload<TType extends RequestType> = ProtocolContract[TType]['payload'];
export type ResponseData<TType extends RequestType> = ProtocolContract[TType]['data'];

/** Sorted so capability reports and fixtures are order-stable. */
export const REQUEST_TYPES = [
  'campaign.close',
  'campaign.create',
  'campaign.frame',
  'campaign.reset',
  'campaign.resume',
  'campaign.save',
  'campaign.saves',
  'campaign.session',
  'content.summary',
  'diagnostics.stateHash',
  'system.capabilities',
  'system.health',
  'time.advance',
  'time.set',
] as const satisfies readonly RequestType[];

/**
 * Request types that change campaign state. They run through the command
 * pipeline, may consume a revision and are covered by the duplicate-request
 * cache; every other type is a read-only query (Technical Specification 7.2).
 */
export const COMMAND_TYPES = [
  'campaign.close',
  'campaign.create',
  'campaign.reset',
  'campaign.resume',
  'time.advance',
  'time.set',
] as const satisfies readonly RequestType[];

export type CommandType = (typeof COMMAND_TYPES)[number];

/**
 * Request types that reach durable storage without changing campaign state
 * (Technical Specification 11.3). They take no revision and are neither pure
 * queries nor campaign commands, so the host handles them on their own path.
 */
export const PERSISTENCE_TYPES = ['campaign.save'] as const satisfies readonly RequestType[];

export type PersistenceType = (typeof PERSISTENCE_TYPES)[number];

export function isRequestType(value: string): value is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(value);
}

export function isCommandType(value: string): value is CommandType {
  return (COMMAND_TYPES as readonly string[]).includes(value);
}

export function isPersistenceType(value: string): value is PersistenceType {
  return (PERSISTENCE_TYPES as readonly string[]).includes(value);
}
