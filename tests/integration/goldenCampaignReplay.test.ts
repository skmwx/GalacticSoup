import { beforeAll, describe, expect, it } from 'vitest';

import { campaignStateHash, loadSave } from '@engine';

import { shippedContent } from '../support/content.ts';
import { GOLDEN_STATES } from '../support/golden/campaign.ts';
import { readGoldenLog, readGoldenSaves } from '../support/golden/fixtures.ts';
import { goldenGateways } from '../support/golden/gateways.ts';
import { recordedCheckpoints, replayLog } from '../support/golden/replay.ts';
import type { ReplayLog, ReplayLogCheckpoint } from '../support/golden/recording.ts';
import { protocolSchemas, saveSchemas } from '../support/schemas.ts';

/**
 * The golden campaign replayed through the in-process gateway, and each
 * golden save reloaded and compared with what the uninterrupted replay showed
 * there (see `goldenCampaign.test.ts`; Technical Specification 9.5, 11.2,
 * 11.4, 17). The reload cases need the replay's projections, so they stay in
 * this file with it.
 */

const content = shippedContent();
const recording = process.env['GOLDEN_RECORD'] === '1';
const { directGateway, gatewayHolding, projections } = goldenGateways(content);

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

  describe.each(GOLDEN_STATES.map((state) => ({ state })))('reloading the $state save', ({ state }) => {
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
  });
});
