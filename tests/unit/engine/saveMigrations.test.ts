import { describe, expect, it } from 'vitest';

import { migrateSave, SAVE_FORMAT_VERSION, SAVE_MIGRATIONS, type SaveMigration } from '@engine';

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
  it('ships no migration before the first released format change [TECH-11.4]', () => {
    expect(SAVE_MIGRATIONS).toEqual([]);
    expect(SAVE_FORMAT_VERSION).toBe(1);
  });

  it('is a no-op for a save already at the current version [TECH-11.4]', () => {
    const save = { formatVersion: 1, state: {} };
    const result = migrateSave(save, 1);

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
