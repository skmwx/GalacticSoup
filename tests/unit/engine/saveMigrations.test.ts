import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { migrateSave, OLDEST_SUPPORTED_SAVE_FORMAT_VERSION, SAVE_FORMAT_VERSION, SAVE_MIGRATIONS, type SaveMigration } from '@engine';
import { MIGRATE_11_TO_12 } from '../../../src/engine/application/saves/migrations.ts';
import { REPO_ROOT } from '../../../config/aliases.mjs';

/**
 * The migration registry and its runner (Technical Specification 11.4).
 *
 * Format version 1 is the baseline, so the shipped registry is empty. The
 * runner is still proved here against an injected registry: when a released
 * format does change, the ordering, purity and chaining rules a migration
 * relies on must already be known to hold.
 */

const step = (from: number, apply: (save: Record<string, unknown>) => void): SaveMigration => ({
  from,
  to: from + 1,
  describe: `test step ${String(from)}`,
  migrate: (save) => {
    apply(save);
    return save;
  },
});

describe('save migrations', () => {
  it('migrates only from the v0.2 boundary: v0.1 saves are refused, format 11 steps to 12 [TECH-11.4, V02-AC-13]', () => {
    // ADR-V02-01: the v0.1 -> v0.2 transition is a declared compatibility
    // boundary, so no migration from formats 1-10 exists or is owed. From
    // format 11 on, each format change is one migration step.
    expect(SAVE_MIGRATIONS).toEqual([MIGRATE_11_TO_12]);
    expect(SAVE_FORMAT_VERSION).toBe(12);
    expect(OLDEST_SUPPORTED_SAVE_FORMAT_VERSION).toBe(11);
  });

  it('gives a format-11 campaign an empty projectile list and state version 12 [TECH-11.4, V02-AC-13]', () => {
    const save = {
      formatVersion: 11,
      state: { stateVersion: 11, combat: { version: 3, ships: {}, events: [] } },
    };
    const result = migrateSave(save, 11);

    expect(result.ok).toBe(true);
    expect(result.ok && result.applied).toEqual([11]);
    expect(result.ok && result.save).toEqual({
      formatVersion: 12,
      state: { stateVersion: 12, combat: { version: 3, ships: {}, events: [], projectiles: [] } },
    });
    // The stored save is never changed by the migration (Technical Specification 11.4).
    expect(save.state.combat).toEqual({ version: 3, ships: {}, events: [] });
  });

  it('turns the format-11 golden save into the format-12 golden state, field for field [TECH-11.4, V02-AC-13]', () => {
    const read = (name: string) => JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'saves', name), 'utf8'),
    ) as Record<string, unknown>;
    const before = read('format-11.json');
    const after = read('format-12.json');
    const result = migrateSave(before, 11);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save['state']).toEqual(after['state']);
    expect(result.save['formatVersion']).toBe(after['formatVersion']);
  });

  it('is a no-op for a save already at the current version [TECH-11.4]', () => {
    const save = { formatVersion: SAVE_FORMAT_VERSION, state: {} };
    const result = migrateSave(save, SAVE_FORMAT_VERSION);

    expect(result.ok).toBe(true);
    expect(result.ok && result.applied).toEqual([]);
    expect(result.ok && result.save).toBe(save);
  });

  it('applies steps in order and records each one [TECH-11.4]', () => {
    const seen: string[] = [];
    const migrations = [
      step(1, (save) => {
        seen.push('one');
        save['one'] = true;
      }),
      step(2, (save) => {
        seen.push('two');
        save['two'] = true;
      }),
    ];

    const result = migrateSave({ formatVersion: 1 }, 1, migrations, 3);

    expect(result.ok).toBe(true);
    expect(seen).toEqual(['one', 'two']);
    expect(result.ok && result.applied).toEqual([1, 2]);
    expect(result.ok && result.save).toEqual({ formatVersion: 3, one: true, two: true });
  });

  it('gives each migration a private copy [TECH-11.4]', () => {
    const original = { formatVersion: 1, state: { nested: { value: 1 } } };
    const migrations = [
      step(1, (save) => {
        (save['state'] as { nested: { value: number } }).nested.value = 99;
      }),
    ];

    const result = migrateSave(original, 1, migrations, 2);

    expect(result.ok).toBe(true);
    expect(original.state.nested.value).toBe(1);
    expect(result.ok && (result.save['state'] as { nested: { value: number } }).nested.value).toBe(
      99,
    );
  });

  it('refuses a registry with a gap rather than skipping a version [TECH-11.4]', () => {
    const result = migrateSave({ formatVersion: 1 }, 1, [step(2, () => undefined)], 3);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('noMigrationPath');
  });

  it('refuses a registry whose steps do not chain [TECH-11.4]', () => {
    const skipping: SaveMigration = {
      from: 1,
      to: 3,
      describe: 'skips a version',
      migrate: (save) => save,
    };

    const result = migrateSave({ formatVersion: 1 }, 1, [skipping], 3);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('nonSequentialMigration');
  });

  it('refuses two migrations from the same version [TECH-11.4]', () => {
    const result = migrateSave(
      { formatVersion: 1 },
      1,
      [step(1, () => undefined), step(1, () => undefined)],
      2,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('duplicateMigration');
  });

  it('refuses a save from a newer format [TECH-11.4]', () => {
    const result = migrateSave({ formatVersion: 4 }, 4, [], 2);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('forwardVersion');
  });

  it('refuses a migration that does not return a document [TECH-11.4]', () => {
    const broken: SaveMigration = {
      from: 1,
      to: 2,
      describe: 'returns nothing usable',
      migrate: () => null as unknown as Record<string, unknown>,
    };

    const result = migrateSave({ formatVersion: 1 }, 1, [broken], 2);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('migrationProducedNonObject');
  });
});
