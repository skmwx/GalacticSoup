import { describe, expect, it } from 'vitest';

import { EMPTY_PAYLOAD, PROTOCOL_VERSION } from '@protocol';

/**
 * The engine must import and run with no DOM, no browser storage and no
 * rendering environment present (Technical Specification 2, 4.1, 16). This test
 * runs in the plain Node environment, so a stray browser dependency fails it at
 * import time rather than in a browser later.
 */
describe('headless engine', () => {
  it('has no DOM or browser storage available to it [TECH-2]', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
    expect(typeof indexedDB).toBe('undefined');
  });

  it('imports and answers a request in that environment [TECH-2, TECH-4.1]', async () => {
    const { createEngineHost } = await import('@engine');
    const { shippedContent } = await import('../../support/content.ts');

    const response = await createEngineHost({ content: shippedContent() }).handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'headless-1',
      type: 'system.health',
      payload: EMPTY_PAYLOAD,
    });

    expect(response.ok).toBe(true);
  });
});
