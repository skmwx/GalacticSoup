import type { BrowserContext, Request } from '@playwright/test';

/**
 * Requests the browser context made while the game loaded, for the
 * same-origin evidence (Technical Specification 2, 3.2; Test Suite
 * Optimization Plan phase 10).
 *
 * A request is compared by its exact origin - scheme, host and port - not by
 * a string prefix of the base URL, which `http://localhost:4173.example` would
 * also match.
 */
export interface ObservedRequest {
  readonly url: string;
  readonly origin: string;
  readonly resourceType: string;
}

/** Starts recording every request the context makes, its workers' included. */
export function observeRequests(context: BrowserContext): ObservedRequest[] {
  const observed: ObservedRequest[] = [];
  context.on('request', (request: Request) => {
    const url = request.url();
    observed.push({ url, origin: originOf(url), resourceType: request.resourceType() });
  });
  return observed;
}

/** The exact origin of a URL; the string `"null"` for one that has none, such as `data:`. */
export function originOf(url: string): string {
  return new URL(url).origin;
}

/** Requests whose origin is not exactly `origin`. */
export function foreignRequests(observed: readonly ObservedRequest[], origin: string): string[] {
  return observed.filter((request) => request.origin !== origin).map((request) => request.url);
}
