import { describe, expect, it } from 'vitest';

import {
  createFrameDriver,
  type ClientGateway,
  type FrameDriverOptions,
} from '@gateway';
import { successResponse, type EngineResponse } from '@protocol';

/**
 * The elapsed-delta driver (Technical Specification 9.1).
 *
 * Every source of time and scheduling is injected, so these cases pin the
 * driver's rules exactly: the first frame establishes a baseline and advances
 * nothing, one advance is in flight at a time, and a visibility change
 * discards the interval rather than replaying it.
 */

interface Harness {
  readonly driver: ReturnType<typeof createFrameDriver>;
  readonly sent: number[];
  readonly failures: unknown[];
  /** Runs the next scheduled frame, if one is queued. */
  tick(intoTheFutureMs: number): Promise<void>;
  /** Simulates a visibility or suspension transition. */
  suspend(): void;
}

function harness(options: { readonly failRequests?: boolean } = {}): Harness {
  const sent: number[] = [];
  const failures: unknown[] = [];
  let clockMs = 1_000;
  let pending: (() => void) | null = null;
  let visibilityListener: (() => boolean) | null = null;

  const gateway = {
    transport: 'direct',
    request(_type: string, payload: { elapsedRealMs: number }): Promise<EngineResponse<unknown>> {
      if (options.failRequests === true) {
        return Promise.reject(new Error('transport failed'));
      }
      sent.push(payload.elapsedRealMs);
      return Promise.resolve(successResponse('req', 1, null));
    },
    sendEnvelope(): Promise<EngineResponse<unknown>> {
      throw new Error('not used');
    },
    dispose(): void {
      // nothing to release in the stub
    },
  } as unknown as ClientGateway;

  const driverOptions: FrameDriverOptions = {
    gateway,
    now: () => clockMs,
    schedule: (callback) => {
      pending = callback;
      return () => {
        pending = null;
      };
    },
    onVisibilityChange: (listener) => {
      visibilityListener = listener;
      return () => {
        visibilityListener = null;
      };
    },
    onError: (error) => {
      failures.push(error);
    },
  };

  const driver = createFrameDriver(driverOptions);

  return {
    driver,
    sent,
    failures,
    async tick(intoTheFutureMs: number): Promise<void> {
      clockMs += intoTheFutureMs;
      const callback = pending;
      pending = null;
      callback?.();
      // Let the request promise and its `finally` settle.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    suspend(): void {
      visibilityListener?.();
    },
  };
}

describe('frame driver', () => {
  it('advances nothing on the first frame [TECH-9.1]', async () => {
    const test = harness();
    test.driver.start();

    await test.tick(16);

    expect(test.sent).toEqual([]);
    expect(test.driver.running).toBe(true);
  });

  it('sends the interval between frames [TECH-9.1]', async () => {
    const test = harness();
    test.driver.start();

    await test.tick(16);
    await test.tick(16);
    await test.tick(33);

    expect(test.sent).toEqual([16, 33]);
  });

  it('sends whole milliseconds only [TECH-5.2, TECH-9.1]', async () => {
    const test = harness();
    test.driver.start();

    await test.tick(0);
    await test.tick(16.7);

    expect(test.sent).toEqual([16]);
  });

  it('discards the interval across a suspension [FUNC-22.12, TECH-9.1]', async () => {
    const test = harness();
    test.driver.start();
    await test.tick(16);
    await test.tick(16);

    test.suspend();
    await test.tick(600_000);
    await test.tick(16);

    expect(test.sent).toEqual([16, 16]);
  });

  it('discards the interval after an explicit baseline reset [TECH-9.1]', async () => {
    const test = harness();
    test.driver.start();
    await test.tick(16);

    test.driver.resetBaseline();
    await test.tick(90_000);
    await test.tick(16);

    expect(test.sent).toEqual([16]);
  });

  it('stops scheduling once stopped [TECH-9.1]', async () => {
    const test = harness();
    test.driver.start();
    await test.tick(16);
    test.driver.stop();

    await test.tick(16);

    expect(test.sent).toEqual([]);
    expect(test.driver.running).toBe(false);
  });

  it('reports a failed advance and keeps driving frames [TECH-5.4, TECH-9.1]', async () => {
    const test = harness({ failRequests: true });
    test.driver.start();

    await test.tick(16);
    await test.tick(16);
    await test.tick(16);

    expect(test.failures).toHaveLength(2);
    expect(test.driver.running).toBe(true);
  });
});
