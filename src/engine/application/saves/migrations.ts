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
 * Formats below 11 belong to v0.1 and are refused, not migrated (ADR-V02-01);
 * from format 11 onward each format change adds one step here. The runner
 * refuses a registry whose steps do not chain, so a missing step cannot be
 * discovered in production.
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

/**
 * Format 11 to 12 (v0.2 phase 3): combat state gains the guided projectiles
 * in flight. A format-11 campaign could not have launched one, so it gains an
 * empty list and nothing else changes.
 */
export const MIGRATE_11_TO_12: SaveMigration = {
  from: 11,
  to: 12,
  describe: 'Combat state gains guided projectiles in flight; format-11 campaigns have none.',
  migrate(save) {
    const state = save['state'];
    if (typeof state !== 'object' || state === null || Array.isArray(state)) return save;
    const payload = state as Record<string, unknown>;
    const combat = payload['combat'];
    if (typeof combat === 'object' && combat !== null && !Array.isArray(combat)) {
      (combat as Record<string, unknown>)['projectiles'] = [];
    }
    payload['stateVersion'] = 12;
    return save;
  },
};

/**
 * Format 12 to 13 (v0.2 phase 4): combat state gains speed effects, and every
 * operated module and its cycle gain the target a targeted module acts on. A
 * format-12 campaign had no web to fit, so it gains an empty effect list and
 * a `null` target on every module and cycle; nothing else changes.
 */
export const MIGRATE_12_TO_13: SaveMigration = {
  from: 12,
  to: 13,
  describe: 'Combat state gains speed effects and module targets; format-12 campaigns have none.',
  migrate(save) {
    const state = save['state'];
    if (!isRecord(state)) return save;
    const combat = state['combat'];
    if (isRecord(combat)) {
      combat['speedEffects'] = [];
      const ships = combat['ships'];
      if (isRecord(ships)) {
        for (const ship of Object.values(ships)) {
          const modules = isRecord(ship) ? ship['modules'] : undefined;
          if (!isRecord(modules)) continue;
          for (const module of Object.values(modules)) {
            if (!isRecord(module)) continue;
            module['targetId'] = null;
            if (isRecord(module['cycle'])) module['cycle']['targetId'] = null;
          }
        }
      }
    }
    state['stateVersion'] = 13;
    return save;
  },
};

/**
 * The release boundary is format 11 (ADR-V02-01); every format from there on
 * migrates forward one step at a time.
 */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [MIGRATE_11_TO_12, MIGRATE_12_TO_13];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
