import type { MessageKey } from '@shared';
import type { TransactionPreviewData } from './economy.ts';

/**
 * Stable error codes with localizable parameters
 * (Technical Specification 5.4).
 *
 * Expected rule failures are returned as values; they never throw across the
 * worker boundary.
 *
 * @implements TECH-5.4
 */
export const ENGINE_ERROR_CODES = [
  'INVALID_REQUEST',
  'STALE_REVISION',
  'STALE_PREVIEW',
  'RULE_VIOLATION',
  'NOT_FOUND',
  'CONTENT_ERROR',
  'SAVE_ERROR',
  'QUOTA_ERROR',
  'INTEGRITY_ERROR',
  'INTERNAL_ERROR',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

/** Parameter values are transport-safe scalars only. */
export type ErrorParams = Readonly<Record<string, string | number | boolean>>;

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly messageKey: MessageKey;
  readonly params?: ErrorParams;
  /** Present only for STALE_PREVIEW so the player can review current values. */
  readonly replacementPreview?: TransactionPreviewData;
}

/** Default message key for each code. A specific failure may refine the key. */
export const ENGINE_ERROR_MESSAGE_KEYS: Readonly<Record<EngineErrorCode, MessageKey>> = {
  INVALID_REQUEST: 'error.invalidRequest',
  STALE_REVISION: 'error.staleRevision',
  STALE_PREVIEW: 'error.stalePreview',
  RULE_VIOLATION: 'error.ruleViolation',
  NOT_FOUND: 'error.notFound',
  CONTENT_ERROR: 'error.contentError',
  SAVE_ERROR: 'error.saveError',
  QUOTA_ERROR: 'error.quotaError',
  INTEGRITY_ERROR: 'error.integrityError',
  INTERNAL_ERROR: 'error.internalError',
};

/** Why an envelope or payload was rejected as malformed protocol data. */
export const INVALID_REQUEST_REASONS = [
  'notAnObject',
  'protocolVersion',
  'requestId',
  'requestType',
  'campaignId',
  'expectedRevision',
  'payload',
  'unknownField',
  'unsupportedRequestType',
  'nonTransportableValue',
] as const;

export type InvalidRequestReason = (typeof INVALID_REQUEST_REASONS)[number];

export function invalidRequestMessageKey(reason: InvalidRequestReason): MessageKey {
  return `error.invalidRequest.${reason}`;
}

/**
 * Why a legal request was refused by the rules
 * (Technical Specification 5.4).
 *
 * A rule violation is an expected, explainable outcome: the request was
 * well-formed and the engine simply did not permit it. The interface must be
 * able to say why, so every reason has a message key
 * (Functional Specification 22.10).
 */
export const RULE_VIOLATION_REASONS = [
  'inventoryNotFound', 'itemNotFound', 'invalidQuantity', 'insufficientItems',
  'insufficientCapacity', 'incompatibleStacks', 'sameInventory', 'inventoryUnavailable',
  'invalidReservation', 'numericOverflow', 'insufficientCredits', 'stackNotDivisible',
  'fittingDraftClosed',
  'fittingDraftOpen',
  'fittingUnavailable',
  'fittingItemsMissing',
  'marketUnavailable',
  'marketListingUnavailable',
  'marketSourceUnavailable',
  'repairUnavailable',
  'resupplyUnavailable',
  'insuranceUnavailable',
  'invalidPreview',
  'campaignAlreadyOpen',
  'noCampaignOpen',
  'campaignMismatch',
  'unsupportedTimeRate',
  'destinationSelectionUnavailable',
  'destinationUnknown',
  'destinationCurrent',
  'undockUnavailable',
  'undockInvalidFit',
  'movementUnavailable',
  'movementTargetUnavailable',
  'warpUnavailable',
  'warpTooClose',
  'invalidArrivalDistance',
  'retreatUnavailable',
  'dockUnavailable',
  'combatUnavailable',
  'lockAlreadyHeld',
  'lockLimitReached',
  'lockNotHeld',
  'lockOutOfRange',
  'lockTargetUnavailable',
  'weaponAlreadyActive',
  'weaponAmmunitionIncompatible',
  'weaponInsufficientCapacitor',
  'weaponMagazineFull',
  'weaponNoAmmunition',
  'weaponNotActive',
  'weaponReloading',
  'weaponSlotUnavailable',
  'weaponUnloadNoSpace',
  'moduleAlreadyActive',
  'moduleNotActive',
  'moduleSlotUnavailable',
  'shipDestroyed',
  'lootUnavailable',
  'wreckNotFound',
  'wreckOutOfRange',
  'noResumableSave',
  'bookmarkUnknown',
  'noActiveShip',
] as const;

export type RuleViolationReason = (typeof RULE_VIOLATION_REASONS)[number];

export function ruleViolationMessageKey(reason: RuleViolationReason): MessageKey {
  return `error.ruleViolation.${reason}`;
}

export function ruleViolation(reason: RuleViolationReason, params?: ErrorParams): EngineError {
  return createEngineError('RULE_VIOLATION', ruleViolationMessageKey(reason), params);
}

/**
 * Why a fit may not be undocked with, and the advice that stops short of that
 * (Functional Specification 8.4-8.5).
 *
 * The lists are duplicated from the engine for the same reason the display-name
 * bound is: `@protocol` may not import the engine, and the interface needs a
 * message key for every code the engine can report. Tests check the two
 * vocabularies against each other.
 */
export const FIT_VIOLATION_CODES = [
  'moduleUnknown',
  'ammunitionUnknown',
  'slotUnavailable',
  'slotKindMismatch',
  'hardpointUnavailable',
  'hardpointMismatch',
  'ammunitionMismatch',
  'chargeNotAccepted',
  'magazineExceeded',
  'powerExceeded',
  'processingExceeded',
] as const;

export type FitViolationCodeName = (typeof FIT_VIOLATION_CODES)[number];

export const FIT_WARNING_CODES = [
  'noWeapon',
  'noAmmunition',
  'moduleOffline',
  'capacitorUnstable',
  'uncoveredDamageType',
] as const;

export type FitWarningCodeName = (typeof FIT_WARNING_CODES)[number];

export function fitViolationMessageKey(code: string): MessageKey {
  return `fitting.violation.${code}`;
}

export function fitWarningMessageKey(code: string): MessageKey {
  return `fitting.warning.${code}`;
}

/** A fitting change the rules refuse, named by the constraint it breaks. */
export function fitViolationError(code: string, params?: ErrorParams): EngineError {
  return createEngineError('RULE_VIOLATION', fitViolationMessageKey(code), params);
}

/** Why undocking is unavailable while the active fit is invalid. */
export const UNDOCK_INVALID_FIT_KEY: MessageKey = 'fitting.undock.invalidFit';

/**
 * Why a content bundle was rejected (Technical Specification 6.2, 14).
 *
 * The same vocabulary serves the build-time compiler and the load-time guard,
 * so a failure reported by `npm run validate:content` and the same failure
 * detected while loading a bundle name the same reason.
 */
export const CONTENT_ERROR_REASONS = [
  'invalidJson',
  'tooLarge',
  'structure',
  'unknownKind',
  'missingKind',
  'duplicateKind',
  'schema',
  'duplicateId',
  'unresolvedReference',
  'invalidValue',
  'catalogRelationship',
  'missingLocalization',
  'digestMismatch',
] as const;

export type ContentErrorReason = (typeof CONTENT_ERROR_REASONS)[number];

export function contentErrorMessageKey(reason: ContentErrorReason): MessageKey {
  return `error.contentError.${reason}`;
}

/**
 * One content problem, in a shape that crosses the engine boundary and can be
 * printed by the build. `file` and `path` locate it precisely: the authored
 * file and the JSON path inside it (Technical Specification 6.2).
 */
export interface ContentIssue {
  readonly reason: ContentErrorReason;
  /** Repository-relative authored file, or `''` for a whole-bundle problem. */
  readonly file: string;
  /** JSON path inside that file, or `''` for the document itself. */
  readonly path: string;
  /** Developer-facing English detail. Player-facing text uses `messageKey`. */
  readonly detail: string;
}

export function contentError(issue: ContentIssue): EngineError {
  return createEngineError('CONTENT_ERROR', contentErrorMessageKey(issue.reason), {
    file: issue.file,
    path: issue.path,
    detail: issue.detail,
  });
}

/**
 * Why a stored save could not be opened (Technical Specification 11.4).
 *
 * A save is untrusted input, so every step of the load pipeline has a reason
 * the player can be told. None of them modifies the stored snapshot: a save
 * that cannot be opened is left exactly as it was found.
 */
export const SAVE_LOAD_REASONS = [
  'notFound',
  'tooLarge',
  'structure',
  'envelope',
  'checksum',
  'forwardVersion',
  'migrationFailed',
  'payload',
  'contentIncompatible',
] as const;

export type SaveLoadReason = (typeof SAVE_LOAD_REASONS)[number];

export function saveLoadMessageKey(reason: SaveLoadReason): MessageKey {
  return `error.saveLoad.${reason}`;
}

/**
 * Corruption is reported as an integrity failure and everything else as a save
 * failure, so the interface can distinguish "this file is damaged" from "this
 * build cannot open it" (Technical Specification 5.4).
 */
const SAVE_LOAD_CODES: Readonly<Record<SaveLoadReason, EngineErrorCode>> = {
  notFound: 'SAVE_ERROR',
  tooLarge: 'INTEGRITY_ERROR',
  structure: 'INTEGRITY_ERROR',
  envelope: 'INTEGRITY_ERROR',
  checksum: 'INTEGRITY_ERROR',
  forwardVersion: 'SAVE_ERROR',
  migrationFailed: 'SAVE_ERROR',
  payload: 'INTEGRITY_ERROR',
  contentIncompatible: 'CONTENT_ERROR',
};

export function saveLoadError(reason: SaveLoadReason, params?: ErrorParams): EngineError {
  return createEngineError(SAVE_LOAD_CODES[reason], saveLoadMessageKey(reason), params);
}

/** Why a save could not be written (Technical Specification 11.1). */
export const SAVE_WRITE_REASONS = [
  'unavailable',
  'quota',
  'writeFailed',
  'readFailed',
  'notFound',
] as const;

export type SaveWriteReason = (typeof SAVE_WRITE_REASONS)[number];

export function saveWriteMessageKey(reason: SaveWriteReason): MessageKey {
  return `error.saveWrite.${reason}`;
}

export function saveWriteError(reason: SaveWriteReason, params?: ErrorParams): EngineError {
  return createEngineError(
    reason === 'quota' ? 'QUOTA_ERROR' : 'SAVE_ERROR',
    saveWriteMessageKey(reason),
    params,
  );
}

export function createEngineError(
  code: EngineErrorCode,
  messageKey: MessageKey,
  params?: ErrorParams,
): EngineError {
  return params === undefined || Object.keys(params).length === 0
    ? { code, messageKey }
    : { code, messageKey, params };
}

export function invalidRequest(reason: InvalidRequestReason, params?: ErrorParams): EngineError {
  return createEngineError('INVALID_REQUEST', invalidRequestMessageKey(reason), params);
}

export function internalError(params?: ErrorParams): EngineError {
  return createEngineError('INTERNAL_ERROR', ENGINE_ERROR_MESSAGE_KEYS.INTERNAL_ERROR, params);
}

/**
 * An invariant failed while a transaction was applying. The transaction is
 * abandoned and the previous state stands; the player is told that the
 * campaign could not be changed rather than being shown a corrupted result
 * (Technical Specification 5.4, 15.3).
 */
export function invariantFailure(params?: ErrorParams): EngineError {
  return createEngineError('INTERNAL_ERROR', 'error.internalError.invariant', params);
}

/** The revision the caller expected is not the revision the campaign is at. */
export function staleRevision(params?: ErrorParams): EngineError {
  return createEngineError('STALE_REVISION', ENGINE_ERROR_MESSAGE_KEYS.STALE_REVISION, params);
}

export function stalePreview(replacementPreview: TransactionPreviewData): EngineError {
  return {
    code: 'STALE_PREVIEW',
    messageKey: ENGINE_ERROR_MESSAGE_KEYS.STALE_PREVIEW,
    replacementPreview,
  };
}

/**
 * Every message key the protocol can emit. The shipped catalog must cover all
 * of them (tests/unit/ui/messageCatalog.test.ts).
 */
export const PROTOCOL_MESSAGE_KEYS: readonly MessageKey[] = [
  ...Object.values(ENGINE_ERROR_MESSAGE_KEYS),
  ...INVALID_REQUEST_REASONS.map(invalidRequestMessageKey),
  ...CONTENT_ERROR_REASONS.map(contentErrorMessageKey),
  ...RULE_VIOLATION_REASONS.map(ruleViolationMessageKey),
  ...SAVE_LOAD_REASONS.map(saveLoadMessageKey),
  ...SAVE_WRITE_REASONS.map(saveWriteMessageKey),
  ...FIT_VIOLATION_CODES.map(fitViolationMessageKey),
  ...FIT_WARNING_CODES.map(fitWarningMessageKey),
  UNDOCK_INVALID_FIT_KEY,
  'error.internalError.invariant',
].sort();
