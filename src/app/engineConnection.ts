import { createWorkerGateway, EngineUnavailableError, type ClientGateway } from '@gateway';
import type { MessageKey } from '@shared';

/**
 * Engine hosting decision taken once at start-up
 * (Technical Specification 4.2).
 *
 * Either the worker starts and the interface talks to it through the gateway,
 * or the game stops with a blocking explanation. There is no third path.
 *
 * @implements TECH-4.2
 */
export type EngineConnection =
  | { readonly kind: 'ready'; readonly gateway: ClientGateway }
  | { readonly kind: 'unavailable'; readonly messageKey: MessageKey };

export function connectEngine(): EngineConnection {
  try {
    return { kind: 'ready', gateway: createWorkerGateway() };
  } catch (error: unknown) {
    if (error instanceof EngineUnavailableError) {
      return { kind: 'unavailable', messageKey: error.messageKey };
    }
    return { kind: 'unavailable', messageKey: 'error.compatibility.workerFailed' };
  }
}
