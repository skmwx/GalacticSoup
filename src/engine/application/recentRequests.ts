import type { EngineResponse } from '@protocol';

/**
 * The bounded recent-request cache (Technical Specification 7.2).
 *
 * A transport can deliver the same message twice. A command that already
 * committed must therefore return its original result rather than apply again,
 * which is why a retry has to reuse the original request id. Only committed
 * state-changing commands are remembered: a query is free to run again, and a
 * rejected command has changed nothing to return.
 *
 * The cache is bounded and evicts the oldest entry first. It is session state,
 * not campaign state, so it is never saved.
 *
 * @implements TECH-7.2
 */

export interface RecentRequests {
  find(requestId: string): EngineResponse<unknown> | undefined;
  remember(requestId: string, response: EngineResponse<unknown>): void;
  clear(): void;
  readonly size: number;
}

export const RECENT_REQUEST_LIMIT = 128;

export function createRecentRequests(limit = RECENT_REQUEST_LIMIT): RecentRequests {
  const entries = new Map<string, EngineResponse<unknown>>();

  return {
    find(requestId: string): EngineResponse<unknown> | undefined {
      return entries.get(requestId);
    },

    remember(requestId: string, response: EngineResponse<unknown>): void {
      entries.delete(requestId);
      entries.set(requestId, response);
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done === true) {
          return;
        }
        entries.delete(oldest.value);
      }
    },

    clear(): void {
      entries.clear();
    },

    get size(): number {
      return entries.size;
    },
  };
}
