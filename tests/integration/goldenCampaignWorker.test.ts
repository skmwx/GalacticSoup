import { describe, expect, it } from 'vitest';

import { shippedContent } from '../support/content.ts';
import { readGoldenLog } from '../support/golden/fixtures.ts';
import { goldenGateways } from '../support/golden/gateways.ts';
import { recordedCheckpoints, replayLog } from '../support/golden/replay.ts';

/**
 * The golden campaign replayed through the worker dispatcher (see
 * `goldenCampaign.test.ts`; Technical Specification 9.5, 15.1, 17).
 */

const content = shippedContent();
const recording = process.env['GOLDEN_RECORD'] === '1';
const { channelGateway } = goldenGateways(content);

describe.skipIf(recording)('replaying the golden campaign', () => {
  it('reaches every recorded checkpoint through the worker dispatcher [TECH-9.5, TECH-15.1, TECH-17]', async () => {
    const log = readGoldenLog();
    const passed = await replayLog(channelGateway(), log, { start: 'create' });
    expect(passed).toEqual(recordedCheckpoints(log));
  }, 600_000);
});
