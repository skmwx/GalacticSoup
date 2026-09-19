import { type ClientGateway } from './clientGateway';

/**
 * The elapsed-delta driver (Technical Specification 9.1).
 *
 * The engine has no clock. Simulation time advances only because the main
 * thread measures how much real time passed between frames and sends it as a
 * command. This driver owns that measurement and three rules that go with it:
 *
 *  - one advance is in flight at a time, so a slow engine cannot build a queue
 *    of deltas that would then be applied as catch-up;
 *  - the baseline is reset when the page is hidden or restored, so the first
 *    frame after a suspension advances nothing. Time the browser did not
 *    deliver is discarded, never replayed;
 *  - the driver measures only. Capping, scaling by the selected rate and
 *    accumulating quanta are engine rules, and pausing is campaign state, not
 *    a reason to stop sending frames.
 *
 * Every source of time and scheduling is injected, so the driver is tested
 * without a browser and never reads a wall clock.
 *
 * @implements TECH-9.1
 */

export interface FrameDriverOptions {
  readonly gateway: ClientGateway;
  /** Monotonic milliseconds. Defaults to `performance.now`. */
  readonly now?: () => number;
  /** Schedules the next frame and returns a cancel function. */
  readonly schedule?: (callback: () => void) => () => void;
  /** Subscribes to visibility changes and returns an unsubscribe function. */
  readonly onVisibilityChange?: (listener: () => boolean) => () => void;
  /** Called after each advance that reached the engine. */
  readonly onAdvance?: (elapsedRealMs: number) => void;
  readonly onError?: (error: unknown) => void;
}

export interface FrameDriver {
  start(): void;
  stop(): void;
  /** Forgets the last frame time, so the next frame advances nothing. */
  resetBaseline(): void;
  readonly running: boolean;
}

export function createFrameDriver(options: FrameDriverOptions): FrameDriver {
  const now = options.now ?? defaultNow;
  const schedule = options.schedule ?? defaultSchedule;
  const subscribe = options.onVisibilityChange ?? defaultVisibility;

  let running = false;
  let lastFrameMs: number | null = null;
  let cancelFrame: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;

  const frame = (): void => {
    cancelFrame = null;
    if (!running) {
      return;
    }

    const current = now();
    const previous = lastFrameMs;
    lastFrameMs = current;

    if (previous === null) {
      // The first frame after a start or a baseline reset establishes the
      // baseline and advances no simulation time.
      queue();
      return;
    }

    const elapsed = Math.max(0, Math.floor(current - previous));
    void options.gateway
      .request('time.advance', { elapsedRealMs: elapsed })
      .then(() => {
        options.onAdvance?.(elapsed);
      })
      .catch((error: unknown) => {
        options.onError?.(error);
      })
      .finally(() => {
        queue();
      });
  };

  function queue(): void {
    if (running && cancelFrame === null) {
      cancelFrame = schedule(frame);
    }
  }

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      lastFrameMs = null;
      unsubscribe = subscribe(() => {
        lastFrameMs = null;
        return true;
      });
      queue();
    },

    stop(): void {
      running = false;
      cancelFrame?.();
      cancelFrame = null;
      unsubscribe?.();
      unsubscribe = null;
      lastFrameMs = null;
    },

    resetBaseline(): void {
      lastFrameMs = null;
    },

    get running(): boolean {
      return running;
    },
  };
}

function defaultNow(): number {
  return performance.now();
}

function defaultSchedule(callback: () => void): () => void {
  const handle = requestAnimationFrame(() => {
    callback();
  });
  return () => {
    cancelAnimationFrame(handle);
  };
}

function defaultVisibility(listener: () => boolean): () => void {
  if (typeof document === 'undefined') {
    return () => undefined;
  }
  const handler = (): void => {
    listener();
  };
  document.addEventListener('visibilitychange', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
  };
}
