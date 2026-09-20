import { loadBundledContent } from '@adapters/content';
import { createMemorySaveStore } from '@adapters/persistence';
import { attachEngineHost, type MessageTargetLike } from '@adapters/worker';
import { createEngineHost, type EngineHost } from '@engine';
import { createPortGateway, type ClientGateway, type MessagePortLike } from '@gateway';

/**
 * Gateway that reaches the engine through a real `MessageChannel`
 * (Technical Specification 15.1).
 *
 * This exercises the production worker dispatcher and structured-clone
 * semantics without needing a browser, so protocol contract tests can compare
 * it against the direct gateway and against the worker transport in the
 * browser-level suite.
 */

export interface ChannelGatewayOptions {
  readonly host?: EngineHost;
  readonly defaultTimeoutMs?: number;
  readonly createRequestId?: () => string;
}

export interface ChannelGateway {
  readonly gateway: ClientGateway;
  /** Detaches the engine and closes both ends of the channel. */
  close(): void;
}

export function createChannelGateway(options: ChannelGatewayOptions = {}): ChannelGateway {
  const host =
    options.host ??
    createEngineHost({ content: loadBundledContent(), saves: createMemorySaveStore() });
  const channel = new MessageChannel();

  const detach = attachEngineHost(channel.port2 as unknown as MessageTargetLike, host);

  const gateway = createPortGateway(channel.port1 as unknown as MessagePortLike, {
    transport: 'port',
    ...(options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs }),
    ...(options.createRequestId === undefined
      ? {}
      : { createRequestId: options.createRequestId }),
    onDispose: () => {
      detach();
      channel.port1.close();
      channel.port2.close();
    },
  });

  return {
    gateway,
    close(): void {
      gateway.dispose();
    },
  };
}
