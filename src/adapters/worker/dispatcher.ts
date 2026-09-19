import type { EngineHost } from '@engine';
import { failureResponse, internalError, readRequestId } from '@protocol';

/**
 * Message dispatch for a hosted engine (Technical Specification 4.2).
 *
 * The dispatcher is written against the minimum message-target surface rather
 * than against `DedicatedWorkerGlobalScope`, so the same code serves the real
 * worker and an in-process `MessagePort` in tests.
 *
 * @implements TECH-4.2
 */

export interface MessageEventLike {
  readonly data: unknown;
}

export interface MessageTargetLike {
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener?(type: 'message', listener: (event: MessageEventLike) => void): void;
  postMessage(message: unknown): void;
  /** Ports created with `addEventListener` must be started explicitly. */
  start?(): void;
}

/** Attaches `host` to `target` and returns a detach function. */
export function attachEngineHost(target: MessageTargetLike, host: EngineHost): () => void {
  const listener = (event: MessageEventLike): void => {
    const message = event.data;
    void host
      .handle(message)
      .catch(() => failureResponse(readRequestId(message), internalError({ stage: 'handle' })))
      .then((response) => {
        post(target, response, message);
      });
  };

  target.addEventListener('message', listener);
  target.start?.();

  return () => {
    target.removeEventListener?.('message', listener);
  };
}

function post(target: MessageTargetLike, response: unknown, request: unknown): void {
  try {
    target.postMessage(response);
  } catch {
    // The response itself could not cross the transport. Report the failure in
    // a shape that is guaranteed to be transportable.
    target.postMessage(
      failureResponse(readRequestId(request), internalError({ stage: 'postMessage' })),
    );
  }
}
