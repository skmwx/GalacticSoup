import { vi } from 'vitest';

import type { ClientGateway } from '@gateway';

/**
 * Animation frames the test runs itself (Technical Specification 9.1).
 *
 * The interface advances simulation time only through its frame driver, which
 * measures real time between animation frames and sends it as `time.advance`.
 * A component test that waits for travel would otherwise wait in real time for
 * the browser's frames, and how much simulation time passed would depend on
 * the machine. This replaces `requestAnimationFrame` and `performance.now`, so
 * no frame runs until the test steps one, and each step is a known number of
 * milliseconds. The shipped driver, hook and gateway are unchanged: the
 * advance and the invalidations it answers with take their ordinary path.
 *
 * Install it before rendering, observe the gateway the interface is given, and
 * restore it when the test ends.
 */
export interface ControlledFrames {
  /** Wraps a gateway so a step can wait until its advance is answered. */
  observe(gateway: ClientGateway): ClientGateway;
  /**
   * Moves the clock on by `elapsedMs`, runs every pending frame and waits for
   * any advance those frames sent to be answered. The first frame after the
   * driver starts only sets its baseline and sends nothing.
   */
  step(elapsedMs?: number): Promise<void>;
  /** Steps until `done` answers true, and fails after `maximumFrames`. */
  stepUntil(done: () => boolean, options?: { elapsedMs?: number; maximumFrames?: number }): Promise<number>;
  restore(): void;
}

const FRAME_MS = 250;

export function controlFrames(): ControlledFrames {
  let nowMs = 0;
  let nextHandle = 1;
  const pending = new Map<number, FrameRequestCallback>();
  let requested = 0;
  let answered = 0;

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const handle = nextHandle;
    nextHandle += 1;
    pending.set(handle, callback);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    pending.delete(handle);
  });
  const now = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

  const step = async (elapsedMs = FRAME_MS): Promise<void> => {
    nowMs += elapsedMs;
    const due = [...pending.entries()];
    pending.clear();
    for (const [, callback] of due) callback(nowMs);
    const target = requested;
    await vi.waitFor(() => {
      if (answered < target) throw new Error(`${String(target - answered)} advance(s) not yet answered.`);
    });
  };

  return {
    observe(gateway: ClientGateway): ClientGateway {
      return {
        transport: gateway.transport,
        request: ((type, payload, options) => {
          const response = gateway.request(type, payload, options);
          if (type !== 'time.advance') return response;
          requested += 1;
          return response.finally(() => {
            answered += 1;
          });
        }) as ClientGateway['request'],
        sendEnvelope: (message, options) => gateway.sendEnvelope(message, options),
        dispose: () => {
          gateway.dispose();
        },
      };
    },
    step,
    async stepUntil(done, options = {}): Promise<number> {
      const maximumFrames = options.maximumFrames ?? 40;
      for (let frame = 0; frame < maximumFrames; frame += 1) {
        if (done()) return frame;
        await step(options.elapsedMs);
      }
      if (done()) return maximumFrames;
      throw new Error(`The condition was not met within ${String(maximumFrames)} frames.`);
    },
    restore(): void {
      now.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}
