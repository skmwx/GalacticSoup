import { beforeAll, describe, expect, it } from 'vitest';

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

/**
 * The golden campaign: recorded, replayed and reloaded
 * (MVP Implementation Plan phase 20; Technical Specification 9.5, 11.2, 11.4,
 * 15.1, 17).
 *
 * This file records the campaign and compares it with the fixtures.
 * Replaying and reloading it are spread over `goldenCampaignReplay`,
 * `goldenCampaignWorker` and `goldenCampaignContinue`, so that they proceed
 * side by side (Test Suite Optimization Plan phase 1).
 *
 * `npm run golden:record` runs this file with `GOLDEN_RECORD=1`, which writes
 * the recording instead of comparing with it.
 */

const content = shippedContent();
const recording = process.env['GOLDEN_RECORD'] === '1';

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
    // The career flies the three MVP sites; the later ladder is not part of it.
    expect(Object.keys(completions).sort()).toEqual([
      'encounter.borrell.pirate-base',
      'encounter.borrell.pirate-patrol',
      'encounter.borrell.pirate-scout',
    ]);
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
