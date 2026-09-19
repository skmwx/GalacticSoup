import { describe, expect, it } from 'vitest';

import { createEngineHost, ENGINE_VERSION } from '@engine';
import {
  EMPTY_PAYLOAD,
  NO_CAMPAIGN_REVISION,
  PROTOCOL_VERSION,
  REQUEST_TYPES,
  UNKNOWN_REQUEST_ID,
  isTransportValue,
  type CapabilitiesData,
  type HealthData,
} from '@protocol';

function request(type: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-1',
    type,
    payload: EMPTY_PAYLOAD,
    ...overrides,
  };
}

describe('engine host', () => {
  it('reports its health without a campaign [TECH-7.1]', async () => {
    const response = await createEngineHost().handle(request('system.health'));

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }
    expect(response.requestId).toBe('req-1');
    expect(response.revision).toBe(NO_CAMPAIGN_REVISION);
    expect(response.data as HealthData).toEqual({
      status: 'ready',
      engineVersion: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it('reports the request types it accepts [TECH-7.1]', async () => {
    const response = await createEngineHost({ engineVersion: '9.9.9' }).handle(
      request('system.capabilities'),
    );

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }
    expect(response.data as CapabilitiesData).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      engineVersion: '9.9.9',
      requestTypes: [...REQUEST_TYPES],
    });
  });

  it('answers every request with a transport-safe response [TECH-4.2]', async () => {
    const response = await createEngineHost().handle(request('system.capabilities'));

    expect(isTransportValue(response)).toBe(true);
  });

  it('returns a stable error instead of throwing on malformed input [TECH-5.4]', async () => {
    const host = createEngineHost();
    const malformed: unknown[] = [
      undefined,
      null,
      'text',
      42,
      [],
      {},
      { requestId: 'req-2' },
      request('campaign.create'),
      request('system.health', { protocolVersion: 2 }),
      request('system.health', { payload: { verbose: true } }),
    ];

    for (const message of malformed) {
      const response = await host.handle(message);

      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.code).toBe('INVALID_REQUEST');
        expect(response.error.messageKey.startsWith('error.invalidRequest')).toBe(true);
        expect(isTransportValue(response)).toBe(true);
      }
    }
  });

  it('correlates a failure that carries no request id with the unknown id [TECH-7.1]', async () => {
    const response = await createEngineHost().handle('nonsense');

    expect(response.requestId).toBe(UNKNOWN_REQUEST_ID);
  });

  it('never resolves a state-changing revision above zero before campaigns exist [TECH-7.1]', async () => {
    const response = await createEngineHost().handle(request('system.health'));

    expect(response.ok && response.revision).toBe(NO_CAMPAIGN_REVISION);
  });

  it('publishes a semantic version string [TECH-18]', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
