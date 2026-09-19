import {
  type ClientGateway,
  EngineUnavailableError,
  GatewayRequestError,
} from './clientGateway';
import { createPortGateway, type MessagePortLike } from './portGateway';

/**
 * Gateway backed by the dedicated engine worker (Technical Specification 4.2).
 *
 * If the worker cannot start, this throws `EngineUnavailableError` and the
 * application shows a blocking compatibility failure. There is deliberately no
 * fallback that would run an authoritative engine on the interface thread.
 *
 * @implements TECH-4.2
 */

export interface WorkerGatewayOptions {
  /** Overridable so tests can supply a stub worker. */
  readonly createWorker?: () => Worker;
  readonly defaultTimeoutMs?: number;
  readonly onUnmatchedResponse?: (response: unknown) => void;
  /** Called when the worker itself fails after a successful start. */
  readonly onEngineFailure?: (error: GatewayRequestError) => void;
}

export function createWorkerGateway(options: WorkerGatewayOptions = {}): ClientGateway {
  const createWorker = options.createWorker ?? defaultCreateWorker;

  if (options.createWorker === undefined && typeof Worker === 'undefined') {
    throw new EngineUnavailableError(
      'worker-unsupported',
      'This browser does not provide dedicated workers.',
    );
  }

  let worker: Worker;
  try {
    worker = createWorker();
  } catch (cause) {
    throw new EngineUnavailableError('worker-failed', 'The engine worker could not start.', {
      cause,
    });
  }

  const gateway = createPortGateway(worker as unknown as MessagePortLike, {
    transport: 'worker',
    ...(options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs }),
    ...(options.onUnmatchedResponse === undefined
      ? {}
      : { onUnmatchedResponse: options.onUnmatchedResponse }),
    onDispose: () => {
      worker.terminate();
    },
  });

  const handleFatal = (): void => {
    const error = new GatewayRequestError(
      'TRANSPORT_FAILED',
      'The engine worker stopped responding.',
    );
    gateway.failPending(error);
    options.onEngineFailure?.(error);
  };

  worker.addEventListener('error', handleFatal);
  worker.addEventListener('messageerror', handleFatal);

  return gateway;
}

function defaultCreateWorker(): Worker {
  // `new URL(..., import.meta.url)` keeps the engine in its own bundle: the
  // interface thread references the worker entry without importing it.
  return new Worker(new URL('../adapters/worker/engineWorker.ts', import.meta.url), {
    type: 'module',
    name: 'galactic-soup-engine',
  });
}
