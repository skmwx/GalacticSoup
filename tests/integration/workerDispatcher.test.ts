import { describe, expect, it } from 'vitest';

import { createMemorySaveStore } from '@adapters/persistence';
import { attachEngineHost, type MessageEventLike, type MessageTargetLike } from '@adapters/worker';
import { createEngineHost, type EngineHost } from '@engine';
import { EMPTY_PAYLOAD, PROTOCOL_VERSION, type EngineResponse } from '@protocol';

import { shippedContent } from '../support/content.ts';

/**
 * The dispatcher must answer every message and must never let an exception
 * escape the engine host into the transport (Technical Specification 4.2, 5.4).
 */

interface FakeTarget extends MessageTargetLike {
  readonly sent: unknown[];
  deliver(message: unknown): void;
  failNextPost(): void;
}

function createFakeTarget(): FakeTarget {
  const listeners = new Set<(event: MessageEventLike) => void>();
  const sent: unknown[] = [];
  let failNext = false;

  return {
    sent,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    postMessage(message) {
      if (failNext) {
        failNext = false;
        throw new Error('The value could not be cloned.');
      }
      sent.push(message);
    },
    deliver(message) {
      for (const listener of [...listeners]) {
        listener({ data: message });
      }
    },
    failNextPost() {
      failNext = true;
    },
  };
}

const healthRequest = {
  protocolVersion: PROTOCOL_VERSION,
  requestId: 'dispatch-1',
  type: 'system.health',
  payload: EMPTY_PAYLOAD,
};

async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('worker dispatcher', () => {
  it('answers a valid request on the same target [TECH-4.2]', async () => {
    const target = createFakeTarget();
    attachEngineHost(target, createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() }));

    target.deliver(healthRequest);
    await settle();

    expect(target.sent).toHaveLength(1);
    expect((target.sent[0] as EngineResponse<unknown>).ok).toBe(true);
  });

  it('answers a malformed message instead of staying silent [TECH-4.2, TECH-5.4]', async () => {
    const target = createFakeTarget();
    attachEngineHost(target, createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() }));

    target.deliver('nonsense');
    await settle();

    const response = target.sent[0] as EngineResponse<unknown>;
    expect(response.ok).toBe(false);
    expect(response.requestId).toBe('');
  });

  it('contains a host failure as an internal error [TECH-5.4]', async () => {
    const failingHost: EngineHost = {
      engineVersion: '0.0.0',
      protocolVersion: PROTOCOL_VERSION,
      handle: () => Promise.reject(new Error('engine exploded')),
    };
    const target = createFakeTarget();
    attachEngineHost(target, failingHost);

    target.deliver(healthRequest);
    await settle();

    const response = target.sent[0] as EngineResponse<unknown>;
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('INTERNAL_ERROR');
      expect(response.requestId).toBe('dispatch-1');
    }
  });

  it('reports a response that the transport refuses to carry [TECH-4.2]', async () => {
    const target = createFakeTarget();
    attachEngineHost(target, createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() }));
    target.failNextPost();

    target.deliver(healthRequest);
    await settle();

    const response = target.sent[0] as EngineResponse<unknown>;
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('INTERNAL_ERROR');
      expect(response.error.params).toMatchObject({ stage: 'postMessage' });
    }
  });

  it('stops answering after it is detached [TECH-4.2]', async () => {
    const target = createFakeTarget();
    const detach = attachEngineHost(target, createEngineHost({ content: shippedContent(), saves: createMemorySaveStore() }));

    detach();
    target.deliver(healthRequest);
    await settle();

    expect(target.sent).toHaveLength(0);
  });
});
