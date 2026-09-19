import { useEffect, useState } from 'react';

import {
  EngineUnavailableError,
  GatewayRequestError,
  type ClientGateway,
  type TransportKind,
} from '@gateway';
import {
  EMPTY_PAYLOAD,
  type CapabilitiesData,
  type ContentSummaryData,
  type ErrorParams,
  type HealthData,
} from '@protocol';
import type { MessageKey } from '@shared';

/**
 * Engine handshake state for the shell (Technical Specification 12.1).
 *
 * This is presentation state only: it caches an immutable projection of what
 * the engine reported. No authoritative value is derived or stored here.
 */

export type EngineStatus =
  | { readonly kind: 'connecting' }
  | {
      readonly kind: 'ready';
      readonly transport: TransportKind;
      readonly health: HealthData;
      readonly capabilities: CapabilitiesData;
      readonly content: ContentSummaryData;
    }
  | {
      readonly kind: 'failed';
      readonly messageKey: MessageKey;
      readonly params?: ErrorParams;
    };

export function useEngineStatus(gateway: ClientGateway): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>({ kind: 'connecting' });

  useEffect(() => {
    let active = true;

    const run = async (): Promise<EngineStatus> => {
      const health = await gateway.request('system.health', EMPTY_PAYLOAD);
      if (!health.ok) {
        return toFailure(health.error.messageKey, health.error.params);
      }

      const capabilities = await gateway.request('system.capabilities', EMPTY_PAYLOAD);
      if (!capabilities.ok) {
        return toFailure(capabilities.error.messageKey, capabilities.error.params);
      }

      const content = await gateway.request('content.summary', EMPTY_PAYLOAD);
      if (!content.ok) {
        return toFailure(content.error.messageKey, content.error.params);
      }

      return {
        kind: 'ready',
        transport: gateway.transport,
        health: health.data,
        capabilities: capabilities.data,
        content: content.data,
      };
    };

    run()
      .catch((error: unknown) => describeThrown(error))
      .then((result) => {
        if (active) {
          setStatus(result);
        }
      });

    return () => {
      active = false;
    };
  }, [gateway]);

  return status;
}

function toFailure(messageKey: MessageKey, params?: ErrorParams): EngineStatus {
  return params === undefined
    ? { kind: 'failed', messageKey }
    : { kind: 'failed', messageKey, params };
}

function describeThrown(error: unknown): EngineStatus {
  if (error instanceof GatewayRequestError || error instanceof EngineUnavailableError) {
    return { kind: 'failed', messageKey: error.messageKey };
  }
  return { kind: 'failed', messageKey: 'error.gateway.transportFailed' };
}
