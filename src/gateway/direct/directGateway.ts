import { loadBundledContent } from '@adapters/content';
import { createMemorySaveStore } from '@adapters/persistence';
import { attachEngineHost, type MessageTargetLike } from '@adapters/worker';
import { createEngineHost, type EngineHost } from '@engine';
import { createPortGateway, type ClientGateway, type MessagePortLike } from '@gateway';

/**
 * In-process gateway for tests (Technical Specification 15.1, 16).
 *
 * It hosts the same engine through the same protocol and the same dispatcher as
 * the worker gateway, without a worker or a DOM. Messages are cloned and
 * delivered asynchronously in both directions, so a test cannot rely on shared
 * mutable state or synchronous delivery that a real transport would not give.
 *
 * This module is test support. Nothing under `src/app` or `src/ui` imports it,
 * so the engine never reaches the interface bundle.
 */

export interface DirectGatewayOptions {
  readonly host?: EngineHost;
  readonly defaultTimeoutMs?: number;
  readonly createRequestId?: () => string;
}

export function createDirectGateway(options: DirectGatewayOptions = {}): ClientGateway {
  const host =
    options.host ??
    createEngineHost({ content: loadBundledContent(), saves: createMemorySaveStore() });
  const { clientPort, hostTarget } = createLoopbackChannel();
  const detach = attachEngineHost(hostTarget, host);

  return createPortGateway(clientPort, {
    transport: 'direct',
    ...(options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs }),
    ...(options.createRequestId === undefined
      ? {}
      : { createRequestId: options.createRequestId }),
    onDispose: detach,
  });
}

type Listener = (event: { data: unknown }) => void;

function createLoopbackChannel(): {
  clientPort: MessagePortLike;
  hostTarget: MessageTargetLike;
} {
  const clientListeners = new Set<Listener>();
  const hostListeners = new Set<Listener>();

  const deliver = (listeners: Set<Listener>, message: unknown): void => {
    const copy = cloneTransport(message);
    queueMicrotask(() => {
      for (const listener of [...listeners]) {
        listener({ data: copy });
      }
    });
  };

  return {
    clientPort: {
      addEventListener(_type, listener) {
        clientListeners.add(listener);
      },
      removeEventListener(_type, listener) {
        clientListeners.delete(listener);
      },
      postMessage(message) {
        deliver(hostListeners, message);
      },
    },
    hostTarget: {
      addEventListener(_type, listener) {
        hostListeners.add(listener);
      },
      removeEventListener(_type, listener) {
        hostListeners.delete(listener);
      },
      postMessage(message) {
        deliver(clientListeners, message);
      },
    },
  };
}

function cloneTransport<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  // Environments without structured clone still get isolation; the parity tests
  // run where structuredClone is available.
  return JSON.parse(JSON.stringify(value)) as T;
}
