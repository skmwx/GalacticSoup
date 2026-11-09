import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * `toBeUnavailable` - the control refuses activation.
 *
 * Unavailable controls are `aria-disabled` rather than natively disabled, so
 * they keep keyboard focus and can explain themselves in a tooltip
 * (Technical Specification 12.3). jest-dom's `toBeDisabled` reads only the
 * native attribute, so it would pass `toBeEnabled` for an aria-disabled
 * control; this matcher treats either form as unavailable, and its negation
 * requires neither.
 */
declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toBeUnavailable(): R;
  }
}

expect.extend({
  toBeUnavailable(received: unknown) {
    if (!(received instanceof HTMLElement)) {
      return { pass: false, message: () => 'expected an HTML element' };
    }
    const native = 'disabled' in received && (received as HTMLButtonElement).disabled;
    const aria = received.getAttribute('aria-disabled') === 'true';
    const pass = native || aria;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received.outerHTML.slice(0, 120)} to be available, but it is ${native ? 'disabled' : 'aria-disabled'}`
          : `expected ${received.outerHTML.slice(0, 120)} to be unavailable (disabled or aria-disabled)`,
    };
  },
});
