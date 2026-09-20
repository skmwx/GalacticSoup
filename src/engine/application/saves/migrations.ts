import { SAVE_FORMAT_VERSION } from '@engine/ports';
import { deepClone } from '@shared';

/**
 * Ordered pure save migrations (Technical Specification 11.4).
 *
 * Every publicly released save version has a path to the current version. A
 * migration is an immutable function from one shape to the next: it receives a
 * private copy, returns a new one, and must not read a clock, take a random
 * draw or reach the content port. Each one ships with golden before/after
 * fixtures.
 *
 * Format version 1 is the baseline, so the registry is empty. A later format
 * adds one entry per version step; the runner below refuses a registry whose
 * steps do not chain, so a missing step cannot be discovered in production.
 *
 * @implements TECH-11.4
 */

/** A stored save at some format version, before it is known to be valid. */
export type MigratableSave = Record<string, unknown>;

export interface SaveMigration {
  readonly from: number;
  readonly to: number;
  /** Developer-facing note recorded in the migration report. */
  readonly describe: string;
  migrate(save: MigratableSave): MigratableSave;
}

/** No released format precedes version 1. */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [];

export type MigrationResult =
  | {
      readonly ok: true;
      readonly save: MigratableSave;
      /** Format versions the save passed through, oldest first. */
      readonly applied: readonly number[];
    }
  | { readonly ok: false; readonly reason: string; readonly fromVersion: number };

/**
 * Raises `save` to the current format version.
 *
 * The registry is a parameter so a test can prove the runner's ordering and
 * purity without a released format change to hang it on.
 */
export function migrateSave(
  save: MigratableSave,
  fromVersion: number,
  migrations: readonly SaveMigration[] = SAVE_MIGRATIONS,
  targetVersion: number = SAVE_FORMAT_VERSION,
): MigrationResult {
  if (fromVersion === targetVersion) {
    return { ok: true, save, applied: [] };
  }
  if (fromVersion > targetVersion) {
    return { ok: false, reason: 'forwardVersion', fromVersion };
  }

  const byFrom = new Map<number, SaveMigration>();
  for (const migration of migrations) {
    if (migration.to !== migration.from + 1) {
      return { ok: false, reason: 'nonSequentialMigration', fromVersion: migration.from };
    }
    if (byFrom.has(migration.from)) {
      return { ok: false, reason: 'duplicateMigration', fromVersion: migration.from };
    }
    byFrom.set(migration.from, migration);
  }

  const applied: number[] = [];
  let current = save;
  let version = fromVersion;

  while (version < targetVersion) {
    const migration = byFrom.get(version);
    if (migration === undefined) {
      return { ok: false, reason: 'noMigrationPath', fromVersion: version };
    }
    // The migration receives a private copy, so a migration that mutates its
    // input cannot corrupt the stored save or a later attempt.
    const next = migration.migrate(deepClone(current));
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      return { ok: false, reason: 'migrationProducedNonObject', fromVersion: version };
    }
    applied.push(version);
    current = next;
    version = migration.to;
    current['formatVersion'] = version;
  }

  return { ok: true, save: current, applied };
}
