import { describe, expect, it } from 'vitest';

import { shippedContent } from '../support/content.ts';
import { GOLDEN_STATES } from '../support/golden/campaign.ts';
import { readGoldenLog, readGoldenSaves } from '../support/golden/fixtures.ts';
import { goldenGateways } from '../support/golden/gateways.ts';
import { recordedCheckpoints, replayLog } from '../support/golden/replay.ts';

/**
 * Each golden save resumed and played on to the next golden state, which it
 * must reach exactly as the uninterrupted campaign did (see
 * `goldenCampaign.test.ts`; Technical Specification 9.5, 11.4).
 */

const content = shippedContent();
const recording = process.env['GOLDEN_RECORD'] === '1';
const { gatewayHolding } = goldenGateways(content);

describe.skipIf(recording)('replaying the golden campaign', () => {
  describe.each(GOLDEN_STATES.map((state, index) => ({ state, index })))('reloading the $state save', ({ state, index }) => {
    it('continues to the next golden state exactly as the uninterrupted campaign did [TECH-9.5, TECH-11.4, FUNC-4.3]', async () => {
      const log = readGoldenLog();
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
