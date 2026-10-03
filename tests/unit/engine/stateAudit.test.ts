import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_STATE_VERSION,
  campaignDefinitionReferences,
  campaignStateHash,
  createCampaign,
  loadSave,
  readCampaignState,
  SAVE_FORMAT_VERSION,
  validateCampaign,
  type CampaignState,
  type SaveEnvelope,
  type SaveMigration,
} from '@engine';
import { INSTALLED_BOUNDARY_RESOLVERS } from '@engine/application';
import { PROTOCOL_VERSION } from '@protocol';
import { isDefinitionId } from '@shared';

import { shippedContent } from '../../support/content.ts';
import { GOLDEN_STATES } from '../../support/golden/campaign.ts';
import { readGoldenSaves } from '../../support/golden/fixtures.ts';
import { auditSchema } from '../../support/schemaAudit.ts';
import { readSchema, saveSchemas } from '../../support/schemas.ts';

/**
 * The audit of authoritative state against its contracts
 * (MVP Implementation Plan phase 20; Technical Specification 8.1, 11.2, 11.4,
 * 14, 15.3).
 *
 * Every field the campaign has grown since the first snapshot is held to four
 * things here: the published schema describes it and refuses anything else,
 * the engine's own reader is at least as strict as that schema, every
 * definition it names is one the loader checks, and every boundary it queues
 * is one the engine resolves. The subjects are the golden saves, which
 * between them hold every kind of state the MVP persists.
 */

const content = shippedContent();
const schemas = saveSchemas();
const goldens = readGoldenSaves();

function stateOf(envelope: SaveEnvelope): Record<string, unknown> {
  return JSON.parse(JSON.stringify(envelope.state)) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

type Container = Record<string, unknown> | unknown[];

const LOCALIZATION_PARAMETER = /^retype state\/notifications\/entries\/\d+\/params\//;

interface Mutation {
  readonly description: string;
  apply(): void;
  undo(): void;
}

/**
 * A path with its instance-specific parts removed, so that the hundredth
 * notification is recognised as the same kind of thing as the first.
 */
function signatureOf(segments: readonly string[]): string {
  return segments
    .map((segment) => (/^\d+$/.test(segment) || /-e\d+$/.test(segment) || /^[a-z]+:\d+$/.test(segment) ||
      isDefinitionId(segment) ? '*' : segment))
    .join('/');
}

/** Every single-step corruption of a state: a field removed, a field added, a value of the wrong type. */
function mutationsOf(root: Record<string, unknown>, perSignature: number): Mutation[] {
  const mutations: Mutation[] = [];
  const seen = new Map<string, number>();
  const admit = (kind: string, segments: readonly string[]): boolean => {
    const key = `${kind} ${signatureOf(segments)}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count < perSignature;
  };

  const walk = (node: unknown, segments: string[]): void => {
    if (typeof node !== 'object' || node === null) return;
    const container = node as Container;
    const here = segments.join('/');

    if (!Array.isArray(container)) {
      if (admit('add', segments)) {
        mutations.push({
          description: `add an unknown field to ${here}`,
          apply: () => { container['zzUnknown'] = 0; },
          undo: () => { delete container['zzUnknown']; },
        });
      }
      for (const key of Object.keys(container)) {
        const original = container[key];
        if (admit('remove', [...segments, key])) {
          mutations.push({
            description: `remove ${here}/${key}`,
            apply: () => { delete container[key]; },
            // Deleting and re-adding would move the key to the end; canonical
            // readers must not care, and nothing here depends on key order.
            undo: () => { container[key] = original; },
          });
        }
      }
    }

    const entries: [string, unknown][] = Array.isArray(container)
      ? container.map((entry, index) => [String(index), entry])
      : Object.entries(container);
    for (const [key, value] of entries) {
      const next = [...segments, key];
      if (typeof value === 'object' && value !== null) {
        walk(value, next);
        continue;
      }
      if (value === null || !admit('retype', next)) continue;
      const wrong: unknown = typeof value === 'string' ? 7 : 'wrong';
      const slot = container as Record<string, unknown>;
      mutations.push({
        description: `retype ${next.join('/')} from ${typeof value}`,
        apply: () => { slot[key] = wrong; },
        undo: () => { slot[key] = value; },
      });
    }
  };

  walk(root, ['state']);
  return mutations;
}

/* -------------------------------------------------------------------------- */

describe('the published save contracts are closed', () => {
  it('describes every field of the authoritative state, with none optional [TECH-11.2, TECH-14, TECH-17]', () => {
    expect(auditSchema(readSchema('save', 'campaign-state.schema.json'))).toEqual([]);
  });

  it('describes every field of the save envelope, with none optional [TECH-11.2, TECH-14]', () => {
    // The payload is described by the state schema the envelope refers to.
    expect(auditSchema(readSchema('save', 'save-envelope.schema.json'))).toEqual([]);
  });

  it('pins the versions the schemas describe to the versions the engine writes [TECH-11.2, TECH-18]', () => {
    const envelope = readSchema('save', 'save-envelope.schema.json') as {
      properties: { formatVersion: { const: number } };
    };
    const state = readSchema('save', 'campaign-state.schema.json') as {
      properties: { stateVersion: { const: number } };
    };
    expect(envelope.properties.formatVersion.const).toBe(SAVE_FORMAT_VERSION);
    expect(state.properties.stateVersion.const).toBe(CAMPAIGN_STATE_VERSION);
  });
});

describe.each(GOLDEN_STATES)('the %s state against its contracts', (name) => {
  const envelope = goldens[name];

  it('is accepted by the schema, the reader and the invariants as written [TECH-11.2, TECH-11.4, TECH-15.3]', () => {
    const state = stateOf(envelope);
    expect(schemas.envelope(envelope)).toBeNull();
    expect(schemas.state(state)).toBeNull();
    expect(readCampaignState(state).ok).toBe(true);
    expect(validateCampaign(state as unknown as CampaignState, content)).toEqual([]);
  });

  it('is refused by the reader wherever the schema refuses it [TECH-11.2, TECH-11.4, TECH-14]', () => {
    const state = stateOf(envelope);
    const mutations = mutationsOf(state, 2);
    expect(mutations.length).toBeGreaterThan(100);

    const lenient: string[] = [];
    const untyped: string[] = [];
    let refusedBySchema = 0;
    for (const mutation of mutations) {
      mutation.apply();
      const schemaRefuses = schemas.state(state) !== null;
      const readerRefuses = !readCampaignState(state).ok;
      mutation.undo();

      if (schemaRefuses) refusedBySchema += 1;
      // The engine never trusts less than the contract promises.
      if (schemaRefuses && !readerRefuses) lenient.push(mutation.description);
      // A value of the wrong type is refused by both, wherever it sits. The
      // one value with more than one type is a notification's localization
      // parameter, which is declared as text, a number or a flag.
      if (
        mutation.description.startsWith('retype') &&
        !LOCALIZATION_PARAMETER.test(mutation.description) &&
        !(schemaRefuses && readerRefuses)
      ) {
        untyped.push(mutation.description);
      }
    }

    expect(lenient).toEqual([]);
    expect(untyped).toEqual([]);
    expect(refusedBySchema).toBeGreaterThan(mutations.length / 2);
    // Every mutation was undone: the state is the golden one again.
    expect(schemas.state(state)).toBeNull();
    expect(readCampaignState(state).ok).toBe(true);
  }, 120_000);

  it('names no definition the loader does not check against installed content [TECH-5.1, TECH-11.4]', () => {
    const state = envelope.state as unknown as CampaignState;
    const checked = new Set<string>(campaignDefinitionReferences(state));
    const named = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        if (isDefinitionId(value) && resolves(value)) named.add(value);
      } else if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, entry] of Object.entries(value)) {
          collect(key);
          collect(entry);
        }
      }
    };
    collect(envelope.state);

    expect(named.size).toBeGreaterThan(5);
    expect([...named].filter((id) => !checked.has(id)).sort()).toEqual([]);
  });

  it('queues only boundaries the engine resolves [TECH-9.2, TECH-15.3]', () => {
    const state = envelope.state as unknown as CampaignState;
    const kinds = new Set(state.scheduler.entries.map((entry) => entry.kind));
    expect([...kinds].filter((kind) => INSTALLED_BOUNDARY_RESOLVERS[kind] === undefined)).toEqual([]);
  });
});

describe('what the golden saves cover', () => {
  it('holds every top-level part of the campaign in a non-empty form somewhere [TECH-8.1, TECH-11.2]', () => {
    const fresh = createCampaign({ displayName: 'Audit', seed: '0'.repeat(31) + '1', createdAtRealMs: 0, initialRate: 1 }, content);
    const states = GOLDEN_STATES.map((name) => goldens[name].state as unknown as CampaignState);

    // A part is exercised when at least one golden state holds it in a form a
    // new campaign does not.
    const unexercised = Object.keys(fresh)
      .filter((field) => !['stateVersion', 'campaignId', 'displayName', 'seed', 'createdAtRealMs'].includes(field))
      .filter((field) => states.every((state) =>
        JSON.stringify(state[field as keyof CampaignState]) === JSON.stringify(fresh[field as keyof CampaignState])));
    expect(unexercised).toEqual([]);
  });

  it('holds every scheduled boundary kind the engine resolves [TECH-9.2, TECH-11.4]', () => {
    const held = new Set<string>();
    for (const name of GOLDEN_STATES) {
      for (const entry of (goldens[name].state as unknown as CampaignState).scheduler.entries) held.add(entry.kind);
    }
    // A lock, a reload, an active-module cycle and the two short preparation
    // timers are in flight for seconds at a time. Their snapshots are pinned
    // by the combat, navigation and loss persistence tests instead.
    const transient = [
      'combat.lockComplete', 'combat.moduleCycle', 'combat.reloadComplete',
      'navigation.dockComplete', 'navigation.warpPrepared',
    ];
    expect(Object.keys(INSTALLED_BOUNDARY_RESOLVERS).filter((kind) => !held.has(kind)).sort()).toEqual(transient);
  });

  it('were written by the versions this build closes [TECH-11.2, TECH-18]', () => {
    for (const name of GOLDEN_STATES) {
      expect(goldens[name].formatVersion).toBe(SAVE_FORMAT_VERSION);
      expect(goldens[name].protocolVersion).toBe(PROTOCOL_VERSION);
      expect(goldens[name].contentHash).toBe(content.contentHash);
    }
  });
});

describe('the migration runner on a real save', () => {
  /**
   * No save format has been released, so the shipped registry is empty (MVP
   * plan section 2, rule 7). The runner and the load pipeline around it are
   * held here to a fixture registry and a save as large as the MVP produces:
   * an "older" document in which one part of the state has another name.
   */
  const older = (envelope: SaveEnvelope): Record<string, unknown> => {
    const document = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
    const state = document['state'] as Record<string, unknown>;
    state['guidance'] = state['onboarding'];
    delete state['onboarding'];
    state['stateVersion'] = SAVE_FORMAT_VERSION - 1;
    document['formatVersion'] = SAVE_FORMAT_VERSION - 1;
    return document;
  };
  const registry: readonly SaveMigration[] = [{
    from: SAVE_FORMAT_VERSION - 1,
    to: SAVE_FORMAT_VERSION,
    describe: 'Fixture: guidance progress is renamed to onboarding.',
    migrate(save) {
      const state = save['state'] as Record<string, unknown>;
      state['onboarding'] = state['guidance'];
      delete state['guidance'];
      state['stateVersion'] = CAMPAIGN_STATE_VERSION;
      return save;
    },
  }];

  it.each(GOLDEN_STATES)('migrates the %s save through a fixture registry to the state it holds [TECH-11.4, TECH-18]', (name) => {
    const stored = older(goldens[name]);
    const before = JSON.stringify(stored);

    const loaded = loadSave(stored, { content, migrations: registry });

    if (!loaded.ok) throw new Error(`The migrated save did not load: ${JSON.stringify(loaded.error)}`);
    expect(loaded.migrated).toEqual([SAVE_FORMAT_VERSION - 1]);
    expect(campaignStateHash(loaded.state)).toBe(
      campaignStateHash(goldens[name].state as unknown as CampaignState),
    );
    // A migration works on a copy: the stored document is as it was found.
    expect(JSON.stringify(stored)).toBe(before);
  });

  it('refuses the same older save when the registry has no path for it [TECH-11.4]', () => {
    const stored = older(goldens.station);
    const before = JSON.stringify(stored);

    const loaded = loadSave(stored, { content });

    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.error.messageKey).toBe('error.saveLoad.migrationFailed');
    expect(JSON.stringify(stored)).toBe(before);
  });
});

/** Whether an id names something the installed content defines. */
function resolves(id: string): boolean {
  return (
    content.tradeable(id) !== undefined ||
    content.hull(id as never) !== undefined ||
    content.system(id as never) !== undefined ||
    content.site(id as never) !== undefined ||
    content.station(id as never) !== undefined ||
    content.npcProfile(id as never) !== undefined ||
    content.lootTable(id as never) !== undefined ||
    content.encounter(id as never) !== undefined ||
    content.guidanceStep(id as never) !== undefined ||
    content.notification(id as never) !== undefined
  );
}
