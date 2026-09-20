import {
  campaignDefinitionReferences,
  readCampaignState,
  type CampaignState,
  type InvariantIssue,
} from '@engine/domain';
import {
  SAVE_FORMAT_VERSION,
  SAVE_LIMITS,
  isSaveKind,
  type ContentRepository,
  type SaveEnvelope,
} from '@engine/ports';
import { saveLoadError, type EngineError } from '@protocol';
import { findStructuralViolation, type DefinitionId } from '@shared';

import { envelopeChecksum } from './envelope';
import { migrateSave, SAVE_MIGRATIONS, type MigratableSave, type SaveMigration } from './migrations';

/**
 * Loading a stored save (Technical Specification 11.4).
 *
 * A stored save is untrusted input even when this browser wrote it, so it is
 * walked in the order the specification prescribes and rejected at the
 * first step it fails:
 *
 *   1. envelope and size validation;
 *   2. checksum validation;
 *   3. schema validation for the stored format version;
 *   4. ordered pure migrations to the current version;
 *   5. content-version compatibility;
 *   6. cross-reference and invariant validation.
 *
 * Nothing here writes: a save that cannot be opened is left exactly as it was
 * found, and the caller falls back to the previous valid snapshot.
 *
 * Steps 5 and 6 are interleaved by necessity. Identical content identity
 * settles compatibility outright; a difference is settled by checking that
 * every definition the save state names still resolves, which is the
 * cross-reference check the same specification requires.
 *
 * @implements TECH-11.4
 */

export interface LoadContext {
  readonly content: ContentRepository;
  readonly migrations?: readonly SaveMigration[];
}

export interface LoadSuccess {
  readonly ok: true;
  readonly state: CampaignState;
  readonly envelope: SaveEnvelope;
  /** Format versions the save was migrated through, oldest first. */
  readonly migrated: readonly number[];
  /**
   * The save was written against different content that this build can still
   * read. Future calculations adopt the installed values.
   */
  readonly contentChanged: boolean;
}

export interface LoadFailure {
  readonly ok: false;
  readonly error: EngineError;
  /** Invariant or shape problems, when the payload was the thing at fault. */
  readonly issues: readonly InvariantIssue[];
}

export type LoadResult = LoadSuccess | LoadFailure;

export function loadSave(stored: unknown, context: LoadContext): LoadResult {
  const bounded = boundStructure(stored);
  if (bounded !== null) {
    return bounded;
  }

  const save = stored as MigratableSave;
  const shape = checkEnvelopeShape(save);
  if (shape !== null) {
    return shape;
  }

  const storedVersion = save['formatVersion'] as number;

  if (storedVersion === SAVE_FORMAT_VERSION) {
    // Only an envelope of the current shape can be checksummed by this build:
    // an older one is sealed over fields this build no longer knows.
    const { checksum, ...fields } = save as unknown as SaveEnvelope;
    if (envelopeChecksum(fields) !== checksum) {
      return failure(saveLoadError('checksum', { saveId: String(save['saveId']) }));
    }
  }

  if (storedVersion > SAVE_FORMAT_VERSION) {
    return failure(
      saveLoadError('forwardVersion', {
        stored: storedVersion,
        supported: SAVE_FORMAT_VERSION,
      }),
    );
  }

  const migration = migrateSave(
    save,
    storedVersion,
    context.migrations ?? SAVE_MIGRATIONS,
  );
  if (!migration.ok) {
    return failure(
      saveLoadError('migrationFailed', {
        reason: migration.reason,
        fromVersion: migration.fromVersion,
      }),
    );
  }

  const payload = readCampaignState(migration.save['state']);
  if (!payload.ok) {
    const first = payload.issues[0];
    return {
      ok: false,
      error: saveLoadError('payload', {
        count: payload.issues.length,
        rule: first?.rule ?? 'unknown',
        path: first?.path ?? '',
      }),
      issues: payload.issues,
    };
  }

  const envelope = migration.save as unknown as SaveEnvelope;
  if (envelope.campaignId !== payload.state.campaignId) {
    return failure(
      saveLoadError('envelope', {
        field: 'campaignId',
        reason: 'disagreesWithPayload',
      }),
    );
  }

  const contentChanged = envelope.contentHash !== context.content.contentHash;
  if (contentChanged) {
    const missing = unresolvedReferences(
      campaignDefinitionReferences(payload.state),
      context.content,
    );
    if (missing.length > 0) {
      return failure(
        saveLoadError('contentIncompatible', {
          storedContentVersion: envelope.contentVersion,
          installedContentVersion: context.content.contentVersion,
          missing: missing.length,
          firstMissing: missing[0] ?? '',
        }),
      );
    }
  }

  return {
    ok: true,
    state: payload.state,
    envelope,
    migrated: migration.applied,
    contentChanged,
  };
}

const ENVELOPE_FIELDS: readonly string[] = [
  'format',
  'formatVersion',
  'protocolVersion',
  'engineVersion',
  'contentVersion',
  'contentHash',
  'slotId',
  'saveId',
  'campaignId',
  'displayName',
  'kind',
  'sequence',
  'revision',
  'simulationTimeMs',
  'savedAtRealMs',
  'state',
  'checksum',
];

function boundStructure(stored: unknown): LoadFailure | null {
  if (stored === null || stored === undefined) {
    return failure(saveLoadError('notFound'));
  }

  const violation = findStructuralViolation(stored, SAVE_LIMITS, 'save');
  if (violation !== null) {
    return failure(
      saveLoadError('structure', {
        reason: violation.reason,
        path: violation.path,
        detail: violation.detail,
      }),
    );
  }
  return null;
}

/**
 * Checks the envelope before anything inside it is trusted. Only the fields
 * the pipeline itself needs are checked here; the payload is checked by the
 * domain once its format version is current.
 */
function checkEnvelopeShape(save: MigratableSave): LoadFailure | null {
  if (save['format'] !== 'galactic-soup/save') {
    return failure(saveLoadError('envelope', { field: 'format', reason: 'unknownFormat' }));
  }
  for (const key of Object.keys(save)) {
    if (!ENVELOPE_FIELDS.includes(key)) {
      return failure(saveLoadError('envelope', { field: key, reason: 'unexpectedField' }));
    }
  }
  for (const field of ENVELOPE_FIELDS) {
    if (!(field in save)) {
      return failure(saveLoadError('envelope', { field, reason: 'missing' }));
    }
  }

  const checks: readonly (readonly [string, boolean])[] = [
    ['formatVersion', isCount(save['formatVersion']) && (save['formatVersion'] as number) >= 1],
    ['protocolVersion', isCount(save['protocolVersion'])],
    ['engineVersion', isText(save['engineVersion'])],
    ['contentVersion', isText(save['contentVersion'])],
    ['contentHash', isText(save['contentHash'])],
    ['slotId', isText(save['slotId'])],
    ['saveId', isText(save['saveId'])],
    ['campaignId', isText(save['campaignId'])],
    ['displayName', isText(save['displayName'])],
    ['kind', isSaveKind(save['kind'])],
    ['sequence', isCount(save['sequence'])],
    ['revision', isCount(save['revision'])],
    ['simulationTimeMs', isCount(save['simulationTimeMs'])],
    ['savedAtRealMs', isCount(save['savedAtRealMs'])],
    ['checksum', isText(save['checksum'])],
    ['state', isRecord(save['state'])],
  ];

  for (const [field, ok] of checks) {
    if (!ok) {
      return failure(saveLoadError('envelope', { field, reason: 'format' }));
    }
  }

  return null;
}

/** Definition ids the save state names that the installed content lacks. */
function unresolvedReferences(
  references: readonly DefinitionId[],
  content: ContentRepository,
): readonly string[] {
  return references.filter((id) => !resolves(id, content));
}

function resolves(id: string, content: ContentRepository): boolean {
  return (
    content.tradeable(id) !== undefined ||
    content.hull(id) !== undefined ||
    content.system(id) !== undefined ||
    content.station(id) !== undefined ||
    content.npcProfile(id) !== undefined ||
    content.lootTable(id) !== undefined ||
    content.encounter(id) !== undefined
  );
}

function failure(error: EngineError): LoadFailure {
  return { ok: false, error, issues: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
