import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import {
  campaignStateHash,
  createEngineHost,
  DEFAULT_SAVE_RETENTION,
  loadSave,
  type SaveEnvelope,
} from '@engine';
import type { ClientGateway } from '@gateway';
import { createChannelGateway, createDirectGateway } from '@gateway/direct';
import type { AssetsData, EncounterData, RequestPayload, RequestType } from '@protocol';
import { canonicalJson } from '@shared';

import { shippedContent } from '../support/content.ts';
import {
  GOLDEN_STATES,
  recordGoldenCampaign,
  type GoldenRun,
  type GoldenState,
} from '../support/golden/campaign.ts';
import {
  goldenFixturesExist,
  readGoldenLog,
  readGoldenSaves,
  renderLog,
  writeGoldenRun,
} from '../support/golden/fixtures.ts';
import { recordedCheckpoints, replayLog } from '../support/golden/replay.ts';
import type { ReplayLog, ReplayLogCheckpoint } from '../support/golden/recording.ts';
import { protocolSchemas, saveSchemas } from '../support/schemas.ts';

/**
 * The golden campaign: recorded, replayed and reloaded
 * (MVP Implementation Plan phase 20; Technical Specification 9.5, 11.2, 11.4,
 * 15.1, 17).
 *
 * `npm run golden:record` runs this file with `GOLDEN_RECORD=1`, which writes
 * the recording instead of comparing with it.
 */

const content = shippedContent();
const recording = process.env['GOLDEN_RECORD'] === '1';

const disposers: (() => void)[] = [];

afterAll(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

function directGateway(saves = createMemorySaveStore()): ClientGateway {
  const gateway = createDirectGateway({ host: createEngineHost({ content, saves }), defaultTimeoutMs: 20_000 });
  disposers.push(() => gateway.dispose());
  return gateway;
}

function channelGateway(): ClientGateway {
  const channel = createChannelGateway({
    host: createEngineHost({ content, saves: createMemorySaveStore() }),
    defaultTimeoutMs: 20_000,
  });
  disposers.push(() => channel.close());
  return channel.gateway;
}

/**
 * Every projection the interface can ask for at this point, keyed by request.
 * An answer is kept whole, refusals included, so two campaigns in the same
 * state must agree on what they refuse as well as on what they show.
 */
async function projections(gateway: ClientGateway): Promise<Record<string, unknown>> {
  const answers: Record<string, unknown> = {};
  const ask = async (type: string, payload: unknown = {}): Promise<unknown> => {
    const response = await gateway.request(type as RequestType, payload as RequestPayload<RequestType>);
    const { requestId: _requestId, ...answer } = response;
    void _requestId;
    answers[`${type} ${JSON.stringify(payload)}`] = answer;
    return response.ok ? response.data : null;
  };

  for (const type of [
    'campaign.session', 'campaign.frame', 'wallet.get', 'navigation.site', 'navigation.destinations',
    'combat.state', 'loss.report', 'onboarding.state', 'notifications.list', 'fitting.draft',
  ]) await ask(type);

  const stationId = content.rules.economy.startingStationId;
  for (const type of ['inventory.hangar', 'station.services', 'market.listings']) await ask(type, { stationId });

  const assets = (await ask('assets.list')) as AssetsData;
  for (const ship of assets.ships) {
    for (const type of [
      'ship.get', 'ship.undockValidity', 'inventory.cargo', 'repair.preview', 'resupply.preview', 'insurance.preview',
    ]) await ask(type, { shipId: ship.id });
  }
  const encounter = (await ask('encounter.state')) as EncounterData;
  for (const wreck of encounter.wrecks) await ask('loot.contents', { wreckId: wreck.wreckId });
  return answers;
}

/** A gateway whose store already holds one save, as a browser that was closed would. */
async function gatewayHolding(envelope: SaveEnvelope): Promise<ClientGateway> {
  const saves = createMemorySaveStore();
  await saves.write({ envelope, retention: DEFAULT_SAVE_RETENTION });
  return directGateway(saves);
}

let run: GoldenRun;

beforeAll(async () => {
  run = await recordGoldenCampaign(content);
  if (recording) writeGoldenRun(run);
}, 600_000);

describe('the golden campaign', () => {
  it('reaches every representative state on the way to a completed progression [MVP-AC-07, MVP-AC-08, MVP-AC-09, TECH-15.1]', () => {
    const labels = run.log.checkpoints.map((checkpoint) => checkpoint.label).filter((label) => label !== null);
    expect(labels).toEqual([...GOLDEN_STATES, 'end']);
    expect(run.career.finished).toBe(true);

    const state = (name: GoldenState): Record<string, any> => run.saves[name].state;
    expect(state('station')['fitting']).not.toBeNull();
    expect(state('station')['assets'].location.kind).toBe('station');
    expect(state('travel')['assets'].location.kind).toBe('warp');
    expect(state('combat')['encounter'].active.status).toBe('active');
    expect(Object.keys(state('combat')['combat'].ships).length).toBeGreaterThan(1);
    expect(state('post-destruction')['recovery'].losses).toBe(1);
    expect(state('post-destruction')['assets'].location.kind).toBe('station');
    expect(state('wreck')['encounter'].active.status).toBe('completed');
    expect(Object.keys(state('wreck')['encounter'].wrecks).length).toBeGreaterThan(0);
    const completions = state('completed-progression')['encounter'].completions as Record<string, number>;
    expect(Object.keys(completions).sort()).toEqual(content.encounters().map((encounter) => encounter.id).sort());
    expect(Object.values(completions).every((count) => count >= 1)).toBe(true);
  });

  it.skipIf(recording)('is the campaign recorded in the fixtures, byte for byte [TECH-9.5, TECH-11.2, TECH-17]', () => {
    expect(goldenFixturesExist(), 'No golden campaign is recorded; run npm run golden:record.').toBe(true);
    const recorded = readGoldenLog();
    expect(
      { contentHash: recorded.contentHash, protocolVersion: recorded.protocolVersion, saveFormatVersion: recorded.saveFormatVersion },
      'The golden campaign was recorded against other content or contracts; run npm run golden:record.',
    ).toEqual({
      contentHash: run.log.contentHash,
      protocolVersion: run.log.protocolVersion,
      saveFormatVersion: run.log.saveFormatVersion,
    });
    expect(renderLog(run.log)).toBe(renderLog(recorded));

    const saves = readGoldenSaves();
    for (const state of GOLDEN_STATES) {
      expect(canonicalJson(run.saves[state] as unknown as Record<string, unknown>), state).toBe(
        canonicalJson(saves[state] as unknown as Record<string, unknown>),
      );
    }
  });
});

describe.skipIf(recording)('replaying the golden campaign', () => {
  let log: ReplayLog;
  /** What a campaign that was never closed shows at each golden state. */
  const uninterrupted = new Map<string, Record<string, unknown>>();

  beforeAll(() => {
    log = readGoldenLog();
  });

  it('reaches every recorded checkpoint through the in-process gateway [TECH-9.5, TECH-15.1, MVP-AC-01]', async () => {
    const gateway = directGateway();
    const passed = await replayLog(gateway, log, {
      start: 'create',
      onCheckpoint: async (checkpoint: ReplayLogCheckpoint) => {
        if (checkpoint.label !== null && checkpoint.label !== 'end') {
          uninterrupted.set(checkpoint.label, await projections(gateway));
        }
      },
    });
    expect(passed).toEqual(recordedCheckpoints(log));
    expect(passed.at(-1)?.label).toBe('end');
  }, 600_000);

  it('reaches every recorded checkpoint through the worker dispatcher [TECH-9.5, TECH-15.1, TECH-17]', async () => {
    const passed = await replayLog(channelGateway(), log, { start: 'create' });
    expect(passed).toEqual(recordedCheckpoints(log));
  }, 600_000);

  describe.each(GOLDEN_STATES.map((state, index) => ({ state, index })))('reloading the $state save', ({ state, index }) => {
    const schemas = saveSchemas();
    const protocol = protocolSchemas();

    it('opens through the load pipeline as the state that was recorded [TECH-11.2, TECH-11.4, TECH-15.3, MVP-AC-01]', () => {
      const envelope = readGoldenSaves()[state];
      expect(schemas.envelope(envelope)).toBeNull();
      expect(schemas.state(envelope.state)).toBeNull();

      const loaded = loadSave(JSON.parse(JSON.stringify(envelope)) as unknown, { content });
      if (!loaded.ok) throw new Error(`The ${state} save did not load: ${JSON.stringify(loaded.error)}`);
      expect(loaded.migrated).toEqual([]);
      expect(loaded.contentChanged).toBe(false);
      const checkpoint = log.checkpoints.find((entry) => entry.label === state);
      expect(campaignStateHash(loaded.state)).toBe(checkpoint?.stateHash);
      expect(loaded.state.revision).toBe(checkpoint?.revision);
    });

    it('rebuilds every projection the uninterrupted campaign showed there [TECH-7.3, TECH-11.4, TECH-17]', async () => {
      const gateway = await gatewayHolding(readGoldenSaves()[state]);
      const resumed = await gateway.request('campaign.resume', {});
      expect(resumed.ok).toBe(true);

      const rebuilt = await projections(gateway);
      const expected = uninterrupted.get(state);
      expect(expected, 'the uninterrupted replay must run first').toBeDefined();
      expect(rebuilt).toEqual(expected);

      // Each answer is also the published contract of its request.
      let checked = 0;
      for (const [key, answer] of Object.entries(rebuilt)) {
        const type = key.slice(0, key.indexOf(' '));
        const validate = protocol.dataOf(type);
        const response = answer as { ok: boolean; data?: unknown };
        if (validate === null || !response.ok) continue;
        expect(validate(response.data), key).toBeNull();
        checked += 1;
      }
      expect(checked).toBeGreaterThan(15);
    }, 120_000);

    it('continues to the next golden state exactly as the uninterrupted campaign did [TECH-9.5, TECH-11.4, FUNC-4.3]', async () => {
      const here = log.checkpoints.find((entry) => entry.label === state);
      const nextLabel = GOLDEN_STATES[index + 1] ?? 'end';
      const next = log.checkpoints.find((entry) => entry.label === nextLabel);
      if (here === undefined || next === undefined) throw new Error('The log lacks a golden checkpoint.');

      const gateway = await gatewayHolding(readGoldenSaves()[state]);
      const passed = await replayLog(gateway, log, {
        start: 'resume',
        fromStep: here.afterStep,
        untilStep: next.afterStep,
      });
      expect(passed).toEqual(recordedCheckpoints(log, here.afterStep, next.afterStep));
      expect(passed.at(-1)?.stateHash).toBe(next.stateHash);
    }, 600_000);
  });
});
